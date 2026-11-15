// MISSION CONTROL — locked until the first launch. Then: live telemetry,
// results (success/fail, subsystem breakdown, short "why" takeaways, closest
// real NASA mission) and a 3D replay.
import { useEffect, useState } from 'react';
import { OBJECTIVE_MAP, ORBIT_MAP } from '../../../shared/data/mission';
import type { MissionReport, ResourceKey, TelemetryPoint } from '../../../shared/types';
import { MCC_LOCKED } from '../../game/dialogues';
import { saveJsonFile } from '../../net/claudeHost';
import { skipToEnd, skipToNextEvent } from '../../state/simController';
import { useStore } from '../../state/store';
import { LineChart } from '../widgets/LineChart';
import { PanelFrame, RoleChip, Section, STATUS_COLOR, money, n, pct } from '../widgets/common';
import { BAR_ICON, BAR_LABEL, barStatus } from '../widgets/tips';
import { MissionViz3D } from './MissionViz3D';

export function MCCPanel({ tab }: { tab?: string }) {
  const room = useStore((s) => s.room)!;
  const unlocked = useStore((s) => s.mccUnlocked)();
  const openPanel = useStore((s) => s.openPanel);
  const [t, setT] = useState(tab ?? (room.phase === 'sim' ? 'live' : 'results'));
  useEffect(() => { if (tab) setT(tab); }, [tab]);
  if (!unlocked) {
    return (
      <PanelFrame title="MISSION CONTROL" icon="🖥" subtitle="Standing by">
        <div className="max-w-[560px] mx-auto text-center py-8">
          <div className="text-[64px]">🔒</div>
          <div className="font-pixel text-[11px] text-warn blink-slow mt-2">STANDBY</div>
          <p className="text-[22px] leading-snug mt-3">{MCC_LOCKED}</p>
          <button className="px-btn primary mt-4" onClick={() => openPanel('mission', 'build')}>🛰 GO TO SPACE MISSION</button>
        </div>
      </PanelFrame>
    );
  }
  return (
    <PanelFrame wide title="MISSION CONTROL" icon="🖥" subtitle={room.phase === 'sim' ? 'Live flight — everyone sees the same mission.' : 'Results of your latest flight.'}
      tabs={[{ id: 'live', label: '📈 LIVE' }, { id: 'results', label: '🏁 RESULTS' }, { id: 'replay', label: '🌐 3D REPLAY' }]} tab={t} onTab={setT}>
      {t === 'live' && <LiveView onResults={() => setT('results')} />}
      {t === 'results' && <ResultsView />}
      {t === 'replay' && <MissionViz3D />}
    </PanelFrame>
  );
}

function tel(points: TelemetryPoint[], f: (t: TelemetryPoint) => number): [number, number][] { return points.map((t) => [t.day, f(t)]); }

export function TelemetryCharts({ points, res, height = 110, cruiseDays = 0 }: { points: TelemetryPoint[]; res: MissionReport['resources']; height?: number; cruiseDays?: number }) {
  const mk = cruiseDays ? [{ x: cruiseDays, color: '#f2c14e', label: 'Arrival' }] : [];
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">⚡ POWER (W)</div><LineChart height={height} markers={mk} series={[{ name: 'Made', color: '#fbbf24', points: tel(points, (t) => t.powerGenW) }, { name: 'Used', color: '#f87171', points: tel(points, (t) => t.powerLoadW) }]} format={(v) => v.toFixed(0)} /></div>
      <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">📡 DATA (Gb/day)</div><LineChart height={height} markers={mk} series={[{ name: 'Sent home', color: '#58b8f8', points: tel(points, (t) => t.downlinkGb) }, { name: 'Collected', color: '#c878f8', points: tel(points, (t) => t.generatedGb) }]} format={(v) => (v < 10 ? v.toFixed(2) : v.toFixed(0))} /></div>
      <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">🔬 SCIENCE</div><LineChart height={height} markers={mk} series={[{ name: 'Science', color: '#4ade80', points: tel(points, (t) => t.scienceCum), area: true }]} refLines={[{ y: res.science.baseline * 0.75, color: '#4ade80', label: 'success' }, { y: res.science.threshold, color: '#fbbf24', label: 'minimum' }]} format={(v) => v.toFixed(0)} /></div>
      <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">⛽ FUEL (kg) · ❤ HEALTH (%)</div><LineChart height={height} markers={mk} series={[{ name: 'Fuel', color: '#58b8f8', points: tel(points, (t) => t.propellantKg) }, { name: 'Health', color: '#4ade80', points: tel(points, (t) => t.health * 100) }]} format={(v) => v.toFixed(0)} /></div>
    </div>
  );
}

function LiveView({ onResults }: { onResults: () => void }) {
  const room = useStore((s) => s.room)!;
  const sim = useStore((s) => s.sim);
  const res = useStore((s) => s.resources)!;
  const send = useStore((s) => s.send);
  const setSim = useStore((s) => s.setSim);
  const openPanel = useStore((s) => s.openPanel);
  const canFD = useStore((s) => s.can)('director');
  if (!sim || !room.sim) return (
    <div className="text-center py-10">
      <div className="font-pixel text-[11px] text-muted">NOTHING IN FLIGHT</div>
      <p className="text-[20px] mt-2">Your last flight is in RESULTS. Launch again from the Space Mission building.</p>
      <div className="flex gap-2 justify-center mt-3"><button className="px-btn" onClick={onResults}>🏁 RESULTS</button><button className="px-btn primary" onClick={() => openPanel('mission', 'build')}>🛰 SPACE MISSION</button></div>
    </div>
  );
  const pts = sim.telemetry;
  const last = pts[pts.length - 1];
  const inCruise = sim.day < sim.cruiseDays;
  const target = ORBIT_MAP[room.design.orbit.id].targetBody;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="font-pixel text-[11px] text-gold">DAY {n(sim.day, 0)} / {n(sim.totalDays, 0)}</div>
        <span className="text-[18px] text-muted">{inCruise ? `🛰 cruising to ${target}` : '🔬 doing science'}{last ? ` · ${last.working} working` : ''}</span>
        <div className="flex-1" />
        <button className="px-btn sm" onClick={() => setSim({ playing: !sim.playing })} disabled={sim.done}>{sim.playing ? '❚❚' : '▶'}</button>
        {[[30, '1×'], [90, '3×'], [365, '12×']].map(([s, l]) => <button key={s} className={`px-btn sm ${sim.speed === s ? 'gold' : 'ghost'}`} onClick={() => setSim({ speed: s as number })}>{l}</button>)}
        <button className="px-btn sm" onClick={skipToNextEvent} disabled={sim.done || !!sim.pending}>NEXT ⏭</button>
        <button className="px-btn sm" onClick={skipToEnd} disabled={sim.done || !!sim.pending}>END ⏭⏭</button>
      </div>
      <div className="h-[14px] bg-black/60 border-2 border-black mb-3 relative">
        <div className="h-full bg-accent" style={{ width: `${(100 * sim.day) / sim.totalDays}%` }} />
        {sim.cruiseDays > 0 && <div className="absolute inset-y-0 w-[2px] bg-gold" style={{ left: `${(100 * sim.cruiseDays) / sim.totalDays}%` }} title="Arrival" />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <Tile icon="🔬" label="Science" value={`${n(sim.science, 0)} / ${n(res.science.baseline, 0)}`} color={sim.science >= res.science.baseline * 0.75 ? '#4ade80' : undefined} />
        <Tile icon="🔋" label="Battery" value={last ? pct(last.batterySoc) : '—'} />
        <Tile icon="⛽" label="Fuel" value={last ? `${n(last.propellantKg, 0)} kg` : '—'} />
        <Tile icon="❤" label="Health" value={last ? pct(last.health) : '—'} color={last && last.health < 0.7 ? '#fbbf24' : undefined} />
      </div>
      {sim.pending && <div className="px-inset p-2 mb-3 text-[19px] text-warn blink-slow">⚠ Emergency: {sim.pending.title}</div>}
      {sim.done && (
        <div className="px-inset p-3 mb-3 flex flex-wrap items-center gap-3" style={{ borderLeft: `6px solid ${sim.result?.outcome === 'success' ? '#4ade80' : sim.result?.outcome === 'partial' ? '#fbbf24' : '#f87171'}` }}>
          <span className="font-pixel text-[12px]">{sim.result?.outcome.toUpperCase()}</span>
          <span className="text-[18px] flex-1">{sim.result?.endReason}</span>
          {sim.report ? <button className="px-btn primary" onClick={onResults}>SEE RESULTS ▶</button> : <span className="text-[17px] text-muted">Running 100 what-if futures… {pct(sim.mcProgress)}</span>}
        </div>
      )}
      <TelemetryCharts points={pts} res={res} cruiseDays={sim.cruiseDays} />
      <Section title="Flight log" className="mt-3">
        <div className="max-h-[200px] overflow-y-auto scroll-thin text-[17px]">
          {[...sim.events].reverse().slice(0, 30).map((e, i) => (
            <div key={i} className="py-[2px] border-b border-line/40"><span className="text-muted">d{n(e.day, 0)}</span> <b style={{ color: STATUS_COLOR[e.severity] }}>{e.title}</b> — {e.text.split(/(?<=\.)\s/)[0]}</div>
          ))}
        </div>
      </Section>
      {!sim.done && canFD && <button className="px-btn sm danger mt-2" onClick={() => useStore.getState().confirmAction('Abort this flight and go back to design?', 'ABORT', () => send({ t: 'resetSim' }))}>ABORT FLIGHT</button>}
    </>
  );
}

function Tile({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return <div className="px-inset px-2 py-1"><div className="text-[15px] text-muted">{icon} {label}</div><div className="text-[22px] leading-tight" style={{ color }}>{value}</div></div>;
}

function ResultsView() {
  const sim = useStore((s) => s.sim);
  const runs = useStore((s) => s.vaultRuns);
  const room = useStore((s) => s.room)!;
  const send = useStore((s) => s.send);
  const openPanel = useStore((s) => s.openPanel);
  const canFD = useStore((s) => s.can)('director');
  const rep = sim?.report ?? runs.find((r) => r.report && r.design.objectiveId === room.design.objectiveId)?.report ?? runs.find((r) => r.report)?.report;
  if (!rep) return <div className="text-center py-10 text-[20px] text-muted">{sim && !sim.done ? 'Still flying — results appear when the mission ends.' : sim?.done ? `Crunching the numbers… ${pct(sim.mcProgress)}` : 'No results yet.'}</div>;
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3 no-print">
        {canFD && room.phase === 'done' && <button className="px-btn primary" onClick={() => { send({ t: 'resetSim' }); openPanel('mission', 'build'); }}>🔧 TWEAK & FLY AGAIN</button>}
        <button className="px-btn" onClick={() => openPanel('archives', 'runs')}>🗄 ARCHIVES</button>
        <button className="px-btn ghost" onClick={async () => { const r = await saveJsonFile(`mission-report-${rep.runId}.json`, JSON.stringify(rep, null, 2)); useStore.getState().toast(r === 'failed' ? 'Export was not saved.' : 'Report exported.', r === 'failed' ? 'warn' : 'ok'); }}>⬇ EXPORT</button>
      </div>
      <ReportBody rep={rep} />
    </>
  );
}

const KEYS: ResourceKey[] = ['mass', 'power', 'budget', 'data', 'comms', 'time'];

export function ReportBody({ rep, compact = false }: { rep: MissionReport; compact?: boolean }) {
  const S = rep.score;
  const obj = OBJECTIVE_MAP[rep.design.objectiveId];
  const col = rep.sim.outcome === 'success' ? '#4ade80' : rep.sim.outcome === 'partial' ? '#fbbf24' : '#f87171';
  const [details, setDetails] = useState(false);
  const top = rep.matches?.[0];
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-3 mb-3">
        <div className="px-inset p-3 text-center min-w-[170px]" style={{ borderTop: `6px solid ${col}` }}>
          <div className="text-[44px] leading-none">{rep.sim.outcome === 'success' ? '🏆' : rep.sim.outcome === 'partial' ? '🥈' : '💥'}</div>
          <div className="font-pixel text-[11px] mt-1" style={{ color: col }}>{rep.sim.outcome === 'success' ? 'SUCCESS' : rep.sim.outcome === 'partial' ? 'PARTIAL' : 'FAILED'}</div>
          <div className="font-pixel text-[26px] text-gold mt-1">{S.total}</div>
          <div className="font-pixel text-[8px] text-muted">GRADE {S.grade}</div>
        </div>
        <div className="flex-1 min-w-[260px]">
          <div className="font-pixel text-[10px] text-gold">{obj.icon} {obj.name.toUpperCase()}</div>
          <div className="text-[17px] text-muted mb-2">{rep.sim.endReason}</div>
          <div className="font-pixel text-[8px] text-accent mb-1">WHY IT WENT THIS WAY</div>
          <div className="grid gap-1">
            {(rep.takeaways ?? []).map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-[18px] leading-tight"><span className="w-6 text-center">{t.icon}</span><span style={{ color: t.good ? '#c8f0d0' : '#ffd0d0' }}>{t.text}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="px-inset p-2">
          <div className="font-pixel text-[8px] text-accent mb-2">SUBSYSTEMS (chance each survives)</div>
          {rep.resources.reliability.subsystems.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-[16px] mb-1">
              <span className="w-[160px] truncate">{s.label}</span>
              <div className="flex-1 h-[10px] bg-black border border-black"><div className="h-full" style={{ width: `${s.r * 100}%`, background: s.r > 0.9 ? '#4ade80' : s.r > 0.75 ? '#fbbf24' : '#f87171' }} /></div>
              <span className="w-10 text-right text-muted">{pct(s.r)}</span>
            </div>
          ))}
        </div>
        <div className="px-inset p-2">
          <div className="font-pixel text-[8px] text-accent mb-2">RESOURCES AT LAUNCH</div>
          <div className="grid grid-cols-3 gap-1">
            {KEYS.map((k) => { const s = barStatus(k, rep.resources); return (
              <div key={k} className="text-center p-1 border-2 border-black" style={{ background: `${STATUS_COLOR[s]}22` }}>
                <div className="text-[20px]">{BAR_ICON[k]}</div><div className="font-pixel text-[6px]" style={{ color: STATUS_COLOR[s] }}>{BAR_LABEL[k].toUpperCase()}</div>
              </div>
            ); })}
          </div>
          <div className="grid grid-cols-2 gap-1 mt-2 text-[16px]">
            <div>🔬 {n(rep.sim.science, 0)} / {n(rep.resources.science.baseline, 0)} pts</div>
            <div>⏳ {n(rep.sim.lifetimeYears, 1)} yr flown</div>
            <div>💰 {money(rep.resources.cost.total)}</div>
            <div>🎲 {pct(rep.monteCarlo.success)} of 100 futures succeed</div>
          </div>
        </div>
      </div>
      {top && (
        <div className="px-inset p-3 mb-3" style={{ borderLeft: '6px solid #f2c14e' }}>
          <div className="font-pixel text-[8px] text-accent">CLOSEST REAL NASA MISSION</div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1"><span className="font-pixel text-[12px] text-gold">★ {top.name}</span><span className="text-[16px] text-muted">{top.status} · {Math.round(top.similarity * 100)}% match</span></div>
          <div className="text-[18px] mt-1">{top.lore}</div>
          {top.why.length > 0 && <div className="text-[15px] text-ok mt-1">Shared: {top.why.join(' · ')}</div>}
          {rep.matches!.length > 1 && <div className="text-[15px] text-muted mt-1">Also like: {rep.matches!.slice(1).map((m) => `${m.name} (${Math.round(m.similarity * 100)}%)`).join(', ')}</div>}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {([['🎲 Success', S.pts.success], ['🔬 Science', S.pts.science], ['💡 Efficiency', S.pts.efficiency], ['🤝 Teamwork', S.pts.coordination]] as [string, number][]).map(([l, v]) => (
          <div key={l} className="px-inset px-2 py-1"><div className="text-[15px] text-muted">{l}</div><div className="text-[22px]">{n(v, 0)} pts</div></div>
        ))}
      </div>
      {!compact && (
        <>
          <button className="px-btn sm ghost mb-2" onClick={() => setDetails(!details)}>{details ? '▲ HIDE DETAILS' : '▼ ENGINEER DETAILS'}</button>
          {details && (
            <>
              <TelemetryCharts points={rep.sim.telemetry} res={rep.resources} height={100} />
              <Section title="Engineering notes" className="mt-3">
                {rep.analysis.map((a, i) => <div key={i} className="px-inset p-2 mb-1" style={{ borderLeft: `4px solid ${STATUS_COLOR[a.severity]}` }}><span className="font-pixel text-[8px]" style={{ color: STATUS_COLOR[a.severity] }}>{a.title}</span> <span className="text-[16px]">{a.text.split(/(?<=\.)\s/).slice(0, 2).join(' ')}</span></div>)}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Emergency decision overlay (visible anywhere on campus) ───────────────────
export function DecisionOverlay() {
  const sim = useStore((s) => s.sim);
  const room = useStore((s) => s.room);
  const send = useStore((s) => s.send);
  const canOps = useStore((s) => s.can)('ops');
  const [min, setMin] = useState(false);
  const p = sim?.pending;
  useEffect(() => setMin(false), [p?.index]);
  if (!p || !room?.sim || room.sim.decisions[p.index] !== undefined) return null;
  const opsHolder = Object.values(room.players).find((x) => x.roles.includes('ops'));
  if (min) return <button className="fixed z-40 left-1/2 -translate-x-1/2 bottom-24 px-btn danger pulse-crit no-print" onClick={() => setMin(false)}>⚠ EMERGENCY: {p.title}</button>;
  return (
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/60 p-3 no-print">
      <div className="px-frame max-w-[600px] w-full p-4 slide-up" style={{ borderTop: '6px solid #f87171' }}>
        <div className="font-pixel text-[9px] text-crit blink">⚠ EMERGENCY · DAY {n(p.day, 0)}</div>
        <div className="font-pixel text-[12px] text-gold mt-2">{p.title}</div>
        <div className="text-[20px] leading-snug mt-2">{p.text}</div>
        <div className="flex flex-col gap-2 mt-3">
          {p.choices.map((c) => (
            <button key={c.id} className={`text-left p-2 border-2 ${c.id === p.recommended ? 'border-ok' : 'border-black'} bg-[#0e1530] hover:bg-[#16204a] disabled:opacity-60`} disabled={!canOps}
              onClick={() => send({ t: 'decide', index: p.index, choice: c.id, waitedMs: Date.now() - (sim!.pendingSince || Date.now()) })}>
              <div className="font-pixel text-[9px]">{c.label}{c.id === p.recommended && <span className="text-ok"> · SUGGESTED</span>}</div>
              <div className="text-[17px] text-muted mt-1">{c.detail}</div>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 text-[17px]">
          {canOps ? <span className="text-muted">Your call{Object.keys(room.players).length > 1 ? <> as <RoleChip role="ops" /></> : ''}.</span> : <span className="text-warn">Waiting for {opsHolder ? `${opsHolder.name} (Ops)` : 'the Ops lead'}…</span>}
          <div className="flex-1" />
          <button className="px-btn sm ghost" onClick={() => setMin(true)}>MINIMIZE</button>
        </div>
      </div>
    </div>
  );
}
