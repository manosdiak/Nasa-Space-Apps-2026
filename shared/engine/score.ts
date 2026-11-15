// Scoring, post-mission analysis and run comparison.
import { DIFFICULTY_MAP, OBJECTIVE_MAP, ORBIT_MAP } from '../data/mission';
import type {
  MissionDesign, MissionReport, MissionRunSave, ResourceState, RoleId, ScoreBreakdown, SimResult, Status, TeamMetrics,
} from '../types';
import { fmt } from './physics';
import { matchMissions } from './missionMatch';
import type { MonteCarloResult } from './simulate';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function emptyMetrics(): TeamMetrics {
  return { actions: 0, actionsByRole: { director: 0, systems: 0, science: 0, ops: 0 }, proposals: 0, approved: 0, rejected: 0, resolveMsTotal: 0,
    signoffAttempts: 0, signoffFailures: 0, chatMessages: 0, reverts: 0, decisions: 0, decisionMsTotal: 0 };
}

/** Team decision-making & coordination efficiency, 0..1. */
export function coordinationScore(m: TeamMetrics, humanRoles: RoleId[][]): { value: number; parts: { label: string; value: number }[] } {
  const resolved = m.approved + m.rejected;
  const resolution = m.proposals ? resolved / m.proposals : 1;
  const avgResolveS = resolved ? m.resolveMsTotal / resolved / 1000 : 0;
  const responsiveness = resolved ? clamp(1 - (avgResolveS - 20) / 160, 0, 1) : 1;
  const readiness = m.signoffAttempts ? clamp(1 - m.signoffFailures / m.signoffAttempts, 0, 1) : 0.5;
  // Balance: how evenly the work was spread over roles held by different humans
  let balance = 1;
  if (humanRoles.length > 1) {
    const perPlayer = humanRoles.map((roles) => roles.reduce((a, r) => a + (m.actionsByRole[r] ?? 0), 0));
    const total = perPlayer.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const ideal = total / perPlayer.length;
      const dev = perPlayer.reduce((a, b) => a + Math.abs(b - ideal), 0) / (2 * total);
      balance = clamp(1 - dev * 1.5, 0, 1);
    }
  }
  const churn = m.actions ? clamp(1 - (m.reverts / m.actions) * 2, 0, 1) : 1;
  const avgDecisionS = m.decisions ? m.decisionMsTotal / m.decisions / 1000 : 0;
  const decisive = m.decisions ? clamp(1 - (avgDecisionS - 15) / 120, 0, 1) : 1;
  const parts = [
    { label: 'Proposals resolved', value: resolution },
    { label: 'Negotiation speed', value: responsiveness },
    { label: 'First-time launch readiness', value: readiness },
    { label: 'Work shared across the team', value: balance },
    { label: 'Low design churn', value: churn },
    { label: 'Anomaly response speed', value: decisive },
  ];
  const value = 0.2 * resolution + 0.15 * responsiveness + 0.25 * readiness + 0.15 * balance + 0.1 * churn + 0.15 * decisive;
  return { value: clamp(value, 0, 1), parts };
}

export function computeScore(design: MissionDesign, res: ResourceState, sim: SimResult, mc: MonteCarloResult | null, metrics: TeamMetrics, humanRoles: RoleId[][]): ScoreBreakdown {
  const diff = DIFFICULTY_MAP[design.difficulty];
  const successProbability = mc ? mc.success + 0.3 * mc.partial : res.estimatedSuccess;
  const science = clamp(sim.science / Math.max(1, res.science.baseline) / 1.25, 0, 1);
  const budgetMargin = diff.enforceCaps ? clamp(res.pillars.budget.margin / 0.3, 0, 1) : 0.5;
  const massMargin = clamp(res.pillars.mass.margin / 0.4, 0, 1);
  const powerMargin = clamp(res.power.marginFrac / 0.5, 0, 1);
  const efficiency = ((budgetMargin * 0.5 + massMargin * 0.25 + powerMargin * 0.25) * (sim.outcome === 'failure' ? 0.4 : 1));
  const coordination = coordinationScore(metrics, humanRoles).value;
  const pts = { success: 300 * clamp(successProbability, 0, 1), science: 300 * science, efficiency: 200 * efficiency, coordination: 200 * coordination };
  const total = Math.round((pts.success + pts.science + pts.efficiency + pts.coordination) * diff.scoreMult);
  const grade = total >= 900 ? 'S' : total >= 750 ? 'A' : total >= 600 ? 'B' : total >= 450 ? 'C' : total >= 300 ? 'D' : 'F';
  return { successProbability, science, efficiency, coordination, pts, difficultyMult: diff.scoreMult, total, grade };
}

export function analyzeMission(design: MissionDesign, res: ResourceState, sim: SimResult, mc: MonteCarloResult | null): { title: string; text: string; severity: Status }[] {
  const out: { title: string; text: string; severity: Status }[] = [];
  const obj = OBJECTIVE_MAP[design.objectiveId];
  const orbit = ORBIT_MAP[design.orbit.id];
  const pctBase = (100 * sim.science) / Math.max(1, res.science.baseline);
  const verdict = sim.outcome === 'success' ? 'MISSION SUCCESS' : sim.outcome === 'partial' ? 'PARTIAL SUCCESS' : 'MISSION FAILURE';
  out.push({ title: verdict, severity: sim.outcome === 'success' ? 'ok' : sim.outcome === 'partial' ? 'warn' : 'crit',
    text: `${obj.name}: returned ${fmt(sim.science, 0)} science points (${fmt(pctBase, 0)}% of the ${fmt(res.science.baseline, 0)}-point baseline; minimum mission ${fmt(res.science.threshold, 0)}) over ${fmt(sim.lifetimeYears, 2)} years of operations. ${sim.endReason}` });

  if (sim.outcome !== 'success') {
    const why: string[] = [];
    const earlyLoss = sim.daysSimulated <= 1 || /launch failure|deployment|commissioning/i.test(sim.endReason);
    if (earlyLoss) why.push(`the spacecraft was lost at ${/launch failure/i.test(sim.endReason) ? 'launch' : 'deployment'} — bad luck that the Monte Carlo shows is rare for this design (${mc ? `${fmt((1 - mc.success - mc.partial) * 100, 0)}% of futures fail` : 'see reliability'}); a more reliable rocket, a sturdier bus or a fleet with spares reduce this risk`);
    if (res.science.missingRequired.length) why.push(`the payload lacks a required measurement (${res.science.missingRequired.map((g) => g.join(' or ')).join('; ')})`);
    if (!earlyLoss && sim.lifetimeYears < obj.minLifeYears) why.push(`operations lasted ${fmt(sim.lifetimeYears, 2)} yr, short of the ${obj.minLifeYears}-yr minimum`);
    if (!earlyLoss && sim.science < res.science.baseline * 0.75) why.push(`science fell short — ${res.science.coverageFactor < 0.8 ? `coverage was only ${fmt(res.science.coverageFactor * 100, 0)}% of what the objective needs` : 'not enough relevant instruments, data return or operating time'}`);
    if (why.length) out.push({ title: 'Why it fell short', severity: 'crit', text: `The mission did not meet full success because ${why.join(', and ')}.` });
  }

  out.push({ title: 'Lifetime', severity: res.time.lifetimeYears < obj.minLifeYears ? 'crit' : res.time.lifetimeYears < design.missionYears ? 'warn' : 'ok',
    text: `Before launch the engine predicted ${Number.isFinite(res.time.lifetimeYears) ? fmt(res.time.lifetimeYears, 1) : 'unlimited'} years of life, limited by: ${res.time.limiter}. ${res.time.limits.filter((l) => Number.isFinite(l.years)).map((l) => `${l.label}: ${fmt(Math.max(0, l.years), 1)} yr`).join(' · ')}.` });

  const genTotal = sim.dataReturnedGb + sim.dataLostGb;
  if (sim.dataLostGb > 0.01 * Math.max(genTotal, 1)) {
    out.push({ title: 'Data lost to memory overflow', severity: sim.dataLostGb > 0.3 * genTotal ? 'crit' : 'warn',
      text: `${fmt(sim.dataLostGb, 0)} Gb (${fmt((100 * sim.dataLostGb) / Math.max(genTotal, 1), 0)}%) never reached the ground. Instruments generated ${fmt(res.data.genGbPerDay, 1)} Gb/day but the ${res.link.componentName} at ${fmt(res.link.rateMbps, res.link.rateMbps < 1 ? 3 : 1)} Mbps × ${fmt(res.link.contactMinPerDay, 0)} min/day of contact returns ${fmt(res.link.downlinkGbPerDay, 1)} Gb/day; the ${fmt(res.data.storageGb, 0)} Gb recorder first filled on day ${sim.firstOverflowDay}. Fix: higher-rate radio (Ka/optical), more ground contact, onboard compression, or fewer high-rate instruments.` });
  } else if (genTotal > 0) {
    out.push({ title: 'Data return', severity: 'ok', text: `${fmt(sim.dataReturnedGb, 0)} Gb downlinked with no meaningful losses — the comms system had ${fmt(Math.max(0, (res.link.downlinkGbPerDay / Math.max(res.data.genGbPerDay, 1e-6) - 1) * 100), 0)}% spare capacity.` });
  }

  const pm = res.power.marginFrac;
  out.push({ title: 'Power', severity: pm < 0 ? 'crit' : pm < 0.15 ? 'warn' : 'ok',
    text: `${res.power.source} supplied ${fmt(res.power.eolW, 0)} W at end of life against ${fmt(res.power.requiredArrayW + Math.min(res.power.rtgW, res.power.loadSunW), 0)} W needed (margin ${fmt(pm * 100, 0)}%).${res.power.eclipseFraction > 0 ? ` Eclipses took ${fmt(res.power.eclipseFraction * 100, 0)}% of each orbit; batteries cycled at ${fmt(res.power.dodActual * 100, 0)}% depth of discharge (${fmt(res.power.dodAllowed * 100, 0)}% allowed for the mission's cycle count).` : ''}${orbit.distanceFromSunAU > 1.5 ? ` At ${orbit.distanceFromSunAU} AU sunlight is ${fmt(100 / orbit.distanceFromSunAU ** 2, 1)}% of Earth's (inverse-square law).` : ''}` });

  const last = sim.telemetry[sim.telemetry.length - 1];
  if (last) {
    const shieldDose = last.doseKrad;
    out.push({ title: 'Radiation', severity: res.time.radiationYears < design.missionYears ? 'warn' : 'ok',
      text: `The electronics absorbed about ${fmt(shieldDose, 1)} krad behind the bus shielding. ${res.time.radiationYears < 100 ? `The flight computer's tolerance gives ~${fmt(res.time.radiationYears, 1)} years in this environment.` : 'Radiation was not a limiting factor.'}` });
  }

  if (sim.anomalies > 0) {
    const decisions = sim.events.filter((e) => e.decision).map((e) => e.title.replace('Decision: ', '')).slice(0, 6);
    out.push({ title: 'Anomalies', severity: sim.anomaliesSurvived >= sim.anomalies * 0.8 ? 'ok' : 'warn',
      text: `${sim.anomalies} anomalies, ${sim.anomaliesSurvived} handled without lasting damage, ${fmt(sim.safeModeDays, 0)} days in safe mode.${decisions.length ? ` Key calls: ${decisions.join('; ')}.` : ''}` });
  }

  const totalCost = res.cost.development + res.cost.launch + sim.opsCost + sim.anomalyCost + res.cost.scheduleSlip;
  out.push({ title: 'Cost', severity: totalCost > res.cost.cap ? 'crit' : 'ok',
    text: `Actual lifecycle cost ≈ $${fmt(totalCost, 0)}M (development $${fmt(res.cost.development, 0)}M, launch $${fmt(res.cost.launch, 0)}M, operations $${fmt(sim.opsCost, 0)}M, anomaly responses $${fmt(sim.anomalyCost, 1)}M) against a $${fmt(res.cost.cap, 0)}M cap.` });

  if (mc) {
    const reasons = Object.entries(mc.lossReasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v}×)`);
    out.push({ title: `Monte Carlo: ${mc.runs} possible futures`, severity: mc.success >= 0.75 ? 'ok' : mc.success >= 0.4 ? 'warn' : 'crit',
      text: `Full success in ${fmt(mc.success * 100, 0)}%, partial in ${fmt(mc.partial * 100, 0)}%, failure in ${fmt(mc.failure * 100, 0)}%; mean science ${fmt(mc.meanScience, 0)}.${reasons.length ? ` Most common shortfalls: ${reasons.join('; ')}.` : ''}` });
  }

  const tips = suggestions(design, res, sim);
  if (tips.length) out.push({ title: 'Try next (Time-Machine branch ideas)', severity: 'ok', text: tips.join(' ') });
  return out;
}

export function suggestions(design: MissionDesign, res: ResourceState, sim?: SimResult): string[] {
  const t: string[] = [];
  const p = res.pillars;
  if (p.comms.status !== 'ok') t.push('• Comms: switch to Ka-band or an optical terminal, buy more contact hours, or add a compressing computer.');
  if (p.power.status !== 'ok') t.push(`• Power: add array area${ORBIT_MAP[design.orbit.id].distanceFromSunAU > 3 ? ' or an RTG' : ''}, more battery capacity, or drop a power-hungry instrument.`);
  if (p.mass.status !== 'ok') t.push('• Mass: choose a bigger rocket, a lighter bus, fewer spacecraft, or a higher-Isp propulsion system.');
  if (p.budget.status !== 'ok') t.push('• Budget: drop low-relevance instruments, use a cheaper bus/rocket, or shorten the mission.');
  if (p.time.status !== 'ok') t.push(`• Time: ${res.time.limiter.startsWith('Orbit decay') ? 'fly higher or add propulsion for drag make-up' : res.time.limiter.startsWith('Radiation') ? 'use a rad-hard computer or a better-shielded bus' : res.time.limiter.startsWith('Battery') ? 'add battery capacity to reduce depth of discharge' : 'pick parts with shorter lead times or a longer-lived bus'}.`);
  if (res.science.coverageFactor < 0.8 && res.science.revisitDays) t.push('• Coverage: add spacecraft to the fleet or choose wider-swath instruments to cut revisit time.');
  if (sim && sim.anomalies > 0 && res.reliability.subsystems.some((s) => s.r < 0.9)) {
    const weak = res.reliability.subsystems.filter((s) => s.r < 0.9).map((s) => s.label);
    t.push(`• Reliability: add redundancy to ${weak.join(', ')}.`);
  }
  return t.slice(0, 5);
}

export function buildReport(args: {
  runId: string; design: MissionDesign; res: ResourceState; sim: SimResult; mc: MonteCarloResult | null; metrics: TeamMetrics;
  team: { name: string; roles: RoleId[] }[];
}): MissionReport {
  const humanRoles = args.team.map((t) => t.roles);
  const score = computeScore(args.design, args.res, args.sim, args.mc, args.metrics, humanRoles);
  const analysis = analyzeMission(args.design, args.res, args.sim, args.mc);
  return {
    runId: args.runId, createdAt: Date.now(), design: args.design, resources: args.res, sim: args.sim,
    monteCarlo: args.mc ? { runs: args.mc.runs, success: args.mc.success, partial: args.mc.partial, failure: args.mc.failure, meanScience: args.mc.meanScience } : { runs: 0, success: args.res.estimatedSuccess, partial: 0, failure: 1 - args.res.estimatedSuccess, meanScience: args.sim.science },
    score, analysis, team: args.team, metrics: args.metrics,
    matches: matchMissions(args.design, args.res), takeaways: takeaways(args.design, args.res, args.sim),
  };
}

export interface CompareRow { label: string; a: number; b: number; unit: string; better: 'higher' | 'lower' | 'none'; digits?: number }

export function compareRuns(a: MissionRunSave, b: MissionRunSave): CompareRow[] {
  const ra = a.report, rb = b.report;
  const rows: CompareRow[] = [];
  const add = (label: string, va: number | undefined, vb: number | undefined, unit: string, better: CompareRow['better'], digits = 1) => {
    if (va === undefined || vb === undefined) return;
    rows.push({ label, a: va, b: vb, unit, better, digits });
  };
  if (ra && rb) {
    add('Total score', ra.score.total, rb.score.total, 'pts', 'higher', 0);
    add('Success probability', ra.score.successProbability * 100, rb.score.successProbability * 100, '%', 'higher', 0);
    add('Science returned', ra.sim.science, rb.sim.science, 'pts', 'higher', 0);
    add('Operating life', ra.sim.lifetimeYears, rb.sim.lifetimeYears, 'yr', 'higher', 2);
    add('Data lost', ra.sim.dataLostGb, rb.sim.dataLostGb, 'Gb', 'lower', 0);
    add('Anomalies', ra.sim.anomalies, rb.sim.anomalies, '', 'none', 0);
  }
  const A = ra?.resources, B = rb?.resources;
  if (A && B) {
    add('Lifecycle cost', A.cost.total, B.cost.total, '$M', 'lower', 0);
    add('Launch mass', A.mass.launchMassKg, B.mass.launchMassKg, 'kg', 'lower', 0);
    add('Mass margin', A.pillars.mass.margin * 100, B.pillars.mass.margin * 100, '%', 'higher', 0);
    add('Power margin', A.power.marginFrac * 100, B.power.marginFrac * 100, '%', 'higher', 0);
    add('Data generated', A.data.genGbPerDay, B.data.genGbPerDay, 'Gb/day', 'none', 1);
    add('Downlink capacity', A.link.downlinkGbPerDay, B.link.downlinkGbPerDay, 'Gb/day', 'higher', 1);
    add('Predicted lifetime', Math.min(A.time.lifetimeYears, 99), Math.min(B.time.lifetimeYears, 99), 'yr', 'higher', 1);
    add('Launch month', A.time.launchMonth, B.time.launchMonth, 'mo', 'lower', 0);
    add('Science / yr (est.)', A.science.perYear, B.science.perYear, 'pts', 'higher', 1);
  }
  return rows;
}

/** Plain-language list of what changed between two designs. */
export function designDiff(a: MissionDesign, b: MissionDesign): string[] {
  const out: string[] = [];
  const keys: (keyof MissionDesign)[] = ['objectiveId', 'difficulty', 'busId', 'fleetSize', 'launchVehicleId', 'groundNetworkId', 'contactHoursPerDay', 'reservePct', 'missionYears'];
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: ${String(a[k])} → ${String(b[k])}`);
  if (a.orbit.id !== b.orbit.id || a.orbit.altitudeKm !== b.orbit.altitudeKm || a.orbit.ltan !== b.orbit.ltan) out.push(`orbit: ${a.orbit.id} ${a.orbit.altitudeKm} km → ${b.orbit.id} ${b.orbit.altitudeKm} km`);
  const ma = new Map(a.components.map((c) => [c.id, c.qty])), mb = new Map(b.components.map((c) => [c.id, c.qty]));
  for (const [id, q] of mb) if ((ma.get(id) ?? 0) !== q) out.push(`${id}: ${ma.get(id) ?? 0} → ${q}`);
  for (const [id, q] of ma) if (!mb.has(id)) out.push(`${id}: ${q} → 0`);
  const pa = a.presets ?? {}, pb = b.presets ?? {};
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (pa[k] !== pb[k]) out.push(`${k}: ${pa[k] ?? '—'} → ${pb[k] ?? '—'}`);
  return out;
}

/** 3–5 short, plain-language takeaways: why the mission went well or badly. */
export function takeaways(design: MissionDesign, res: ResourceState, sim: SimResult): { icon: string; text: string; good: boolean }[] {
  const out: { icon: string; text: string; good: boolean }[] = [];
  const obj = OBJECTIVE_MAP[design.objectiveId];
  const p = res.pillars;
  const early = sim.daysSimulated <= 2;
  if (/launch failure/i.test(sim.endReason)) out.push({ icon: '🚀', text: 'The rocket failed. Pure bad luck — a more reliable rocket lowers the odds.', good: false });
  else if (early) out.push({ icon: '📡', text: 'Lost right after separation. A sturdier bus deploys more reliably.', good: false });
  if (res.science.missingRequired.length) out.push({ icon: '🔬', text: `Missing a key instrument: needs a ${res.science.missingRequired[0].join(' or ').replace(/_/g, ' ')}.`, good: false });
  const lost = sim.dataLostGb / Math.max(1, sim.dataLostGb + sim.dataReturnedGb);
  if (lost > 0.1) out.push({ icon: '📶', text: `${Math.round(lost * 100)}% of the data never came home — the radio was too slow.`, good: false });
  else if (sim.dataReturnedGb > 0) out.push({ icon: '📶', text: 'The radio kept up: almost all the data reached Earth.', good: true });
  if (!early && sim.lifetimeYears < obj.minLifeYears) out.push({ icon: '⏳', text: `It only worked ${fmt(sim.lifetimeYears, 1)} years — ${res.time.limiter.toLowerCase().split(' (')[0]} ran out first.`, good: false });
  else if (!early && sim.lifetimeYears >= design.missionYears * 0.95) out.push({ icon: '⏳', text: `It lasted the full ${fmt(design.missionYears, 1)}-year mission.`, good: true });
  if (p.power.status === 'crit') out.push({ icon: '⚡', text: 'Not enough power: instruments had to switch off.', good: false });
  else if (res.power.marginFrac > 0.2 && out.length < 4) out.push({ icon: '⚡', text: `Healthy power margin (${Math.round(res.power.marginFrac * 100)}%).`, good: true });
  if (p.budget.status === 'crit') out.push({ icon: '💰', text: 'Over budget — a real review board would not approve it.', good: false });
  else if (p.budget.margin > 0.1 && out.length < 5) out.push({ icon: '💰', text: `Came in ${Math.round(p.budget.margin * 100)}% under budget.`, good: true });
  if (sim.anomalies > 0 && out.length < 5) out.push({ icon: '🛠', text: `${sim.anomaliesSurvived} of ${sim.anomalies} emergencies handled.`, good: sim.anomaliesSurvived >= sim.anomalies * 0.8 });
  const sci = sim.science / Math.max(1, res.science.baseline);
  out.unshift({ icon: sim.outcome === 'success' ? '🏆' : sim.outcome === 'partial' ? '🥈' : '💥', text: `Science: ${Math.round(sci * 100)}% of the goal.`, good: sim.outcome === 'success' });
  return out.slice(0, 5);
}
