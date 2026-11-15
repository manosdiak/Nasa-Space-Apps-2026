import { useEffect, useState, type ReactNode } from 'react';
import { ROLE_MAP } from '../../../shared/data/mission';
import type { RoleId, Status } from '../../../shared/types';
import { useStore } from '../../state/store';

export const STATUS_COLOR: Record<Status, string> = { ok: '#4ade80', warn: '#fbbf24', crit: '#f87171' };
export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', warn: 'TIGHT', crit: 'CRITICAL' };

export function n(x: number, d = 1) {
  if (!Number.isFinite(x)) return '∞';
  const ax = Math.abs(x);
  if (ax >= 1e6) return (x / 1e6).toFixed(1) + 'M';
  if (ax >= 1e4) return Math.round(x).toLocaleString('en-US');
  return x.toLocaleString('en-US', { maximumFractionDigits: d });
}
export const money = (m: number) => (m >= 1000 ? `$${(m / 1000).toFixed(2)}B` : `$${n(m, m < 10 ? 2 : 0)}M`);
export const pct = (f: number, d = 0) => `${(f * 100).toFixed(d)}%`;

export function PanelFrame(props: {
  title: string; subtitle?: string; icon?: string; tabs?: { id: string; label: string; badge?: string | number }[]; tab?: string;
  onTab?: (id: string) => void; children: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  const close = useStore((s) => s.closePanel);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);
  return (
    <div className="fixed inset-0 z-30 flex items-stretch sm:items-center justify-center bg-black/55 sm:p-4 print-area" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`px-frame scanlines slide-up flex flex-col w-full ${props.wide ? 'sm:max-w-[1240px]' : 'sm:max-w-[1080px]'} h-full sm:h-[90vh] print-area`} role="dialog" aria-label={props.title}>
        <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b-2 border-black/60">
          {props.icon && <span className="text-2xl leading-none">{props.icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="font-pixel text-[11px] sm:text-[13px] text-gold truncate">{props.title}</div>
            {props.subtitle && <div className="text-muted text-[17px] truncate">{props.subtitle}</div>}
          </div>
          <button className="px-btn sm no-print" onClick={close} aria-label="Close panel">ESC ✕</button>
        </div>
        {props.tabs && (
          <div className="flex gap-1 px-3 pt-2 overflow-x-auto scroll-thin no-print">
            {props.tabs.map((t) => (
              <button key={t.id} className={`tab ${props.tab === t.id ? 'on' : ''}`} onClick={() => props.onTab?.(t.id)}>
                {t.label}{t.badge !== undefined && t.badge !== 0 && <span className="ml-1 text-crit">●{t.badge}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto scroll-thin bg-panel2/60 px-3 sm:px-5 py-4 border-t-2 border-black/40">{props.children}</div>
        {props.footer && <div className="border-t-2 border-black/60 px-4 py-2 no-print">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Section({ title, children, right, className = '' }: { title: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`mb-4 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-pixel text-[10px] text-accent uppercase tracking-wide">{title}</h3>
        <div className="flex-1 h-[2px] bg-line/70" />
        {right}
      </div>
      {children}
    </section>
  );
}

export function StatusTag({ s, small }: { s: Status; small?: boolean }) {
  return <span className={`font-pixel ${small ? 'text-[7px] px-1 py-[2px]' : 'text-[8px] px-[6px] py-[3px]'} border-2 border-black`} style={{ background: STATUS_COLOR[s], color: '#0b1020' }}>{STATUS_LABEL[s]}</span>;
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="px-inset px-3 py-2 min-w-0">
      <div className="text-muted text-[16px] leading-tight truncate">{label}</div>
      <div className="text-[24px] leading-tight truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-muted text-[15px] leading-tight">{sub}</div>}
    </div>
  );
}

/** Horizontal usage bar with capacity marker */
export function UsageBar({ used, capacity, status, label, right, height = 14 }: { used: number; capacity: number; status: Status; label?: ReactNode; right?: ReactNode; height?: number }) {
  const frac = capacity > 0 ? used / capacity : used > 0 ? 2 : 0;
  const w = Math.min(100, frac * 100);
  return (
    <div>
      {(label || right) && <div className="flex justify-between text-[17px] leading-tight mb-[2px]"><span className="truncate">{label}</span><span className="text-muted shrink-0 ml-2">{right}</span></div>}
      <div className="relative bg-[#0a0f20] border-2 border-black" style={{ height }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${w}%`, background: STATUS_COLOR[status], backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 2px, transparent 2px 6px)' }} />
        {frac > 1 && <div className="absolute inset-y-0 right-0 w-[6px] bg-crit blink" />}
      </div>
    </div>
  );
}

export function RoleChip({ role, name }: { role: RoleId; name?: string }) {
  const r = ROLE_MAP[role];
  return <span className="inline-flex items-center gap-1 font-pixel text-[8px] px-[5px] py-[3px] border-2 border-black" style={{ background: r.color, color: '#0b1020' }}>{r.short}{name ? ` · ${name}` : ''}</span>;
}

/** Shows who owns a decision; non-owners' edits become proposals. */
export function OwnerNote({ role }: { role: RoleId }) {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.playerId);
  if (!room) return null;
  const holders = Object.values(room.players).filter((p) => p.roles.includes(role));
  const mine = holders.some((h) => h.id === me);
  const solo = Object.keys(room.players).length === 1;
  if (solo) return null;
  return (
    <div className={`text-[16px] px-2 py-1 mb-2 border-2 border-black ${mine ? 'bg-[#16301f] text-ok' : 'bg-[#2a2210] text-warn'}`}>
      {mine ? <>You own these decisions as <RoleChip role={role} />. Changes that push a teammate's resource into the red need their approval.</>
        : holders.length ? <>Owned by <RoleChip role={role} name={holders[0].name} />. Your changes here are sent as <b>proposals</b> for their approval.</>
          : <>No one holds <RoleChip role={role} /> — anyone may decide.</>}
    </div>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return <div className="text-[17px] text-muted border-l-4 border-accent/70 pl-2 my-2">{children}</div>;
}

export function Hover({ tip, children, className = '' }: { tip: ReactNode; children: ReactNode; className?: string }) {
  const [on, setOn] = useState(false);
  return (
    <span className={`relative ${className}`} onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
      {children}
      {on && <span className="absolute z-50 left-0 top-full mt-1 w-[300px] max-w-[80vw] px-frame-light p-2 text-[17px] leading-snug pointer-events-none">{tip}</span>}
    </span>
  );
}

export function Delta({ v, better = 'lower', unit = '', d = 1 }: { v: number; better?: 'lower' | 'higher' | 'none'; unit?: string; d?: number }) {
  if (Math.abs(v) < 1e-9) return <span className="text-muted">±0</span>;
  const good = better === 'none' ? null : better === 'lower' ? v < 0 : v > 0;
  return <span style={{ color: good === null ? '#9aa6d0' : good ? '#4ade80' : '#f87171' }}>{v > 0 ? '+' : ''}{n(v, d)}{unit}</span>;
}

// ── Phase 2 widgets ──────────────────────────────────────────────────────────
export function TriTag({ s, small }: { s: 'ok' | 'warn' | 'crit' | 'pending'; small?: boolean }) {
  const map = { ok: ['#4ade80', 'OK'], warn: ['#fbbf24', 'WARN'], crit: ['#f87171', 'FAIL'], pending: ['#9aa6d0', 'TO DO'] } as const;
  const [bg, label] = map[s];
  return <span className={`font-pixel ${small ? 'text-[7px] px-1 py-[2px]' : 'text-[8px] px-[6px] py-[3px]'} border-2 border-black shrink-0`} style={{ background: bg, color: '#0b1020' }}>{label}</span>;
}

export function CheckList({ checks, dense }: { checks: { label: string; ok: boolean; note: string; severity?: 'ok' | 'warn' | 'crit' }[]; dense?: boolean }) {
  return (
    <div className={dense ? 'space-y-[1px]' : 'space-y-[3px]'}>
      {checks.map((c, i) => {
        const col = c.ok ? '#4ade80' : c.severity === 'warn' ? '#fbbf24' : '#f87171';
        return (
          <div key={i} className={`flex gap-2 ${dense ? 'text-[16px]' : 'text-[17px]'} leading-snug`}>
            <span className="shrink-0 w-[16px]" style={{ color: col }}>{c.ok ? '✔' : c.severity === 'warn' ? '⚠' : '✘'}</span>
            <span className="min-w-0"><span>{c.label}</span>{c.note && <span className="text-muted"> — {c.note}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

export function fmtT(tMin: number): string {
  if (tMin < 120) return `T+${Math.round(tMin)} min`;
  if (tMin < 2 * 1440) return `T+${(tMin / 60).toFixed(tMin < 600 ? 1 : 0)} h`;
  if (tMin < 400 * 1440) return `T+${Math.round(tMin / 1440)} d`;
  return `T+${(tMin / 525600).toFixed(1)} yr`;
}
