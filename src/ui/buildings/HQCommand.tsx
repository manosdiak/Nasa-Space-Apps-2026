// HQ COMMAND — the co-op hub (2–4 players): pick team roles, read a short
// mission briefing and coordinate strategy. In solo the guard keeps you out.
import { useEffect, useState } from 'react';
import { DIFFICULTY_MAP, LEVEL_INFO, OBJECTIVE_MAP, RESOURCE_OWNER, ROLES, ROLE_MAP } from '../../../shared/data/mission';
import { coordinationScore } from '../../../shared/engine/score';
import type { ResourceKey } from '../../../shared/types';
import { GUARD_SOLO } from '../../game/dialogues';
import { HOSTED } from '../../net/claudeHost';
import { teamOf, useStore } from '../../state/store';
import { PixelWorld } from '../PixelWorld';
import { AvatarIcon } from '../widgets/AvatarIcon';
import { PanelFrame, RoleChip, Section, money, n, pct } from '../widgets/common';
import { BAR_ICON, BAR_LABEL } from '../widgets/tips';

const ROLE_ICON: Record<string, string> = { director: '🎖', systems: '🔧', science: '🔬', ops: '📡' };

export function HQCommandPanel({ tab }: { tab?: string }) {
  const coop = useStore((s) => s.isCoop)();
  const [t, setT] = useState(tab ?? 'roles');
  useEffect(() => { if (tab) setT(tab); }, [tab]);
  if (!coop) {
    return (
      <PanelFrame title="HQ COMMAND" icon="🛡" subtitle="Co-op teams only">
        <div className="max-w-[560px] mx-auto text-center py-8">
          <div className="text-[64px]">💂</div>
          <p className="text-[22px] leading-snug mt-3">{GUARD_SOLO}</p>
        </div>
      </PanelFrame>
    );
  }
  return (
    <PanelFrame title="HQ COMMAND" icon="🏛" subtitle="Team roles · briefing · strategy"
      tabs={[{ id: 'roles', label: '👥 ROLES' }, { id: 'brief', label: '📋 BRIEFING' }, { id: 'plan', label: '🗺 STRATEGY' }]} tab={t} onTab={setT}>
      {t === 'roles' && <Roles />}
      {t === 'brief' && <Briefing />}
      {t === 'plan' && <Strategy />}
    </PanelFrame>
  );
}

function Roles() {
  const room = useStore((s) => s.room)!;
  const me = useStore((s) => s.playerId);
  const send = useStore((s) => s.send);
  const roomId = useStore((s) => s.roomId);
  const players = Object.values(room.players);
  const invite = `${location.origin}${location.pathname}?room=${roomId}`;
  return (
    <>
      <div className="px-inset p-2 mb-3 flex flex-wrap items-center gap-2 text-[18px]">
        <span className="font-pixel text-[9px] text-gold">ROOM {roomId}</span>
        <span className="text-muted">{players.length}/4 players</span>
        <div className="flex-1" />
        {HOSTED ? <span className="text-muted">Friends pick Online Co-op + this code.</span>
          : <button className="px-btn sm" onClick={() => navigator.clipboard?.writeText(invite).catch(() => undefined)}>📋 COPY INVITE LINK</button>}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {players.map((p) => (
          <div key={p.id} className="px-inset px-2 py-1 flex items-center gap-2">
            <AvatarIcon avatar={p.avatar} size={26} />
            <span className="text-[19px]">{p.name}{p.id === me ? ' (you)' : ''}</span>
            {p.roles.map((r) => <RoleChip key={r} role={r} />)}
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-2">
        {ROLES.map((r) => {
          const holders = players.filter((p) => p.roles.includes(r.id));
          const mine = holders.some((h) => h.id === me);
          return (
            <div key={r.id} className="px-inset p-3" style={{ borderLeft: `6px solid ${r.color}` }}>
              <div className="flex items-center gap-2"><span className="text-[26px]">{ROLE_ICON[r.id]}</span><span className="font-pixel text-[9px]" style={{ color: r.color }}>{r.name.toUpperCase()}</span></div>
              <div className="text-[18px] leading-snug mt-1">{r.description}</div>
              <div className="text-[16px] mt-1">Guards: {r.owns.map((o) => `${BAR_ICON[o]} ${BAR_LABEL[o]}`).join('  ')}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[17px]">{holders.length ? holders.map((h) => h.name).join(', ') : <span className="text-warn">open — anyone can act</span>}</span>
                <div className="flex-1" />
                {mine ? <button className="px-btn sm ghost" onClick={() => send({ t: 'releaseRole', role: r.id })}>RELEASE</button>
                  : !holders.length && <button className="px-btn sm primary" onClick={() => send({ t: 'claimRole', role: r.id })}>CLAIM</button>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Briefing() {
  const room = useStore((s) => s.room)!;
  const res = useStore((s) => s.resources)!;
  const can = useStore((s) => s.can);
  const openSelect = useStore((s) => s.openSelect);
  const openPanel = useStore((s) => s.openPanel);
  const d = room.design;
  const obj = OBJECTIVE_MAP[d.objectiveId];
  const lvl = LEVEL_INFO[obj.level];
  return (
    <>
      <div className="px-inset p-3 flex flex-wrap gap-3 items-center">
        <PixelWorld mission={obj.id} size={96} />
        <div className="flex-1 min-w-[220px]">
          <div className="font-pixel text-[7px]" style={{ color: lvl.color }}>{lvl.label} · {DIFFICULTY_MAP[d.difficulty].title.toUpperCase()}</div>
          <div className="font-pixel text-[12px] text-gold mt-1">{obj.name}</div>
          <p className="text-[19px] leading-snug mt-1">{obj.brief}</p>
        </div>
      </div>
      <Section title="Goals" className="mt-3">
        <div className="grid sm:grid-cols-4 gap-2 text-[18px]">
          <div className="px-inset p-2">🎯 {obj.target}</div>
          <div className="px-inset p-2">🔬 {n(res.science.baseline, 0)} science pts</div>
          <div className="px-inset p-2">💰 {d.difficulty === 'sandbox' ? 'no cap' : money(res.cost.cap)}</div>
          <div className="px-inset p-2">⏳ {obj.baselineYears} yr · launch by month {obj.deadlineMonths}</div>
        </div>
      </Section>
      <Section title="Who decides what">
        <div className="grid sm:grid-cols-2 gap-1 text-[18px]">
          {(Object.keys(RESOURCE_OWNER) as ResourceKey[]).map((k) => <div key={k} className="px-inset px-2 py-1">{BAR_ICON[k]} {BAR_LABEL[k]} → <RoleChip role={RESOURCE_OWNER[k]} /></div>)}
        </div>
      </Section>
      <div className="flex flex-wrap gap-2">
        <button className="px-btn primary" onClick={() => openPanel('mission', 'build')}>🛰 START DESIGNING</button>
        {can('director') && room.phase !== 'sim' && <button className="px-btn ghost" onClick={openSelect}>🔁 CHANGE MISSION</button>}
      </div>
    </>
  );
}

function Strategy() {
  const room = useStore((s) => s.room)!;
  const send = useStore((s) => s.send);
  const can = useStore((s) => s.can);
  const [msg, setMsg] = useState('');
  const coord = coordinationScore(room.metrics, teamOf(room).map((p) => p.roles));
  const open = room.proposals.filter((p) => p.status === 'open');
  const QUICK = ['Keep mass low!', 'Who picks the radio?', 'We need more power', 'Ready to launch?', 'Stay under budget!'];
  return (
    <>
      <Section title="Lock what you guard">
        <div className="text-[17px] text-muted mb-2">Locked = teammates must ask before using more of it.</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RESOURCE_OWNER) as ResourceKey[]).map((k) => {
            const owner = RESOURCE_OWNER[k];
            const locked = !!room.locks[k];
            return <button key={k} className={`px-btn sm ${locked ? 'gold' : 'ghost'}`} disabled={!can(owner)} onClick={() => send({ t: locked ? 'unlock' : 'lock', resource: k })}>{locked ? '🔒' : '🔓'} {BAR_ICON[k]} {BAR_LABEL[k]} · {ROLE_MAP[owner].short}</button>;
          })}
        </div>
      </Section>
      <Section title={`Waiting for a vote (${open.length})`}>
        {open.length ? open.map((p) => <div key={p.id} className="px-inset px-2 py-1 mb-1 text-[17px]">🗳 {p.byName}: {p.summary} — needs {p.needs.map((r) => ROLE_MAP[r].short).join(' + ')}</div>)
          : <div className="text-[17px] text-muted">Nothing pending. Changes that hurt a teammate's bar show up here.</div>}
      </Section>
      <Section title="Team chat">
        <div className="max-h-[160px] overflow-y-auto scroll-thin text-[17px] mb-2">
          {room.chat.slice(-8).map((c) => <div key={c.id}><b className="text-accent">{c.name}:</b> {c.text}</div>)}
          {!room.chat.length && <div className="text-muted">No messages yet.</div>}
        </div>
        <div className="flex flex-wrap gap-1 mb-2">{QUICK.map((q) => <button key={q} className="px-btn sm ghost" onClick={() => send({ t: 'chat', text: q })}>{q}</button>)}</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) { send({ t: 'chat', text: msg }); setMsg(''); } }}>
          <input className="px-input flex-1" value={msg} maxLength={200} placeholder="Message your team…" onChange={(e) => setMsg(e.target.value)} />
          <button className="px-btn sm primary">SEND</button>
        </form>
      </Section>
      <Section title={`Teamwork score ${pct(coord.value)}`}>
        <div className="grid sm:grid-cols-2 gap-x-4">{coord.parts.map((p) => <div key={p.label} className="flex items-center gap-2 text-[16px]"><span className="w-[200px] truncate">{p.label}</span><div className="flex-1 h-[8px] bg-black/50"><div className="h-full bg-accent" style={{ width: `${p.value * 100}%` }} /></div></div>)}</div>
      </Section>
    </>
  );
}

export function HelpPanel() {
  const disconnect = useStore((s) => s.disconnect);
  return (
    <PanelFrame title="HOW TO PLAY" icon="❔">
      <div className="grid sm:grid-cols-2 gap-2 text-[19px]">
        <div className="px-inset p-2">🕹 Arrows / WASD to walk · Shift to run</div>
        <div className="px-inset p-2">💬 E / Space to talk or use a terminal · Esc to close</div>
        <div className="px-inset p-2">🛰 <b>Space Mission</b>: build and LAUNCH</div>
        <div className="px-inset p-2">🖥 <b>Mission Control</b>: live flight & results (after launch)</div>
        <div className="px-inset p-2">🗄 <b>Archives</b>: past runs, tweak & compare</div>
        <div className="px-inset p-2">📚 <b>Academy</b>: how space works, real missions</div>
        <div className="px-inset p-2">🏛 <b>HQ Command</b>: co-op roles & strategy</div>
        <div className="px-inset p-2">🏆 Score = success + science + efficiency + teamwork</div>
      </div>
      <button className="px-btn danger mt-4" onClick={() => useStore.getState().confirmAction('Leave and return to the start menu?', 'LEAVE', disconnect)}>LEAVE TO MENU</button>
    </PanelFrame>
  );
}
