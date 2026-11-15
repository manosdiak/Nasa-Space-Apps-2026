// ARCHIVES — every past run: score, flight time, setup and the key lesson.
// Load a run, tweak it (branch) and fly again, or compare two runs side by side.
import { useEffect, useMemo, useState } from 'react';
import { COMPONENT_MAP } from '../../../shared/data/components';
import { LV_MAP, OBJECTIVE_MAP, ORBIT_MAP } from '../../../shared/data/mission';
import { presetsFor } from '../../../shared/data/missionPresets';
import { uid } from '../../../shared/engine/rng';
import { compareRuns, designDiff } from '../../../shared/engine/score';
import type { MissionDesign, MissionRunSave } from '../../../shared/types';
import { copyText } from '../../net/claudeHost';
import { teamOf, useStore } from '../../state/store';
import { decodeShare, encodeShare, vault } from '../../state/vault';
import { LineChart } from '../widgets/LineChart';
import { Delta, PanelFrame, money, n } from '../widgets/common';
import { ReportBody } from './MCC';

export function ArchivesPanel({ tab }: { tab?: string }) {
  const [t, setT] = useState(tab ?? 'runs');
  useEffect(() => { if (tab) setT(tab); }, [tab]);
  const runs = useStore((s) => s.vaultRuns);
  return (
    <PanelFrame wide title="ARCHIVES" icon="🗄" subtitle="Every run you fly is saved here."
      tabs={[{ id: 'runs', label: `📜 RUNS (${runs.length})` }, { id: 'compare', label: '⚖ COMPARE' }]} tab={t} onTab={setT}>
      {t === 'runs' && <Runs onCompare={() => setT('compare')} />}
      {t === 'compare' && <Compare />}
    </PanelFrame>
  );
}

/** Short setup summary: the preset picks (Easy/Medium) or bus · orbit · rocket (Hard). */
export function setupSummary(d: MissionDesign): string {
  const p = presetsFor(d.objectiveId, d.difficulty);
  if (p) return p.set.slots.map((s) => { const o = s.options.find((x) => x.id === d.presets?.[s.id]); return o ? `${s.icon} ${o.label}` : null; }).filter(Boolean).join(' · ');
  return `🛰 ${COMPONENT_MAP[d.busId]?.name ?? d.busId}${d.fleetSize > 1 ? ` ×${d.fleetSize}` : ''} · 🪐 ${ORBIT_MAP[d.orbit.id]?.name ?? d.orbit.id} · 🚀 ${LV_MAP[d.launchVehicleId]?.name ?? d.launchVehicleId} · ${d.components.reduce((a, c) => a + c.qty, 0)} parts`;
}

function Runs({ onCompare }: { onCompare: () => void }) {
  const runs = useStore((s) => s.vaultRuns);
  const refresh = useStore((s) => s.refreshVault);
  const room = useStore((s) => s.room)!;
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const canFD = useStore((s) => s.can)('director');
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const [view, setView] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const load = (r: MissionRunSave, branch: boolean) => {
    const go = () => { send({ t: 'loadRun', save: { ...r, report: undefined }, branch }); useStore.getState().openPanel('mission', 'build'); };
    if (room.phase === 'sim') useStore.getState().confirmAction('Loading a run stops the current flight.', branch ? 'TWEAK' : 'LOAD', go);
    else go();
  };
  const snapshot = () => {
    vault.save({ schema: 1, id: uid('snap-'), name: `${OBJECTIVE_MAP[room.design.objectiveId].short} draft ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, savedAt: Date.now(), design: room.design, modifiers: room.modifiers, designEvents: room.designEvents, decisions: [], team: teamOf(room) });
    refresh(); toast('Design saved.', 'ok');
  };
  const importCode = async () => {
    try {
      const d = await decodeShare(code);
      vault.save({ schema: 1, id: uid('imp-'), name: `${d.name} (shared)`, savedAt: Date.now(), design: d.design, modifiers: d.modifiers, designEvents: d.designEvents, decisions: [], team: [] });
      refresh(); setCode(''); toast('Shared design added.', 'ok');
    } catch (e) { toast(`Not a valid code: ${(e as Error).message}`, 'crit'); }
  };
  const share = async (r: MissionRunSave) => toast((await copyText(await encodeShare(r))) ? 'Share code copied — paste it to a friend.' : 'Copy was blocked.', 'ok');
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="px-btn sm primary" onClick={snapshot}>💾 SAVE CURRENT DESIGN</button>
        <input className="px-input flex-1 min-w-[180px] text-[16px]" placeholder="Paste a share code…" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="px-btn sm" disabled={!code.trim()} onClick={importCode}>IMPORT</button>
      </div>
      {room.branchOf && <div className="px-inset p-2 mb-2 text-[18px]">🔧 You are tweaking <b className="text-gold">{room.branchOf.name}</b>. Fly it, then compare.</div>}
      <div className="grid gap-2">
        {runs.map((r) => {
          const rep = r.report;
          const obj = OBJECTIVE_MAP[r.design.objectiveId];
          const col = rep ? (rep.sim.outcome === 'success' ? '#4ade80' : rep.sim.outcome === 'partial' ? '#fbbf24' : '#f87171') : '#9aa6d0';
          const lesson = rep?.takeaways?.find((t) => !t.good) ?? rep?.takeaways?.[1] ?? rep?.takeaways?.[0];
          return (
            <div key={r.id} className="px-inset p-2" style={{ borderLeft: `6px solid ${col}` }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[22px]">{obj?.icon ?? '🛰'}</span>
                <span className="font-pixel text-[9px] text-cream">{r.name}</span>
                {rep ? <span className="font-pixel text-[8px]" style={{ color: col }}>{rep.sim.outcome.toUpperCase()} · {rep.score.total} pts · {rep.score.grade}</span> : <span className="font-pixel text-[8px] text-muted">DRAFT</span>}
                {r.parentName && <span className="text-[15px] text-[#d8a8f8]">🔧 tweak of {r.parentName}</span>}
                <div className="flex-1" />
                <span className="text-[15px] text-muted">{new Date(r.savedAt).toLocaleDateString()}</span>
              </div>
              {rep && <div className="text-[16px] mt-1">⏱ {n(rep.sim.daysSimulated, 0)} days flown · 🔬 {n(rep.sim.science, 0)} pts · 💰 {money(rep.resources.cost.total)}</div>}
              <div className="text-[15px] text-muted leading-tight mt-1">{setupSummary(r.design)}</div>
              {lesson && <div className="text-[16px] mt-1" style={{ color: lesson.good ? '#c8f0d0' : '#ffd0d0' }}>{lesson.icon} {lesson.text}</div>}
              <div className="flex flex-wrap gap-1 mt-2">
                {rep && <button className="px-btn sm" onClick={() => setView(view === r.id ? null : r.id)}>{view === r.id ? 'HIDE' : 'VIEW'}</button>}
                <button className="px-btn sm" disabled={!canFD} onClick={() => load(r, false)} title={canFD ? 'Load this setup' : 'Flight Director only'}>LOAD</button>
                <button className="px-btn sm gold" disabled={!canFD} onClick={() => load(r, true)} title={canFD ? 'Load it, change something, fly again' : 'Flight Director only'}>🔧 TWEAK</button>
                <button className={`px-btn sm ${compare[0] === r.id ? 'primary' : 'ghost'}`} onClick={() => setCompare(0, compare[0] === r.id ? null : r.id)}>A</button>
                <button className={`px-btn sm ${compare[1] === r.id ? 'primary' : 'ghost'}`} onClick={() => setCompare(1, compare[1] === r.id ? null : r.id)}>B</button>
                {compare[0] && compare[1] && (compare[0] === r.id || compare[1] === r.id) && <button className="px-btn sm" onClick={onCompare}>COMPARE ▶</button>}
                <button className="px-btn sm ghost" onClick={() => share(r)}>📋 SHARE</button>
                <button className="px-btn sm danger" onClick={() => useStore.getState().confirmAction(`Delete "${r.name}"?`, 'DELETE', () => { vault.remove(r.id); refresh(); })}>✕</button>
              </div>
              {view === r.id && rep && <div className="mt-3 px-frame p-3"><ReportBody rep={rep} compact /></div>}
            </div>
          );
        })}
        {!runs.length && <div className="text-center py-8 text-[20px] text-muted">📭 No runs yet. Launch a mission and it will appear here.</div>}
      </div>
    </>
  );
}

function Compare() {
  const runs = useStore((s) => s.vaultRuns);
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const a = runs.find((r) => r.id === compare[0]);
  const b = runs.find((r) => r.id === compare[1]);
  const rows = useMemo(() => (a && b ? compareRuns(a, b) : []), [a, b]);
  const diff = useMemo(() => (a && b ? designDiff(a.design, b.design) : []), [a, b]);
  const series = (r: MissionRunSave | undefined, color: string, label: string, f: (t: NonNullable<MissionRunSave['report']>['sim']['telemetry'][number]) => number, dashed = false) =>
    r?.report ? [{ name: label, color, dashed, points: r.report.sim.telemetry.map((t) => [t.day, f(t)] as [number, number]) }] : [];
  const pick = (slot: 0 | 1) => (
    <label className="flex items-center gap-2"><span className="font-pixel text-[11px] text-gold w-4">{slot ? 'B' : 'A'}</span>
      <select className="px-input flex-1 min-w-0" value={compare[slot] ?? ''} onChange={(e) => setCompare(slot, e.target.value || null)}>
        <option value="">— choose a run —</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name}{r.report ? ` · ${r.report.score.total}` : ''}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-2 mb-3">{pick(0)}{pick(1)}</div>
      {!(a && b) && <div className="text-[19px] text-muted text-center py-6">Pick two runs. Tip: TWEAK one thing, fly again, then compare.</div>}
      {a && b && (
        <>
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            {[a, b].map((r, i) => (
              <div key={r.id} className="px-inset p-2">
                <div className="font-pixel text-[9px] text-gold">{i ? 'B' : 'A'} · {r.name}</div>
                <div className="text-[22px]">{r.report ? `${r.report.score.total} pts · ${r.report.sim.outcome}` : 'draft'}</div>
                <div className="text-[15px] text-muted leading-tight">{setupSummary(r.design)}</div>
              </div>
            ))}
          </div>
          <div className="px-inset p-2 mb-3">
            <div className="font-pixel text-[8px] text-accent mb-1">WHAT CHANGED</div>
            {diff.length ? <div className="text-[17px] grid sm:grid-cols-2 gap-x-4">{diff.slice(0, 12).map((x) => <div key={x}>▸ {x}</div>)}</div> : <div className="text-muted text-[17px]">Same design — only luck was different.</div>}
          </div>
          <table className="w-full text-[18px] mb-3">
            <thead><tr className="font-pixel text-[8px] text-muted text-left"><th className="p-1">METRIC</th><th className="p-1 text-right">A</th><th className="p-1 text-right">B</th><th className="p-1 text-right">B − A</th></tr></thead>
            <tbody>{rows.slice(0, 12).map((r) => <tr key={r.label} className="border-t border-line/50"><td className="p-1">{r.label}</td><td className="p-1 text-right">{n(r.a, r.digits)}{r.unit && ` ${r.unit}`}</td><td className="p-1 text-right">{n(r.b, r.digits)}{r.unit && ` ${r.unit}`}</td><td className="p-1 text-right"><Delta v={r.b - r.a} better={r.better} d={r.digits} unit={r.unit ? ` ${r.unit}` : ''} /></td></tr>)}</tbody>
          </table>
          {a.report && b.report && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">🔬 SCIENCE</div><LineChart height={120} series={[...series(a, '#9aa6d0', 'A', (t) => t.scienceCum, true), ...series(b, '#4ade80', 'B', (t) => t.scienceCum)]} format={(v) => v.toFixed(0)} /></div>
              <div className="px-inset p-2"><div className="font-pixel text-[8px] text-muted mb-1">💰 COST ($M)</div><LineChart height={120} series={[...series(a, '#9aa6d0', 'A', (t) => t.costCum, true), ...series(b, '#ef6f6c', 'B', (t) => t.costCum)]} format={(v) => v.toFixed(0)} /></div>
            </div>
          )}
        </>
      )}
    </>
  );
}
