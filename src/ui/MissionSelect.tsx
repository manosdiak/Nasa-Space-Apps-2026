// Post-menu Mission Selection screen: 2 Easy, 2 Medium, 2 Hard missions and the Sandbox.
import { useMemo } from 'react';
import { DIFFICULTY_MAP, LEVEL_INFO, OBJECTIVES } from '../../shared/data/mission';
import type { MissionObjective } from '../../shared/types';
import { useStore } from '../state/store';
import { PixelWorld } from './PixelWorld';
import { money } from './widgets/common';

function Stars() {
  const stars = useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 100, s: i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1, d: (i % 5) * 0.6 })), []);
  return (
    <div className="fixed inset-0 bg-[#070a18] overflow-hidden" aria-hidden="true">
      {stars.map((st, i) => <div key={i} className="absolute bg-white blink-slow" style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, opacity: st.s === 1 ? 0.5 : 0.9, animationDelay: `${st.d}s` }} />)}
    </div>
  );
}

function Card({ m, current, onPick, disabled }: { m: MissionObjective; current: boolean; onPick: () => void; disabled: boolean }) {
  const lvl = LEVEL_INFO[m.level];
  const cap = m.level === 'sandbox' ? '∞' : money(m.budgetCap * DIFFICULTY_MAP[m.difficulty].budgetMult);
  return (
    <button onClick={onPick} disabled={disabled}
      className={`px-frame text-left p-3 flex gap-3 items-center transition-transform hover:-translate-y-1 disabled:opacity-60 disabled:hover:translate-y-0 ${current ? 'outline outline-2 outline-gold' : ''}`}
      style={{ boxShadow: `inset 0 0 0 2px ${m.color}55, 6px 6px 0 rgba(0,0,0,.45)` }} aria-label={`${m.name} — ${lvl.label}`}>
      <div className="shrink-0 bg-black/40 border-2 border-black"><PixelWorld mission={m.id} size={84} /></div>
      <div className="min-w-0 flex-1">
        <div className="font-pixel text-[7px] mb-1" style={{ color: lvl.color }}>{lvl.label}{current ? ' · CURRENT' : ''}</div>
        <div className="font-pixel text-[10px] leading-snug text-cream">{m.name}</div>
        <div className="text-[18px] leading-tight text-muted mt-1">{m.tagline}</div>
        <div className="flex flex-wrap gap-1 mt-2 text-[15px]">
          <span className="px-inset px-1">🎯 {m.target}</span>
          <span className="px-inset px-1">💰 {cap}</span>
          <span className="px-inset px-1">⏳ {m.baselineYears} yr</span>
        </div>
      </div>
    </button>
  );
}

export function MissionSelect() {
  const room = useStore((s) => s.room);
  const pick = useStore((s) => s.pickMission);
  const can = useStore((s) => s.can);
  const disconnect = useStore((s) => s.disconnect);
  const mode = useStore((s) => s.mode);
  const set = useStore.setState;
  if (!room) return null;
  const locked = room.missionSelected && !can('director');
  const flying = room.phase === 'sim';
  const groups: MissionObjective['level'][] = ['easy', 'medium', 'hard', 'sandbox'];
  return (
    <div className="fixed inset-0 overflow-y-auto scroll-thin">
      <Stars />
      <div className="relative max-w-[1100px] mx-auto p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="px-btn sm ghost" onClick={() => (room.missionSelected ? set({ scene: 'game' }) : disconnect())}>{room.missionSelected ? '◀ BACK TO HQ' : '◀ MENU'}</button>
          <div className="flex-1" />
          {mode !== 'solo' && <span className="font-pixel text-[8px] text-muted">ROOM {useStore.getState().roomId}</span>}
        </div>
        <div className="text-center">
          <div className="font-pixel text-[10px] text-accent tracking-widest">NASA HQ · MISSION BOARD</div>
          <h1 className="font-pixel text-[22px] sm:text-[30px] text-gold mt-2" style={{ textShadow: '3px 3px 0 #8a3a10' }}>CHOOSE YOUR MISSION</h1>
          <p className="text-[20px] text-muted mt-1">Pick one. You can switch missions later from HQ.</p>
          {locked && <p className="text-[18px] text-warn mt-1">Only the Flight Director can change the team's mission.</p>}
          {flying && <p className="text-[18px] text-warn mt-1">A mission is flying — wait for it to land in Mission Control.</p>}
        </div>
        {groups.map((g) => {
          const list = OBJECTIVES.filter((o) => o.level === g);
          const info = LEVEL_INFO[g];
          return (
            <section key={g}>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="font-pixel text-[11px]" style={{ color: info.color }}>{info.label}</span>
                <span className="text-[18px] text-muted">{info.blurb}</span>
              </div>
              <div className={`grid gap-3 ${list.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {list.map((m) => <Card key={m.id} m={m} current={room.missionSelected && room.design.objectiveId === m.id} disabled={locked || flying} onPick={() => pick(m.id)} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
