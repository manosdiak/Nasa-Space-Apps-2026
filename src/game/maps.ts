// Tile maps for the NASA HQ campus overworld and the five building interiors.
// Maps are generated in code (layout + decoration rules) so they always connect.
import { hash2, type TileKind } from './sprites';
import type { PanelId } from '../state/store';

export type PropKind = 'tree' | 'tree2' | 'bush' | 'lamp' | 'sign' | 'fountain' | 'rocket' | 'flag' | 'console' | 'screen' | 'desk' | 'shelf' | 'rack' | 'plant' | 'sc' | 'chair' | 'kiosk' | 'tower';
export interface Prop { kind: PropKind; x: number; y: number; w?: number; variant?: number; screen?: 'earth' | 'chart' | 'orbit'; color?: string }
export interface Npc {
  id: string; name: string; pal: string; x: number; y: number; dir: number; talk: string; wander?: boolean;
  /** Where the NPC steps to when the game says so (e.g. the HQ guard in co-op). The NPC is not baked into the solid map. */
  aside?: [number, number];
}
export interface Interactable { kind: 'panel' | 'sign' | 'npc'; panel?: PanelId; tab?: string; label: string; text?: string[]; talk?: string }
export interface Warp { map: string; x: number; y: number; dir: number }
export interface Building { id: string; name: string; label: string; x: number; y: number; w: number; h: number; roof: string; roofDark: string; wall: string; door: [number, number]; interior: string }
export interface GameMap {
  id: string; name: string; w: number; h: number; ground: TileKind[]; solid: Uint8Array; props: Prop[]; npcs: Npc[];
  interact: Map<string, Interactable>; warps: Map<string, Warp>; buildings: Building[]; spawn: { x: number; y: number; dir: number }; bg: string;
}

const key = (x: number, y: number) => `${x},${y}`;

function blank(id: string, name: string, w: number, h: number, fill: TileKind, bg: string): GameMap {
  return { id, name, w, h, ground: new Array(w * h).fill(fill), solid: new Uint8Array(w * h), props: [], npcs: [], interact: new Map(), warps: new Map(), buildings: [], spawn: { x: 1, y: 1, dir: 0 }, bg };
}
function setG(m: GameMap, x: number, y: number, t: TileKind) { if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.ground[y * m.w + x] = t; }
function getG(m: GameMap, x: number, y: number) { return m.ground[y * m.w + x]; }
function solid(m: GameMap, x: number, y: number, v = 1) { if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.solid[y * m.w + x] = v; }
function rect(m: GameMap, x0: number, y0: number, w: number, h: number, t: TileKind) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setG(m, x, y, t); }

export const BUILDINGS: Building[] = [
  { id: 'mission', name: 'Space Mission Building', label: 'SPACE MISSION', x: 18, y: 2, w: 10, h: 7, roof: '#d86a30', roofDark: '#b04e20', wall: '#ece2d4', door: [23, 8], interior: 'mission' },
  { id: 'command', name: 'HQ Command (co-op teams)', label: 'HQ COMMAND', x: 33, y: 3, w: 9, h: 6, roof: '#3a5cb8', roofDark: '#2a4490', wall: '#ece6d8', door: [37, 8], interior: 'command' },
  { id: 'mcc', name: 'Mission Control', label: 'MISSION CTRL', x: 4, y: 21, w: 10, h: 6, roof: '#38405a', roofDark: '#262c40', wall: '#d8dce4', door: [9, 26], interior: 'mcc' },
  { id: 'academy', name: 'NASA Academy', label: 'ACADEMY', x: 18, y: 23, w: 10, h: 6, roof: '#3a8a4a', roofDark: '#2a6a36', wall: '#efe4cc', door: [23, 28], interior: 'academy' },
  { id: 'archives', name: 'Archives', label: 'ARCHIVES', x: 33, y: 21, w: 9, h: 6, roof: '#7a4ea8', roofDark: '#5c3888', wall: '#e4dcec', door: [37, 26], interior: 'archives' },
];
/** The HQ Command door guard: blocks the door in solo, steps aside in co-op. */
export const GUARD: Npc = { id: 'guard', name: 'Security Guard Rex', pal: 'guard', x: 37, y: 9, dir: 0, talk: 'guard', aside: [36, 9] };

function buildOverworld(): GameMap {
  const W = 46, H = 34;
  const m = blank('overworld', 'NASA HQ CAMPUS', W, H, 'grass', '#5aa43a');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hash2(x, y, 77) < 0.07) setG(m, x, y, 'flowers');
  // Roads & paths
  rect(m, 3, 10, 40, 2, 'path');
  rect(m, 3, 29, 40, 2, 'path');
  rect(m, 14, 10, 2, 21, 'path');
  rect(m, 30, 10, 2, 21, 'path');
  rect(m, 16, 13, 14, 7, 'plaza');
  rect(m, 22, 12, 2, 1, 'path'); rect(m, 22, 20, 2, 9, 'path');
  rect(m, 15, 15, 1, 3, 'plaza'); rect(m, 30, 15, 1, 3, 'plaza');
  // Buildings
  for (const b of BUILDINGS) {
    m.buildings.push(b);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { solid(m, x, y); setG(m, x, y, 'path'); }
    const [dx, dy] = b.door;
    solid(m, dx, dy, 0);
    m.warps.set(key(dx, dy), { map: b.interior, x: 7, y: 10, dir: 3 });
    for (let y = dy + 1; y < (dy < 15 ? 10 : 29); y++) setG(m, dx, y, 'path');
    setG(m, dx - 1, dy + 1, 'path');
    // sign
    const sx = dx + 2, sy = dy + 1;
    m.props.push({ kind: 'sign', x: sx, y: sy }); solid(m, sx, sy);
    m.interact.set(key(sx, sy), { kind: 'sign', label: b.label, text: [`${b.name}`, ...SIGN_TEXT[b.id]] });
  }
  // Fountain (3×3) at the centre of the plaza
  m.props.push({ kind: 'fountain', x: 22, y: 17 });
  for (let y = 15; y <= 17; y++) for (let x = 22; x <= 24; x++) solid(m, x, y);
  m.interact.set(key(23, 18), { kind: 'sign', label: 'Fountain', text: ['A plaque reads: "For all humankind."', 'The water sparkles like a field of stars.'] });
  // Rocket statue & flags
  m.props.push({ kind: 'rocket', x: 39, y: 17 }); solid(m, 39, 17); solid(m, 40, 17);
  m.interact.set(key(39, 18), { kind: 'sign', label: 'Rocket statue', text: ['A model of a three-stage heavy launcher.', 'Each stage drops away so the rest needs less propellant — that is the rocket equation at work.'] });
  m.interact.set(key(40, 18), m.interact.get(key(39, 18))!);
  for (const fx of [19, 26]) { m.props.push({ kind: 'flag', x: fx, y: 9, color: fx === 19 ? '#2c58b8' : '#d84848' }); solid(m, fx, 9); }
  // Lamps along roads
  for (let x = 5; x < 43; x += 6) { if (getG(m, x, 12) === 'grass' || getG(m, x, 12) === 'flowers') { m.props.push({ kind: 'lamp', x, y: 12 }); solid(m, x, 12); } }
  for (let x = 5; x < 43; x += 6) { if (getG(m, x, 28) !== 'path' && !m.solid[28 * W + x]) { m.props.push({ kind: 'lamp', x, y: 28 }); solid(m, x, 28); } }
  // Border trees
  const isOpen = (x: number, y: number) => getG(m, x, y) === 'grass' || getG(m, x, y) === 'flowers';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
    if (border && !m.solid[y * W + x]) { m.props.push({ kind: hash2(x, y, 3) < 0.3 ? 'tree2' : 'tree', x, y }); solid(m, x, y); }
  }
  // Groves & bushes away from paths
  const nearPath = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const g = getG(m, x + dx, y + dy); if (g === 'path' || g === 'plaza') return true; }
    return false;
  };
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    if (m.solid[y * W + x] || !isOpen(x, y) || nearPath(x, y)) continue;
    const r = hash2(x, y, 9);
    const inGrove = (x >= 3 && x <= 12 && y >= 13 && y <= 18) || (x >= 33 && x <= 43 && y >= 12 && y <= 19 && !(x >= 37 && x <= 42 && y >= 14));
    if (inGrove && r < 0.35) { m.props.push({ kind: r < 0.12 ? 'tree2' : 'tree', x, y }); solid(m, x, y); }
    else if (r < 0.04) { m.props.push({ kind: 'bush', x, y }); solid(m, x, y); }
  }
  // Launch pad (decoration, where the old cleanroom stood)
  rect(m, 4, 3, 9, 6, 'concrete');
  for (let x = 4; x < 13; x++) for (let y = 3; y < 9; y++) if (m.props.some((p) => p.x === x && p.y === y)) { m.props = m.props.filter((p) => !(p.x === x && p.y === y)); solid(m, x, y, 0); }
  m.props.push({ kind: 'tower', x: 6, y: 7 }); for (const [x, y] of [[6, 7], [7, 7], [8, 7]]) solid(m, x, y);
  m.props.push({ kind: 'flag', x: 11, y: 5, color: '#2c58b8' }); solid(m, 11, 5);
  m.props.push({ kind: 'sign', x: 10, y: 9 }); solid(m, 10, 9);
  m.interact.set(key(10, 9), { kind: 'sign', label: 'Launch Pad', text: ['LAUNCH PAD 39-HQ', 'Rockets leave from here when you press LAUNCH in the Space Mission building.'] });
  m.npcs.push(GUARD);
  m.npcs.push({ id: 'guide', name: 'Guide Nova', pal: 'guide', x: 26, y: 19, dir: 0, talk: 'guide' });
  m.npcs.push({ id: 'jogger', name: 'Intern Pip', pal: 'sci3', x: 18, y: 14, dir: 2, talk: 'intern', wander: true });
  solid(m, 26, 19); solid(m, 18, 14);
  m.spawn = { x: 22, y: 12, dir: 3 };
  return m;
}

const SIGN_TEXT: Record<string, string[]> = {
  mission: ['Build your spacecraft, pick an orbit and a rocket — then press LAUNCH.'],
  command: ['Co-op teams only: pick roles, read the briefing, plan together.'],
  mcc: ['Live flight, results and replays. Opens after your first launch.'],
  academy: ['How rockets, orbits and satellites work — plus real NASA missions.'],
  archives: ['Every flight you run is saved here. Load, tweak and compare.'],
};

function interior(id: string, name: string, floor: TileKind, bg: string): GameMap {
  const W = 16, H = 12;
  const m = blank(id, name, W, H, floor, bg);
  for (let x = 0; x < W; x++) { setG(m, x, 0, 'wallTop'); setG(m, x, 1, 'wall'); setG(m, x, H - 1, 'wallTop'); solid(m, x, 0); solid(m, x, 1); solid(m, x, H - 1); }
  for (let y = 0; y < H; y++) { setG(m, 0, y, 'wallTop'); setG(m, W - 1, y, 'wallTop'); solid(m, 0, y); solid(m, W - 1, y); }
  for (const x of [7, 8]) { setG(m, x, H - 1, 'exit'); solid(m, x, H - 1, 0); }
  const b = BUILDINGS.find((bb) => bb.interior === id)!;
  for (const x of [7, 8]) m.warps.set(key(x, H - 1), { map: 'overworld', x: b.door[0], y: b.door[1] + 1, dir: 0 });
  m.spawn = { x: 7, y: 10, dir: 3 };
  return m;
}

function addConsole(m: GameMap, x: number, y: number, panel: PanelId, tab: string, label: string, screen?: string) {
  m.props.push({ kind: 'console', x, y, color: screen });
  solid(m, x, y);
  m.interact.set(key(x, y), { kind: 'panel', panel, tab, label });
}
function addScreen(m: GameMap, x: number, w: number, panel: PanelId, tab: string, label: string, screen: 'earth' | 'chart' | 'orbit') {
  m.props.push({ kind: 'screen', x, y: 1, w, screen });
  for (let i = 0; i < w; i++) m.interact.set(key(x + i, 1), { kind: 'panel', panel, tab, label });
}
function addNpc(m: GameMap, n: Npc) { m.npcs.push(n); solid(m, n.x, n.y); }
function addProp(m: GameMap, p: Prop, solidTiles: [number, number][] = [[p.x, p.y]]) { m.props.push(p); for (const [x, y] of solidTiles) solid(m, x, y); }

function buildInteriors(): GameMap[] {
  const out: GameMap[] = [];
  // Space Mission building: everything to design and launch
  {
    const m = interior('mission', 'SPACE MISSION', 'clean', '#c8d8e8');
    addScreen(m, 5, 6, 'mission', 'build', 'Mission Designer', 'orbit');
    addProp(m, { kind: 'sc', x: 6, y: 6 }, [[6, 5], [7, 5], [8, 5], [6, 6], [7, 6], [8, 6]]);
    for (const [x, y] of [[6, 7], [7, 7], [8, 7], [5, 5], [5, 6], [9, 5], [9, 6], [6, 5], [7, 5], [8, 5], [6, 6], [7, 6], [8, 6]]) m.interact.set(key(x, y), { kind: 'panel', panel: 'mission', tab: 'build', label: 'Spacecraft' });
    addConsole(m, 2, 2, 'mission', 'build', 'Spacecraft Designer', '#58b8f8');
    addConsole(m, 3, 2, 'mission', 'build', 'Spacecraft Designer', '#58b8f8');
    addConsole(m, 12, 2, 'mission', 'launch', 'Launch Console', '#f84848');
    addConsole(m, 13, 2, 'mission', 'launch', 'Launch Console', '#f84848');
    addProp(m, { kind: 'rocket', x: 12, y: 8 }, [[12, 8], [13, 8], [12, 7], [13, 7]]);
    for (const [x, y] of [[11, 8], [11, 7], [14, 8], [12, 9], [13, 9]]) m.interact.set(key(x, y), { kind: 'panel', panel: 'mission', tab: 'launch', label: 'Launch Console' });
    addNpc(m, { id: 'kai', name: 'Engineer Kai', pal: 'engineer', x: 3, y: 7, dir: 2, talk: 'kai' });
    addProp(m, { kind: 'plant', x: 1, y: 9 });
    out.push(m);
  }
  // HQ Command (co-op)
  {
    const m = interior('command', 'HQ COMMAND', 'carpet', '#1e2a50');
    rect(m, 5, 5, 6, 4, 'rug');
    addScreen(m, 5, 6, 'command', 'brief', 'Mission Briefing', 'earth');
    addConsole(m, 2, 2, 'command', 'roles', 'Team Roles', '#f2c14e');
    addConsole(m, 13, 2, 'command', 'plan', 'Team Strategy', '#58b8f8');
    addProp(m, { kind: 'desk', x: 6, y: 4 }, [[6, 4], [7, 4]]);
    addProp(m, { kind: 'desk', x: 8, y: 4 }, [[8, 4], [9, 4]]);
    for (const x of [6, 7, 8, 9]) m.interact.set(key(x, 4), { kind: 'panel', panel: 'command', tab: 'brief', label: 'Briefing Table' });
    addNpc(m, { id: 'vega', name: 'Administrator Vega', pal: 'admin', x: 7, y: 3, dir: 0, talk: 'vega' });
    addProp(m, { kind: 'plant', x: 1, y: 9 }); addProp(m, { kind: 'plant', x: 14, y: 9 });
    addProp(m, { kind: 'flag', x: 1, y: 3, color: '#2c58b8' }); addProp(m, { kind: 'flag', x: 14, y: 3, color: '#d84848' });
    out.push(m);
  }
  // Mission Control
  {
    const m = interior('mcc', 'MISSION CONTROL', 'dark', '#0e1424');
    addScreen(m, 2, 5, 'mcc', 'live', 'Telemetry Wall', 'chart');
    addScreen(m, 9, 5, 'mcc', 'results', 'Results Wall', 'earth');
    for (const [x, tab, label, c] of [[3, 'live', 'Live Telemetry', '#48f878'], [5, 'live', 'Flight Dynamics', '#48f878'], [7, 'results', 'Results', '#f8a848'], [9, 'results', 'Subsystems', '#f8a848'], [11, 'replay', '3D Replay', '#58b8f8']] as [number, string, string, string][]) addConsole(m, x, 5, 'mcc', tab, label, c);
    for (const x of [3, 5, 7, 9, 11]) addProp(m, { kind: 'chair', x, y: 6 }, []);
    addNpc(m, { id: 'reyes', name: 'Flight Controller Reyes', pal: 'flight', x: 13, y: 9, dir: 1, talk: 'reyes' });
    out.push(m);
  }
  // Archives
  {
    const m = interior('archives', 'ARCHIVES', 'vaultfloor', '#1a1e2a');
    for (const x of [1, 2, 3, 12, 13, 14]) for (const y of [3, 6]) addProp(m, { kind: 'rack', x, y, variant: x * 10 + y });
    addConsole(m, 6, 2, 'archives', 'runs', 'Past Runs', '#c878f8');
    addConsole(m, 9, 2, 'archives', 'compare', 'Compare Runs', '#58b8f8');
    addNpc(m, { id: 'ortiz', name: 'Archivist Ortiz', pal: 'archivist', x: 8, y: 5, dir: 0, talk: 'ortiz' });
    out.push(m);
  }
  // Academy
  {
    const m = interior('academy', 'NASA ACADEMY', 'wood', '#3a2a18');
    for (const x of [1, 2, 3, 5, 6, 9, 10, 12, 13, 14]) addProp(m, { kind: 'shelf', x, y: 2, variant: x });
    for (const [x, tab, label] of [[4, 'basics', 'How space works'], [7, 'basics', 'How space works'], [8, 'missions', 'Real NASA missions'], [11, 'missions', 'Real NASA missions']] as [number, string, string][]) {
      m.props.push({ kind: 'kiosk', x, y: 2 }); solid(m, x, 2); m.interact.set(key(x, 2), { kind: 'panel', panel: 'academy', tab, label });
    }
    addProp(m, { kind: 'desk', x: 6, y: 6 }, [[6, 6], [7, 6]]);
    addProp(m, { kind: 'desk', x: 8, y: 6 }, [[8, 6], [9, 6]]);
    for (const x of [6, 7, 8, 9]) m.interact.set(key(x, 6), { kind: 'panel', panel: 'academy', tab: 'basics', label: 'Study desk' });
    addNpc(m, { id: 'orbit', name: 'Dr. Kepler-Ray', pal: 'sci1', x: 2, y: 5, dir: 2, talk: 'drorbit' });
    addNpc(m, { id: 'watt', name: 'Dr. Watt', pal: 'sci2', x: 13, y: 5, dir: 1, talk: 'drwatt' });
    addNpc(m, { id: 'link', name: 'Dr. Shannon', pal: 'sci3', x: 3, y: 8, dir: 2, talk: 'drlink' });
    addNpc(m, { id: 'rad', name: 'Dr. Van Allen-Ito', pal: 'sci4', x: 12, y: 8, dir: 1, talk: 'drrad' });
    addProp(m, { kind: 'plant', x: 1, y: 9 }); addProp(m, { kind: 'plant', x: 14, y: 9 });
    out.push(m);
  }
  return out;
}

let MAPS: Record<string, GameMap> | null = null;
export function getMaps(): Record<string, GameMap> {
  if (!MAPS) {
    MAPS = { overworld: buildOverworld() };
    for (const m of buildInteriors()) MAPS[m.id] = m;
  }
  return MAPS;
}
export const tileKey = key;
