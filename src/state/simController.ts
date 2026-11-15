// Drives the local replica of the deterministic mission simulation.
// Every client runs the same simulator with the same seed and the same
// sequenced anomaly decisions, so all players watch the identical flight.
import { MissionSimulator, runMonteCarlo, type MonteCarloResult } from '../../shared/engine/simulate';
import { buildReport } from '../../shared/engine/score';
import { canAct } from '../../shared/room';
import { OBJECTIVE_MAP } from '../../shared/data/mission';
import { teamOf, useStore } from './store';
import { vault } from './vault';

let sim: MissionSimulator | null = null;
let runId = '';
let raf = 0;
let last = 0;
let carry = 0;
let mcStarted = false;
let lastPush = 0;

export function simSpeedDefault(totalDays: number) { return Math.max(10, Math.round(totalDays / 45)); }

function push(force = false) {
  if (!sim) return;
  const now = performance.now();
  if (!force && now - lastPush < 90) return;
  lastPush = now;
  const st = useStore.getState();
  useStore.getState().setSim({
    day: sim.day, telemetry: [...sim.telemetryNow()], events: [...sim.eventsNow()], pending: sim.pending,
    pendingSince: sim.pending ? (st.sim?.pending?.index === sim.pending.index ? st.sim.pendingSince : Date.now()) : 0,
    done: sim.done, science: sim.scienceNow(),
  });
}

function applyKnownDecisions() {
  const room = useStore.getState().room;
  if (!sim || !room?.sim) return;
  while (sim.pending && room.sim.decisions[sim.pending.index] !== undefined) {
    sim.decide(room.sim.decisions[sim.pending.index]);
    if (!sim.done) sim.step(0);
  }
}

function loop(t: number) {
  raf = requestAnimationFrame(loop);
  const st = useStore.getState();
  if (!sim || !st.sim) return;
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  applyKnownDecisions();
  if (st.sim.playing && !sim.done && !sim.pending) {
    carry += dt * st.sim.speed;
    const n = Math.floor(carry);
    if (n > 0) { carry -= n; sim.step(n); applyKnownDecisions(); }
  }
  push();
  if (sim.done && !mcStarted) finish();
}

function finish() {
  if (!sim) return;
  mcStarted = true;
  push(true);
  const result = sim.result();
  useStore.getState().setSim({ result, done: true });
  const room = useStore.getState().room!;
  const design = sim.design;
  const mods = room.modifiers;
  // Monte Carlo in chunks so the UI stays responsive (deterministic seeds → identical on every client)
  const total = 100, chunk = 8;
  const acc: MonteCarloResult = { runs: 0, success: 0, partial: 0, failure: 0, meanScience: 0, meanLifeYears: 0, lossReasons: {} };
  const myRun = runId;
  let done = 0;
  const step = () => {
    if (myRun !== runId) return;
    const n = Math.min(chunk, total - done);
    const part = runMonteCarlo(design, mods, n, `${myRun}-mc-${done}`);
    acc.success += part.success * n; acc.partial += part.partial * n; acc.failure += part.failure * n;
    acc.meanScience += part.meanScience * n; acc.meanLifeYears += part.meanLifeYears * n;
    for (const [k, v] of Object.entries(part.lossReasons)) acc.lossReasons[k] = (acc.lossReasons[k] ?? 0) + v;
    done += n;
    useStore.getState().setSim({ mcProgress: done / total });
    if (done < total) { setTimeout(step, 0); return; }
    const mc: MonteCarloResult = { ...acc, runs: total, success: acc.success / total, partial: acc.partial / total, failure: acc.failure / total, meanScience: acc.meanScience / total, meanLifeYears: acc.meanLifeYears / total };
    const st = useStore.getState();
    const r = st.room!;
    const report = buildReport({ runId: myRun, design, res: sim!.res, sim: result, mc, metrics: r.metrics, team: teamOf(r) });
    st.setSim({ report, mcProgress: 1 });
    // Auto-archive the run in this player's vault
    const obj = OBJECTIVE_MAP[design.objectiveId]?.short ?? design.objectiveId.toUpperCase();
    const runNo = st.vaultRuns.filter((v) => v.design.objectiveId === design.objectiveId).length + 1;
    vault.save({
      schema: 1, id: myRun, name: `${obj} run ${runNo}${r.branchOf ? ` (branch of ${r.branchOf.name})` : ''}`, savedAt: Date.now(),
      parentId: r.branchOf?.id, parentName: r.branchOf?.name, design, modifiers: mods, designEvents: r.designEvents, decisions: sim!.decisionsMade,
      simSeed: r.sim?.seed, report, team: teamOf(r),
    });
    st.refreshVault();
    if (r.branchOf) st.setCompare(0, r.branchOf.id), st.setCompare(1, myRun);
    if (canAct(r, st.playerId, 'director') && r.phase === 'sim') st.send({ t: 'simDone' });
    st.toast(`Results ready: ${result.outcome.toUpperCase()} — score ${report.score.total} (${report.score.grade}). Saved to the Archives.`, result.outcome === 'success' ? 'ok' : result.outcome === 'partial' ? 'warn' : 'crit');
  };
  setTimeout(step, 30);
}

/** Keep the local simulator in sync with room.sim */
export function startSimController() {
  let prevKey = '';
  useStore.subscribe((s) => {
    const key = s.room?.sim ? s.room.sim.runId : '';
    if (key === prevKey) return;
    prevKey = key;
    cancelAnimationFrame(raf);
    sim = null; mcStarted = false; carry = 0;
    if (!s.room?.sim) { if (s.sim) useStore.setState({ sim: null }); return; }
    runId = s.room.sim.runId;
    sim = new MissionSimulator(s.room.design, s.room.modifiers, { seed: s.room.sim.seed });
    const total = sim.totalDays;
    useStore.setState({
      sim: { runId, day: 0, totalDays: total, cruiseDays: sim.cruiseDays, telemetry: [], events: [], pending: null, pendingSince: 0, done: false, result: null,
        speed: simSpeedDefault(total), playing: true, mcProgress: 0, report: null, science: 0 },
    });
    // late joiner: fast-forward through already-made decisions
    if (s.room.sim.decisions.length) {
      let guard = 0;
      while (!sim.done && guard++ < 100000) {
        sim.step(30);
        if (sim.pending) { if (s.room.sim.decisions[sim.pending.index] === undefined) break; applyKnownDecisions(); }
      }
    }
    last = performance.now();
    raf = requestAnimationFrame(loop);
  });
}

export function skipToNextEvent() {
  if (!sim || sim.done || sim.pending) return;
  const start = sim.eventsNow().length;
  let guard = 0;
  while (!sim.done && !sim.pending && sim.eventsNow().length === start && guard++ < 20000) sim.step(1);
  push(true);
}
export function skipToEnd() {
  if (!sim) return;
  let guard = 0;
  while (!sim.done && !sim.pending && guard++ < 100000) sim.step(10);
  push(true);
}
