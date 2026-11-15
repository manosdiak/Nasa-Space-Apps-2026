// NPC dialogue: short, friendly, and reacting to the current mission.
import { OBJECTIVE_MAP } from '../../shared/data/mission';
import { fmt } from '../../shared/engine/physics';
import type { Dialogue } from '../state/store';
import { useStore } from '../state/store';

export const MCC_LOCKED = 'Mission Control is currently on standby! Go to the Space Mission building and launch a mission first to view live results and telemetry here.';
export const GUARD_SOLO = 'Hey there! HQ Command is only open for Multiplayer Co-op teams. Hop into Online Co-op if you want to assign team roles and coordinate inside!';

export function npcDialogue(talk: string, name: string): Omit<Dialogue, 'index'> {
  const s = useStore.getState();
  const room = s.room;
  const res = s.resources;
  const obj = room ? OBJECTIVE_MAP[room.design.objectiveId] : undefined;
  const worst = res ? Object.values(res.pillars).filter((p) => p.status !== 'ok').sort((a, b) => (a.status === 'crit' ? -1 : 1) - (b.status === 'crit' ? -1 : 1)) : [];
  const L = (lines: string[], then?: Dialogue['then']) => ({ speaker: name, lines, then });
  switch (talk) {
    case 'guard': return s.isCoop()
      ? L(['Welcome, team! Go on in — pick your roles and plan together.'])
      : L([GUARD_SOLO]);
    case 'guide': return L([
      'Hi, I\'m Nova! Walk with the ARROW keys or WASD. Press E or SPACE to talk and use terminals.',
      obj ? `Your mission: ${obj.name}. Build and launch it in the SPACE MISSION building (north).` : 'Start at the SPACE MISSION building (north).',
      'After launch, MISSION CONTROL opens with your results. The ARCHIVES keep every run; the ACADEMY explains the science.',
    ]);
    case 'intern': return L([
      res && res.pillars.comms.status !== 'ok'
        ? `Tip: you make ${fmt(res.data.genGbPerDay, 1)} Gb of data a day but can only send ${fmt(res.link.downlinkGbPerDay, 1)} Gb home. Upgrade the radio!`
        : 'Tip: spacecraft rarely die of one big problem — it\'s usually a chain of small ones.',
    ]);
    case 'vega': return L([
      obj ? `Mission: ${obj.name}. ${obj.brief}` : 'Every mission starts with a question worth answering.',
      'Pick roles, then each of you owns part of the spacecraft. Big changes need a teammate\'s OK.',
    ], { panel: 'command', tab: 'brief' });
    case 'kai': return L([
      'Every kilogram needs rocket power, every watt needs solar panels, every bit needs a radio.',
      worst[0] ? `Right now your weak spot is ${worst[0].label.toUpperCase()}. Fix that first!` : 'All bars are green — press LAUNCH when you\'re ready!',
    ], { panel: 'mission', tab: 'build' });
    case 'reyes': return L([
      room?.phase === 'sim' ? 'We\'re flying! If something breaks, you\'ll get to make the call.' : room?.phase === 'done' ? 'The results are in. Check the subsystem report!' : 'Launch from the Space Mission building and I\'ll fly it from here.',
    ], { panel: 'mcc', tab: room?.phase === 'done' ? 'results' : 'live' });
    case 'ortiz': return L([
      'Every flight is saved here. Load one, change ONE thing, and fly again — then compare the two side by side.',
    ], { panel: 'archives', tab: 'runs' });
    case 'drorbit': return L(['Lower orbits see more detail but fight more drag. Higher orbits last longer but need more rocket.'], { panel: 'academy', tab: 'basics' });
    case 'drwatt': return L(['Sunlight fades with distance squared: at Jupiter you get 1/27 of Earth\'s light.'], { panel: 'academy', tab: 'basics' });
    case 'drlink': return L(['Double the distance and your radio gets 4× weaker. Bigger dishes win it back.'], { panel: 'academy', tab: 'basics' });
    case 'drrad': return L(['Radiation slowly fries electronics. Shielding and tough "rad-hard" chips buy you years.'], { panel: 'academy', tab: 'basics' });
    default: return L(['…']);
  }
}
