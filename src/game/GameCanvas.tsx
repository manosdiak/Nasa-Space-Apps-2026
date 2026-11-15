import { useEffect, useRef } from 'react';
import { GameEngine, type RemotePlayer } from './engine';
import { MCC_LOCKED, npcDialogue } from './dialogues';
import { useStore } from '../state/store';
import { ROLE_MAP } from '../../shared/data/mission';
import { roleBadge } from '../../shared/room';

let engineRef: GameEngine | null = null;
export const getEngine = () => engineRef;

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const engine = new GameEngine(canvas, {
      blocked: () => { const s = useStore.getState(); return !!s.panel || !!s.dialogue || s.chatOpen; },
      onInteract: (it, npc) => {
        const s = useStore.getState();
        if (npc) { s.say(npcDialogue(npc.talk, npc.name)); return; }
        if (!it) return;
        if (it.kind === 'panel' && it.panel) s.openPanel(it.panel, it.tab);
        else if (it.kind === 'sign') s.say({ speaker: it.label, lines: it.text ?? [] });
      },
      onMapChange: (id) => useStore.getState().setMap(id),
      onPresence: (p) => {
        const s = useStore.getState();
        s.transport?.sendPresence({ ...p, id: s.playerId });
      },
      remotes: () => {
        const s = useStore.getState();
        const out: RemotePlayer[] = [];
        if (!s.room) return out;
        for (const [id, p] of Object.entries(s.presence)) {
          const info = s.room.players[id];
          if (!info || id === s.playerId) continue;
          const color = info.roles[0] ? ROLE_MAP[info.roles[0]].color : '#cccccc';
          out.push({ id, name: info.name, avatar: info.avatar, color, badge: roleBadge(info.roles), map: p.map, x: p.x, y: p.y, dir: p.dir, moving: p.moving });
        }
        return out;
      },
      npcAside: (id) => id === 'guard' && useStore.getState().isCoop(),
      doorLock: (interior) => {
        const s = useStore.getState();
        if (interior === 'mcc' && !s.mccUnlocked()) return { speaker: 'Mission Control', lines: [MCC_LOCKED] };
        return null;
      },
      onLocked: (msg) => { const s = useStore.getState(); if (!s.dialogue && !s.panel) s.say(msg); },
      me: () => {
        const s = useStore.getState();
        const info = s.room?.players[s.playerId];
        const multi = Object.keys(s.room?.players ?? {}).length > 1;
        return { name: info?.name ?? s.profile.name, avatar: info?.avatar ?? s.profile.avatar, color: info?.roles[0] && multi ? ROLE_MAP[info.roles[0]].color : '#f2c14e', badge: multi ? roleBadge(info?.roles ?? []) : '' };
      },
    }, useStore.getState().mapId);
    engineRef = engine;
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    // wait for the pixel font so canvas text renders crisply
    const go = () => engine.start();
    if (document.fonts?.load) document.fonts.load('8px "Press Start 2P"').then(go, go); else go();
    const unsub = useStore.subscribe((s, prev) => { if ((s.panel && !prev.panel) || (s.dialogue && !prev.dialogue)) engine.releaseAll(); });
    return () => { engine.stop(); window.removeEventListener('resize', onResize); unsub(); engineRef = null; };
  }, []);
  return <canvas ref={ref} className="game-canvas" aria-label="NASA HQ campus — pixel-art game world" />;
}
