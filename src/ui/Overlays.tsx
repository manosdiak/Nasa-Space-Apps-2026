import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPONENT_MAP } from '../../shared/data/components';
import { ROLE_MAP } from '../../shared/data/mission';
import { computeResources } from '../../shared/engine/physics';
import { applyChange, canAct, roleForChange, type DesignChange, type Proposal } from '../../shared/room';
import type { ResourceKey, RoleId } from '../../shared/types';
import { getEngine } from '../game/GameCanvas';
import { useStore } from '../state/store';
import { AvatarIcon } from './widgets/AvatarIcon';
import { RoleChip, StatusTag } from './widgets/common';

// ── Retro dialogue box with typewriter text ──────────────────────────────────
export function DialogueBox() {
  const d = useStore((s) => s.dialogue);
  const advance = useStore((s) => s.advanceDialogue);
  const [shown, setShown] = useState(0);
  const line = d ? d.lines[d.index] ?? '' : '';
  useEffect(() => { setShown(0); }, [d?.index, d?.speaker, line]);
  useEffect(() => {
    if (!d || shown >= line.length) return;
    const t = setTimeout(() => setShown((x) => Math.min(line.length, x + 2)), 16);
    return () => clearTimeout(t);
  }, [d, shown, line]);
  useEffect(() => {
    if (!d) return;
    const h = (e: KeyboardEvent) => {
      if (['e', 'E', ' ', 'Enter', 'z', 'Z'].includes(e.key)) { e.preventDefault(); if (shown < line.length) setShown(line.length); else advance(); }
      if (e.key === 'Escape') useStore.setState({ dialogue: null });
    };
    const t = setTimeout(() => window.addEventListener('keydown', h), 120);
    return () => { clearTimeout(t); window.removeEventListener('keydown', h); };
  }, [d, shown, line, advance]);
  if (!d) return null;
  const last = d.index === d.lines.length - 1;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-2 sm:p-4 flex justify-center no-print" onClick={() => (shown < line.length ? setShown(line.length) : advance())}>
      <div className="px-frame-light w-full max-w-[900px] p-3 sm:p-4 slide-up cursor-pointer select-none">
        <div className="font-pixel text-[10px] text-[#3a5cb8] mb-2">{d.speaker}</div>
        <div className="text-[22px] sm:text-[24px] leading-snug min-h-[3.4em]">{line.slice(0, shown)}</div>
        <div className="flex justify-end items-center gap-3 mt-1 text-[16px] text-[#6a6a80]">
          {last && d.then && <span>Then opens the terminal →</span>}
          <span className="font-pixel text-[9px] text-[#d83030] blink">▼</span>
        </div>
      </div>
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const col = { info: '#58b8f8', ok: '#4ade80', warn: '#fbbf24', crit: '#f87171', event: '#c878f8' };
  return (
    <div className="fixed z-50 left-1/2 -translate-x-1/2 top-[170px] sm:top-[100px] lg:top-[78px] w-[min(640px,94vw)] flex flex-col gap-1 pointer-events-none no-print">
      {toasts.map((t) => (
        <div key={t.id} className="px-frame slide-up px-3 py-2 text-[18px] leading-snug" style={{ borderLeft: `8px solid ${col[t.kind]}` }}>{t.text}</div>
      ))}
    </div>
  );
}

// ── Team chat + activity feed ────────────────────────────────────────────────
export function ChatDock() {
  const open = useStore((s) => s.chatOpen);
  const room = useStore((s) => s.room);
  const send = useStore((s) => s.send);
  const me = useStore((s) => s.playerId);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'chat' | 'feed'>('chat');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [room?.chat.length, room?.feed.length, open, tab]);
  if (!open || !room) return null;
  const close = () => useStore.setState({ chatOpen: false, unread: 0 });
  const quick = ['Need more power!', 'Over budget — what can we cut?', 'Approve please 🙏', 'Ready for launch poll', 'Comms bottleneck!'];
  return (
    <div className="fixed z-40 left-2 right-2 sm:right-auto bottom-2 sm:w-[420px] h-[55vh] px-frame flex flex-col no-print">
      <div className="flex items-center gap-1 p-2 border-b-2 border-black/60">
        <button className={`tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>TEAM CHAT</button>
        <button className={`tab ${tab === 'feed' ? 'on' : ''}`} onClick={() => setTab('feed')}>ACTIVITY</button>
        <div className="flex-1" />
        <button className="px-btn sm" onClick={close}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-2 text-[18px] leading-snug">
        {tab === 'chat' ? (room.chat.length ? room.chat.map((m) => {
          const p = room.players[m.by];
          const color = p?.roles[0] ? ROLE_MAP[p.roles[0]].color : '#9aa6d0';
          return <div key={m.id} className="mb-1"><b style={{ color }}>{m.name}{m.by === me ? ' (you)' : ''}:</b> {m.text}</div>;
        }) : <div className="text-muted">No messages yet. Negotiate trade-offs here — e.g. "PI wants the SAR radar, SE can you add a bigger array?"</div>)
          : room.feed.map((f, i) => <div key={i} className="mb-1" style={{ color: f.kind === 'warn' ? '#fbbf24' : f.kind === 'ok' ? '#4ade80' : f.kind === 'event' ? '#d8a8f8' : '#c8d0f0' }}>{new Date(f.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {f.text}</div>)}
        <div ref={endRef} />
      </div>
      {tab === 'chat' && <>
        <div className="flex gap-1 overflow-x-auto scroll-thin px-2 pb-1">{quick.map((q) => <button key={q} className="px-btn sm ghost" onClick={() => send({ t: 'chat', text: q })}>{q}</button>)}</div>
        <form className="flex gap-1 p-2 border-t-2 border-black/60" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ t: 'chat', text }); setText(''); }}>
          <input className="px-input flex-1 min-w-0" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your team…" maxLength={280} autoFocus />
          <button className="px-btn primary">SEND</button>
        </form>
      </>}
    </div>
  );
}

// ── Negotiation: open proposals that need my approval (or mine, pending) ─────
function fixesFor(p: Proposal, myRoles: RoleId[], allowed: (c: DesignChange) => boolean): { change: DesignChange; label: string }[] {
  const room = useStore.getState().room!;
  const after = applyChange(room.design, p.change);
  const bad = p.impacts.map((i) => i.resource);
  const base = computeResources(after, room.modifiers);
  const out: { change: DesignChange; label: string; score: number }[] = [];
  const scoreOf = (r: ReturnType<typeof computeResources>) => bad.reduce((a, k) => a + ({ ok: 0, warn: 1, crit: 2 }[r.pillars[k as ResourceKey].status] * 10 + Math.min(5, r.pillars[k as ResourceKey].utilization)), 0);
  const s0 = scoreOf(base);
  const cands: DesignChange[] = [];
  for (const c of Object.values(COMPONENT_MAP)) {
    if (c.category === 'bus') continue;
    const cur = after.components.find((x) => x.id === c.id)?.qty ?? 0;
    if (cur < c.maxQty) cands.push({ k: 'component', id: c.id, qty: cur + 1 });
  }
  if (bad.includes('budget')) for (const x of after.components) cands.push({ k: 'component', id: x.id, qty: x.qty - 1 });
  if (bad.includes('comms')) cands.push({ k: 'contact', hours: Math.min(24, after.contactHoursPerDay + 4) });
  for (const lv of ['lv_f9', 'lv_vulcan', 'lv_fh', 'lv_atlas']) cands.push({ k: 'launch', lvId: lv });
  for (const ch of cands) {
    if (!allowed(ch) || !myRoles.includes(roleForChange(ch))) continue;
    const r = computeResources(applyChange(after, ch), room.modifiers);
    const sc = scoreOf(r);
    if (sc < s0 - 0.5 && r.compatibility.blockers.length <= base.compatibility.blockers.length) {
      const label = ch.k === 'component' ? `${ch.qty > ((after.components.find((x) => x.id === ch.id)?.qty) ?? 0) ? '+' : '−'} ${COMPONENT_MAP[ch.id].name}` : ch.k === 'contact' ? `Contact → ${ch.hours} h/day` : ch.k === 'launch' ? `Rocket → ${ch.lvId.replace('lv_', '').toUpperCase()}` : ch.k;
      out.push({ change: ch, label, score: sc + r.cost.total / 1e4 });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 3);
}

export function ProposalDock() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.playerId);
  const send = useStore((s) => s.send);
  const [fixOpen, setFixOpen] = useState<string | null>(null);
  const open = room?.proposals.filter((p) => p.status === 'open') ?? [];
  const myRoles = room?.players[me]?.roles ?? [];
  const fixes = useMemo(() => {
    if (!fixOpen || !room) return [];
    const p = room.proposals.find((x) => x.id === fixOpen);
    return p ? fixesFor(p, myRoles, (c) => canAct(room, me, roleForChange(c))) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixOpen, room?.seq]);
  if (!room || !open.length) return null;
  return (
    <div className="fixed z-30 right-2 bottom-24 sm:bottom-2 w-[min(400px,96vw)] flex flex-col gap-2 no-print">
      {open.map((p) => {
        const needMe = p.needs.filter((r) => canAct(room, me, r) && !p.votes[r]);
        const mine = p.by === me;
        return (
          <div key={p.id} className="px-frame p-2 slide-up">
            <div className="font-pixel text-[8px] text-[#d8a8f8] mb-1">TRADE-OFF NEGOTIATION</div>
            <div className="text-[19px] leading-snug"><b>{p.byName}</b> {p.byRoles.map((r) => <RoleChip key={r} role={r} />)} proposes: <span className="text-gold">{p.summary}</span></div>
            <div className="text-[16px] text-muted mt-1">{p.reason}</div>
            <div className="flex flex-wrap gap-1 mt-1">{p.impacts.map((i) => <span key={i.resource} className="text-[15px] inline-flex items-center gap-1">{i.resource.toUpperCase()} <StatusTag s={i.afterStatus} small /></span>)}</div>
            <div className="flex flex-wrap items-center gap-1 mt-2">
              <span className="text-[16px] text-muted mr-1">Needs:</span>
              {p.needs.map((r) => <span key={r} className="inline-flex items-center gap-1"><RoleChip role={r} />{p.votes[r] === 'yes' ? '✔' : p.votes[r] === 'no' ? '✘' : '…'}</span>)}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {needMe.length > 0 && <>
                <button className="px-btn sm primary" onClick={() => send({ t: 'vote', proposalId: p.id, vote: 'yes' })}>APPROVE</button>
                <button className="px-btn sm gold" onClick={() => setFixOpen(fixOpen === p.id ? null : p.id)}>APPROVE + FIX…</button>
                <button className="px-btn sm danger" onClick={() => send({ t: 'vote', proposalId: p.id, vote: 'no' })}>REJECT</button>
              </>}
              {mine && <button className="px-btn sm ghost" onClick={() => send({ t: 'withdraw', proposalId: p.id })}>WITHDRAW</button>}
              {!needMe.length && !mine && <span className="text-[16px] text-muted">Waiting for teammates…</span>}
            </div>
            {fixOpen === p.id && (
              <div className="mt-2 px-inset p-2">
                <div className="text-[16px] text-muted mb-1">Approve AND apply a counter-measure from your subsystem:</div>
                {fixes.length ? fixes.map((f) => <button key={f.label} className="px-btn sm block w-full text-left mb-1" onClick={() => { send({ t: 'vote', proposalId: p.id, vote: 'yes', fix: f.change }); setFixOpen(null); }}>✚ {f.label}</button>)
                  : <div className="text-[16px]">No single change in your subsystem fixes it. Discuss in chat, or approve and fix it afterwards.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── On-screen controls for touch devices ─────────────────────────────────────
export function TouchControls() {
  const [touch] = useState(() => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  const panel = useStore((s) => s.panel);
  const dialogue = useStore((s) => s.dialogue);
  if (!touch || panel) return null;
  const press = (d: number | null) => getEngine()?.setVirtual(d);
  const btn = 'w-14 h-14 px-frame flex items-center justify-center text-[22px] active:bg-[#2d3d74] select-none';
  const hold = (d: number) => ({ onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); press(d); }, onPointerUp: () => press(null), onPointerLeave: () => press(null), onPointerCancel: () => press(null) });
  return (
    <div className="fixed z-20 inset-x-0 bottom-0 p-3 flex justify-between items-end pointer-events-none no-print select-none" style={{ touchAction: 'none' }}>
      <div className="grid grid-cols-3 gap-1 pointer-events-auto">
        <span /><button className={btn} {...hold(3)} aria-label="Up">▲</button><span />
        <button className={btn} {...hold(1)} aria-label="Left">◀</button><span /><button className={btn} {...hold(2)} aria-label="Right">▶</button>
        <span /><button className={btn} {...hold(0)} aria-label="Down">▼</button><span />
      </div>
      <button className="w-20 h-20 rounded-full px-frame font-pixel text-[16px] pointer-events-auto" onPointerDown={(e) => { e.preventDefault(); if (dialogue) useStore.getState().advanceDialogue(); else getEngine()?.interact(); }} aria-label="Interact">A</button>
    </div>
  );
}

export function PlayerBadge({ id }: { id: string }) {
  const room = useStore((s) => s.room);
  const p = room?.players[id];
  if (!p) return null;
  return <span className="inline-flex items-center gap-1"><AvatarIcon avatar={p.avatar} size={18} />{p.name}{p.roles.map((r) => <RoleChip key={r} role={r} />)}</span>;
}

// ── In-page confirmation (native confirm() is unavailable inside the Artifact viewer) ──
export function ConfirmDialog() {
  const ask = useStore((s) => s.ask);
  useEffect(() => {
    if (!ask) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.setState({ ask: null }); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 no-print" role="alertdialog" aria-label="Confirm">
      <div className="px-frame max-w-[480px] w-full p-4 slide-up">
        <div className="text-[21px] leading-snug">{ask.text}</div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="px-btn ghost" onClick={() => useStore.setState({ ask: null })} autoFocus>CANCEL</button>
          <button className="px-btn danger" onClick={() => { const f = ask.onYes; useStore.setState({ ask: null }); f(); }}>{ask.yes}</button>
        </div>
      </div>
    </div>
  );
}
