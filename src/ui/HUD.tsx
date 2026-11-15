import { useState } from 'react';
import { LEVEL_INFO, OBJECTIVE_MAP, ROLE_MAP } from '../../shared/data/mission';
import type { ResourceKey, Status } from '../../shared/types';
import { useStore } from '../state/store';
import { AvatarIcon } from './widgets/AvatarIcon';
import { STATUS_COLOR, money, n, pct } from './widgets/common';
import { BAR_HELP, BAR_ICON, BAR_LABEL, barStatus, barTip } from './widgets/tips';

interface Live { key: ResourceKey; label: string; status: Status; util: number; value: string; summary: string; why: string[]; bottleneck: boolean; critical: boolean }

function useLivePillars(): Live[] | null {
  const res = useStore((s) => s.resources);
  const sim = useStore((s) => s.sim);
  const room = useStore((s) => s.room);
  if (!res || !room) return null;
  const P = res.pillars;
  const base: Live[] = (Object.keys(P) as ResourceKey[]).map((k) => ({
    key: k, label: BAR_LABEL[k], status: barStatus(k, res), util: P[k].utilization, bottleneck: P[k].bottleneck, critical: P[k].critical, summary: barTip(k, res), why: P[k].why.slice(0, 1),
    value: k === 'mass' ? `${n(P.mass.used, 0)}/${n(P.mass.capacity, 0)} kg` : k === 'power' ? `${n(P.power.capacity, 0)}/${n(P.power.used, 0)} W` : k === 'budget' ? `${money(P.budget.used)}${room.design.difficulty === 'sandbox' ? '' : `/${money(P.budget.capacity)}`}`
      : k === 'data' ? `${n(res.data.genGbPerDay, 1)} Gb/d` : k === 'comms' ? `${n(res.link.downlinkGbPerDay, 1)} Gb/d` : `M${n(res.time.launchMonth, 0)} · ${Number.isFinite(res.time.lifetimeYears) ? n(res.time.lifetimeYears, 1) : '∞'}y`,
  }));
  const t = sim?.telemetry[sim.telemetry.length - 1];
  if (!sim || !t || room.phase === 'design') return base;
  const st = (bad: boolean, tight: boolean): Status => (bad ? 'crit' : tight ? 'warn' : 'ok');
  const map: Record<ResourceKey, Partial<Live>> = {
    mass: { value: `${n(t.massKg, 0)} kg · prop ${n(t.propellantKg, 1)}`, status: st(res.mass.propellantKg > 0 && t.propellantKg < 0.02 * res.mass.propellantKg, res.mass.propellantKg > 0 && t.propellantKg < 0.15 * res.mass.propellantKg), util: res.mass.propellantKg ? 1 - t.propellantKg / res.mass.propellantKg : 0, summary: 'Live: spacecraft mass and remaining propellant.' },
    power: { value: `${n(t.powerGenW, 0)}/${n(t.powerLoadW, 0)} W`, status: st(t.powerGenW < t.powerLoadW * 0.95, t.batterySoc < 0.5), util: t.powerGenW ? t.powerLoadW / t.powerGenW : 1, summary: `Live: generation vs. load · battery ${pct(t.batterySoc)} state of charge after eclipse.` },
    budget: { value: `${money(t.costCum)}`, status: st(room.design.difficulty !== 'sandbox' && t.costCum > res.cost.cap, false), util: t.costCum / res.cost.cap, summary: 'Live: money spent so far (development + launch + operations + anomaly responses).' },
    data: { value: `${n(t.bufferGb, 1)}/${n(t.storageGb, 0)} Gb`, status: st(t.storageGb > 0 && t.bufferGb > 0.9 * t.storageGb, t.storageGb > 0 && t.bufferGb > 0.6 * t.storageGb), util: t.storageGb ? t.bufferGb / t.storageGb : 0, summary: 'Live: onboard recorder fill level.' },
    comms: { value: `${n(t.downlinkGb, 1)} Gb/d · ${n(t.rateMbps, t.rateMbps < 1 ? 3 : 1)} Mbps`, status: st(t.downlinkGb < t.generatedGb * 0.8, t.downlinkGb < t.generatedGb), util: t.downlinkGb ? t.generatedGb / t.downlinkGb : 0, summary: 'Live: downlink capacity today vs. data generated today.' },
    time: { value: `Day ${n(t.day, 0)}/${n(sim.totalDays, 0)}`, status: st(t.working === 0, t.health < 0.7), util: t.day / sim.totalDays, summary: `Live: mission day · ${t.working} spacecraft working · instrument health ${pct(t.health)}.` },
  };
  return base.map((b) => ({ ...b, ...map[b.key], why: [] }));
}

function Gauge({ p }: { p: Live }) {
  const [hover, setHover] = useState(false);
  const color = STATUS_COLOR[p.status];
  const w = Math.max(3, Math.min(100, (Number.isFinite(p.util) ? p.util : 2) * 100));
  return (
    <div className={`relative px-inset px-2 py-1 min-w-0 cursor-help ${p.bottleneck ? (p.status === 'crit' ? 'pulse-crit' : 'pulse-warn') : ''}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => setHover((h) => !h)} tabIndex={0} aria-label={`${p.label}: ${p.summary}`}>
      <div className="flex items-center gap-1 leading-none">
        <span className="text-[14px]">{BAR_ICON[p.key]}</span>
        <span className="font-pixel text-[8px]" style={{ color }}>{p.label.toUpperCase()}</span>
        {p.critical && <span className="text-gold text-[13px]" title="Critical for this objective">★</span>}
        {p.bottleneck && <span className="font-pixel text-[6px] text-ink bg-warn px-[3px] py-[1px] hidden lg:inline">LIMIT</span>}
      </div>
      <div className="h-[6px] mt-[3px] bg-black/60 border border-black"><div className="h-full" style={{ width: `${w}%`, background: color }} /></div>
      <div className="text-[15px] leading-tight truncate mt-[1px]">{p.value}</div>
      {hover && (
        <div className="absolute left-0 top-full mt-2 z-50 w-[320px] max-w-[90vw] px-frame-light p-2 text-[17px] leading-snug">
          <div className="font-pixel text-[9px] mb-1">{p.label} {p.critical && '★ key for this mission'}</div>
          <div className="text-[#3a3a50] mb-1">{BAR_HELP[p.key]}</div>
          <div><b>{p.summary}</b></div>
        </div>
      )}
    </div>
  );
}

export function HUD() {
  const room = useStore((s) => s.room);
  const res = useStore((s) => s.resources);
  const roomId = useStore((s) => s.roomId);
  const mode = useStore((s) => s.mode);
  const status = useStore((s) => s.status);
  const me = useStore((s) => s.playerId);
  const unread = useStore((s) => s.unread);
  const openPanel = useStore((s) => s.openPanel);
  const sim = useStore((s) => s.sim);
  const pillars = useLivePillars();
  const openSelect = useStore((s) => s.openSelect);
  const can = useStore((s) => s.can);
  if (!room || !res || !pillars) return null;
  const obj = OBJECTIVE_MAP[room.design.objectiveId];
  const lvl = LEVEL_INFO[obj.level];
  const players = Object.values(room.players);
  const est = sim?.report ? sim.report.score.successProbability : res.estimatedSuccess;
  return (
    <div className="fixed top-0 inset-x-0 z-20 p-1 sm:p-2 pointer-events-none no-print">
      <div className="px-frame pointer-events-auto flex flex-col lg:flex-row gap-1 lg:items-stretch p-1">
        <button className="flex items-center gap-2 px-2 py-1 text-left hover:bg-white/5 min-w-0 lg:w-[210px]" onClick={() => (can('director') && room.phase !== 'sim' ? openSelect() : openPanel('mission'))} title="Change mission">
          <span className="text-[24px] leading-none">{obj.icon}</span>
          <span className="min-w-0">
            <span className="block font-pixel text-[8px] text-gold truncate">{obj.short.toUpperCase()} · <span style={{ color: lvl.color }}>{lvl.label}</span></span>
            <span className="block text-[15px] text-muted truncate">{room.phase === 'design' ? 'DESIGNING' : room.phase === 'sim' ? (sim?.done ? 'LANDED' : 'IN FLIGHT') : 'LANDED'} · 🔁 change</span>
          </span>
        </button>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 flex-1 min-w-0">{pillars.map((p) => <Gauge key={p.key} p={p} />)}</div>
        <div className="flex items-center gap-1 px-1 justify-between lg:justify-end">
          <div className="px-inset px-2 py-1 text-center min-w-[74px]" title="Estimated probability of full mission success">
            <div className="font-pixel text-[7px] text-muted">SUCCESS</div>
            <div className="text-[20px] leading-none" style={{ color: est > 0.75 ? '#4ade80' : est > 0.4 ? '#fbbf24' : '#f87171' }}>{pct(est)}</div>
          </div>
          <button className="flex -space-x-1 items-center px-1" onClick={() => openPanel(mode === 'solo' ? 'help' : 'command', 'roles')} title={`${mode === 'solo' ? 'Solo' : `Room ${roomId}`} — team`}>
            {players.map((p) => (
              <span key={p.id} className="relative inline-block border-2" style={{ borderColor: p.roles[0] ? ROLE_MAP[p.roles[0]].color : '#888' }}>
                <AvatarIcon avatar={p.avatar} size={24} />
                {p.id === me && <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-ok border border-black" />}
              </span>
            ))}
          </button>
          <div className="flex flex-col items-center">
            <span className="font-pixel text-[7px] text-muted">{mode === 'solo' ? 'SOLO' : roomId}</span>
            <span className={`font-pixel text-[6px] ${status === 'connected' ? 'text-ok' : 'text-warn'}`}>{mode === 'local' ? 'TABS' : mode === 'online' ? status.toUpperCase() : ''}</span>
          </div>
          <button className="px-btn sm relative" onClick={() => useStore.setState({ chatOpen: true, unread: 0 })} aria-label="Open team chat">CHAT{unread > 0 && <span className="absolute -top-2 -right-2 bg-crit text-ink text-[8px] px-1 border border-black">{unread}</span>}</button>
          <button className="px-btn sm" onClick={() => openPanel('help')} aria-label="Help">?</button>
        </div>
      </div>
    </div>
  );
}
