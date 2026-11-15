// Procedural pixel art: every tile, prop and character is painted with fillRect
// into small cached canvases at load time — no external image assets needed.
export const TS = 16;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

// deterministic per-tile noise
export function hash2(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const px = (c: Ctx, color: string, x: number, y: number, w = 1, h = 1) => { c.fillStyle = color; c.fillRect(x, y, w, h); };

export const PAL = {
  grass: ['#7ccc54', '#68b844', '#94dc6c', '#5aa43a'],
  path: ['#e2d2a6', '#cfbe90', '#efe2bd', '#b8a77a'],
  plaza: ['#d8d4cc', '#c4c0b8', '#ecebe6', '#a8a49c'],
  road: ['#7a7f8a', '#6a6f7a', '#8c919c'],
  water: ['#3d8bf0', '#5aa6f8', '#9ccff8', '#2a6cc8'],
  treeDark: '#256b34', tree: '#3a8f45', treeLight: '#5cb85a', trunk: '#7a4e2a', trunkDark: '#5a3418',
  outline: '#1e2430',
};

// ── Ground tiles ─────────────────────────────────────────────────────────────
export type TileKind =
  | 'grass' | 'flowers' | 'path' | 'plaza' | 'road' | 'water' | 'sand'
  | 'wood' | 'carpet' | 'clean' | 'dark' | 'concrete' | 'vaultfloor' | 'wall' | 'wallTop' | 'exit' | 'rug';

export function paintGround(c: Ctx, kind: TileKind, tx: number, ty: number, ox: number, oy: number) {
  const r = hash2(tx, ty);
  switch (kind) {
    case 'grass': case 'flowers': {
      px(c, PAL.grass[0], ox, oy, TS, TS);
      for (let i = 0; i < 6; i++) {
        const a = hash2(tx, ty, i + 1), b = hash2(tx, ty, i + 11);
        const x = ox + Math.floor(a * 15), y = oy + Math.floor(b * 14);
        px(c, i % 2 ? PAL.grass[1] : PAL.grass[2], x, y, 1, 2);
      }
      if (r < 0.15) { px(c, PAL.grass[3], ox + 4, oy + 9, 1, 3); px(c, PAL.grass[3], ox + 6, oy + 10, 1, 2); px(c, PAL.grass[3], ox + 5, oy + 8, 1, 4); }
      if (kind === 'flowers') {
        const cols = ['#f85878', '#f8e048', '#ffffff', '#c878f8'];
        for (let i = 0; i < 3; i++) {
          const x = ox + 2 + Math.floor(hash2(tx, ty, 30 + i) * 11), y = oy + 2 + Math.floor(hash2(tx, ty, 40 + i) * 11);
          const col = cols[Math.floor(hash2(tx, ty, 50 + i) * cols.length)];
          px(c, col, x, y, 2, 2); px(c, '#f8f8a0', x, y, 1, 1); px(c, PAL.grass[3], x + 1, y + 2, 1, 2);
        }
      }
      break;
    }
    case 'path': {
      px(c, PAL.path[0], ox, oy, TS, TS);
      for (let i = 0; i < 5; i++) px(c, i % 2 ? PAL.path[1] : PAL.path[2], ox + Math.floor(hash2(tx, ty, i) * 14), oy + Math.floor(hash2(tx, ty, i + 9) * 14), 2, 1);
      break;
    }
    case 'plaza': {
      px(c, PAL.plaza[0], ox, oy, TS, TS);
      px(c, PAL.plaza[1], ox, oy + 15, TS, 1); px(c, PAL.plaza[1], ox + 15, oy, 1, TS);
      px(c, PAL.plaza[2], ox, oy, 15, 1); px(c, PAL.plaza[2], ox, oy, 1, 15);
      if (r < 0.2) px(c, PAL.plaza[3], ox + 5 + Math.floor(r * 30), oy + 7, 2, 1);
      break;
    }
    case 'road': {
      px(c, PAL.road[0], ox, oy, TS, TS);
      for (let i = 0; i < 4; i++) px(c, PAL.road[i % 2 ? 1 : 2], ox + Math.floor(hash2(tx, ty, i) * 15), oy + Math.floor(hash2(tx, ty, i + 5) * 15), 1, 1);
      break;
    }
    case 'sand': px(c, '#f0dca0', ox, oy, TS, TS); px(c, '#e0c888', ox + Math.floor(r * 12), oy + 5, 2, 1); break;
    case 'water': {
      px(c, PAL.water[0], ox, oy, TS, TS);
      px(c, PAL.water[1], ox + 2, oy + 4, 5, 1); px(c, PAL.water[1], ox + 9, oy + 11, 5, 1);
      break;
    }
    case 'wood': {
      px(c, '#c89858', ox, oy, TS, TS);
      for (let y = 0; y < TS; y += 4) px(c, '#b08040', ox, oy + y + 3, TS, 1);
      px(c, '#a87838', ox + ((ty % 2) ? 5 : 11), oy, 1, TS);
      px(c, '#d8a868', ox, oy, TS, 1);
      break;
    }
    case 'carpet': {
      px(c, '#3e5aa8', ox, oy, TS, TS);
      if ((tx + ty) % 2 === 0) px(c, '#4866b8', ox + 2, oy + 2, 12, 12);
      px(c, '#344c90', ox + 7, oy + 7, 2, 2);
      break;
    }
    case 'rug': {
      px(c, '#a83848', ox, oy, TS, TS); px(c, '#c84858', ox + 1, oy + 1, 14, 14); px(c, '#e8c060', ox + 3, oy + 3, 10, 1); px(c, '#e8c060', ox + 3, oy + 12, 10, 1);
      break;
    }
    case 'clean': {
      px(c, '#e6eef6', ox, oy, TS, TS); px(c, '#cdd8e4', ox, oy + 15, TS, 1); px(c, '#cdd8e4', ox + 15, oy, 1, TS); px(c, '#f6fafe', ox + 1, oy + 1, 6, 1);
      break;
    }
    case 'dark': {
      px(c, '#2a3248', ox, oy, TS, TS); px(c, '#323c56', ox, oy, 15, 15); px(c, '#222a3c', ox + 15, oy, 1, TS); px(c, '#222a3c', ox, oy + 15, TS, 1);
      if ((tx + ty) % 4 === 0) px(c, '#3a4664', ox + 6, oy + 6, 3, 3);
      break;
    }
    case 'concrete': {
      px(c, '#b4b4ac', ox, oy, TS, TS); px(c, '#a2a29a', ox, oy + 15, TS, 1); px(c, '#a2a29a', ox + 15, oy, 1, TS);
      if (r < 0.3) px(c, '#9a9a92', ox + Math.floor(r * 40), oy + 4, 3, 1);
      if (ty % 6 === 0) px(c, '#e8c040', ox, oy + 7, TS, 2);
      break;
    }
    case 'vaultfloor': {
      px(c, '#46506a', ox, oy, TS, TS); px(c, '#525e7c', ox + 1, oy + 1, 14, 14);
      px(c, '#3a4258', ox + 4, oy + 4, 1, 1); px(c, '#3a4258', ox + 11, oy + 4, 1, 1); px(c, '#3a4258', ox + 4, oy + 11, 1, 1); px(c, '#3a4258', ox + 11, oy + 11, 1, 1);
      break;
    }
    case 'wall': {
      px(c, '#d8d0c0', ox, oy, TS, TS); px(c, '#c4bca8', ox, oy + 12, TS, 4); px(c, '#a89c84', ox, oy + 15, TS, 1);
      px(c, '#e8e2d4', ox, oy, TS, 1);
      break;
    }
    case 'wallTop': {
      px(c, '#5a5470', ox, oy, TS, TS); px(c, '#6a6484', ox, oy, TS, 3); px(c, '#4a4460', ox, oy + 14, TS, 2);
      break;
    }
    case 'exit': {
      px(c, '#7a5a3a', ox, oy, TS, TS); px(c, '#9a7448', ox + 1, oy + 1, 14, 14); px(c, '#c8a060', ox + 3, oy + 7, 10, 2);
      px(c, '#f8e8a0', ox + 7, oy + 3, 2, 2);
      break;
    }
  }
}

// ── Props (drawn y-sorted) ───────────────────────────────────────────────────
export function makeTree(variant = 0): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  const dark = variant ? '#1f5a30' : PAL.treeDark, mid = variant ? '#2f7a3c' : PAL.tree, light = variant ? '#4a9c4c' : PAL.treeLight;
  px(c, 'rgba(0,0,0,0.25)', 2, 28, 12, 3);
  px(c, PAL.trunkDark, 6, 22, 4, 8); px(c, PAL.trunk, 7, 22, 2, 8);
  const blob = [[5, 2, 6, 2], [3, 4, 10, 2], [2, 6, 12, 4], [1, 10, 14, 6], [2, 16, 12, 4], [4, 20, 8, 2]];
  for (const [x, y, w, h] of blob) px(c, PAL.outline, x - 1, y - 1, w + 2, h + 2);
  for (const [x, y, w, h] of blob) px(c, dark, x, y, w, h);
  px(c, mid, 3, 4, 9, 13); px(c, mid, 2, 10, 11, 6);
  px(c, light, 5, 4, 4, 2); px(c, light, 4, 6, 3, 4); px(c, light, 9, 9, 3, 2); px(c, light, 6, 12, 2, 2);
  return cv;
}

export function makeBush(): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS);
  px(c, PAL.outline, 1, 4, 14, 11); px(c, PAL.treeDark, 2, 5, 12, 9); px(c, PAL.tree, 3, 5, 9, 6); px(c, PAL.treeLight, 4, 6, 3, 2); px(c, PAL.treeLight, 9, 8, 2, 2);
  return cv;
}

export function makeLamp(): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, 'rgba(0,0,0,0.25)', 4, 29, 8, 2);
  px(c, '#2c3040', 7, 8, 2, 22); px(c, '#2c3040', 5, 28, 6, 2);
  px(c, '#2c3040', 4, 3, 8, 6); px(c, '#fff4b0', 5, 4, 6, 4); px(c, '#ffffff', 6, 5, 2, 2);
  return cv;
}

export function makeSign(): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS);
  px(c, '#5a3418', 7, 9, 2, 6); px(c, PAL.outline, 1, 2, 14, 9); px(c, '#c89858', 2, 3, 12, 7); px(c, '#a87838', 4, 5, 8, 1); px(c, '#a87838', 4, 7, 6, 1);
  return cv;
}

export function makeFountain(frame: number): HTMLCanvasElement {
  const [cv, c] = canvas(TS * 3, TS * 3);
  px(c, '#8a8a92', 2, 8, 44, 36); px(c, '#b0b0b8', 3, 9, 42, 34); px(c, '#9a9aa2', 3, 40, 42, 3);
  px(c, PAL.water[0], 6, 12, 36, 28); px(c, PAL.water[1], 8 + frame * 2, 16, 8, 1); px(c, PAL.water[1], 26 - frame * 2, 32, 9, 1); px(c, PAL.water[2], 14, 24 + frame, 6, 1);
  px(c, '#b0b0b8', 20, 18, 8, 12); px(c, '#d0d0d8', 21, 18, 6, 2);
  const h = 6 + frame * 2;
  px(c, PAL.water[2], 23, 18 - h, 2, h); px(c, '#ffffff', 23, 18 - h, 2, 2);
  px(c, PAL.water[2], 19 - frame, 14 - frame, 2, 4); px(c, PAL.water[2], 27 + frame, 14 - frame, 2, 4);
  return cv;
}

export function makeRocketStatue(): HTMLCanvasElement {
  const [cv, c] = canvas(TS * 2, TS * 5);
  px(c, 'rgba(0,0,0,0.3)', 3, 76, 26, 3);
  px(c, '#7a7a82', 4, 68, 24, 10); px(c, '#9a9aa2', 5, 69, 22, 8);
  px(c, PAL.outline, 10, 6, 12, 64);
  px(c, '#f4f4f4', 11, 14, 10, 54); px(c, '#d8d8d8', 18, 14, 3, 54);
  px(c, '#1e2430', 11, 30, 10, 3); px(c, '#1e2430', 11, 50, 10, 3);
  px(c, '#d84830', 12, 4, 8, 10); px(c, '#d84830', 14, 1, 4, 4); px(c, '#f06848', 13, 5, 2, 7);
  px(c, '#2c58b8', 6, 58, 5, 10); px(c, '#2c58b8', 21, 58, 5, 10);
  px(c, '#60a0f8', 14, 20, 4, 4); px(c, '#ffffff', 14, 20, 2, 2);
  return cv;
}

export function makeFlag(frame: number, color = '#2c58b8'): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 3);
  px(c, '#c8c8d0', 2, 2, 1, 44); px(c, '#f0d060', 1, 1, 3, 2); px(c, '#6a6a72', 0, 44, 5, 3);
  const w = frame ? 10 : 9;
  px(c, color, 3, 4, w, 7); px(c, '#ffffff', 5, 6, 3, 1); px(c, '#ffffff', 5, 8, 5, 1);
  if (frame) px(c, color, 13, 5, 1, 5);
  return cv;
}

export function makeLaunchTower(): HTMLCanvasElement {
  const [cv, c] = canvas(TS * 3, TS * 6);
  px(c, 'rgba(0,0,0,0.3)', 0, 92, 48, 3);
  px(c, '#9a9a92', 0, 84, 48, 10);
  for (let y = 6; y < 86; y += 8) { px(c, '#c84020', 2, y, 12, 2); px(c, '#c84020', 2, y, 2, 8); px(c, '#c84020', 12, y, 2, 8); }
  px(c, '#a83018', 7, 2, 2, 84);
  px(c, PAL.outline, 24, 10, 14, 76); px(c, '#f4f4f4', 25, 18, 12, 66); px(c, '#d8d8d8', 33, 18, 4, 66);
  px(c, '#1e2430', 25, 40, 12, 3); px(c, '#1e2430', 25, 62, 12, 3);
  px(c, '#e05030', 26, 8, 10, 10); px(c, '#e05030', 29, 4, 4, 5);
  px(c, '#2c58b8', 20, 72, 5, 12); px(c, '#2c58b8', 37, 72, 5, 12);
  px(c, '#a83018', 14, 30, 11, 2);
  return cv;
}

// ── Interior furniture ───────────────────────────────────────────────────────
export function makeConsole(frame: number, screen = '#2ce06a', body = '#4a5068'): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, 'rgba(0,0,0,0.25)', 1, 29, 14, 3);
  px(c, PAL.outline, 0, 6, 16, 24); px(c, body, 1, 7, 14, 22); px(c, '#6a7290', 1, 7, 14, 2);
  px(c, '#10161e', 2, 9, 12, 9); px(c, screen, 3, 10, 10, 7);
  px(c, '#10161e', 4, 11 + (frame % 3) * 2, 7, 1); px(c, '#10161e', 4, 15 - (frame % 2) * 2, 5, 1);
  px(c, '#30364a', 2, 20, 12, 7);
  const leds = ['#f84848', '#f8d848', '#48f878'];
  for (let i = 0; i < 3; i++) px(c, frame % 3 === i ? leds[i] : '#202430', 4 + i * 3, 22, 2, 2);
  px(c, '#8a92b0', 4, 25, 8, 1);
  return cv;
}

export function makeBigScreen(frame: number, w = 4, kind: 'earth' | 'chart' | 'orbit' = 'earth'): HTMLCanvasElement {
  const [cv, c] = canvas(TS * w, TS * 2);
  const W = TS * w;
  px(c, PAL.outline, 0, 0, W, 28); px(c, '#3a4058', 1, 1, W - 2, 26); px(c, '#06121e', 3, 3, W - 6, 22);
  if (kind === 'earth') {
    const cx = W / 2, cy = 14;
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) if (x * x + y * y <= 81) px(c, (x + frame * 2 + y * 0.5) % 7 < 3 ? '#3aa860' : '#2a6ad0', cx + x, cy + y);
    px(c, '#ffffff', cx - 4, cy - 7, 3, 1);
    const ang = frame * 0.6;
    px(c, '#f8e048', cx + Math.round(Math.cos(ang) * 13), cy + Math.round(Math.sin(ang) * 7), 2, 2);
  } else if (kind === 'chart') {
    for (let x = 4; x < W - 4; x++) { const y = 14 + Math.round(Math.sin((x + frame * 3) / 5) * 6); px(c, '#48f878', x, y); }
    for (let x = 4; x < W - 4; x += 6) px(c, '#1a3040', x, 4, 1, 20);
  } else {
    px(c, '#f8d048', W / 2 - 3, 11, 6, 6);
    for (let a = 0; a < 40; a++) { const t = (a / 40) * Math.PI * 2; px(c, '#5a7aa8', W / 2 + Math.round(Math.cos(t) * (W / 2 - 8)), 14 + Math.round(Math.sin(t) * 8)); }
    const t = frame * 0.5; px(c, '#ffffff', W / 2 + Math.round(Math.cos(t) * (W / 2 - 8)) - 1, 14 + Math.round(Math.sin(t) * 8) - 1, 3, 3);
  }
  return cv;
}

export function makeDesk(): HTMLCanvasElement {
  const [cv, c] = canvas(TS * 2, TS);
  px(c, PAL.outline, 0, 2, 32, 12); px(c, '#9a6a38', 1, 3, 30, 6); px(c, '#7a4e28', 1, 9, 30, 4); px(c, '#b08048', 1, 3, 30, 1);
  px(c, '#e8e8f0', 4, 0, 8, 5); px(c, '#3a3a48', 5, 1, 6, 3); px(c, '#f8f8f8', 20, 4, 6, 2);
  return cv;
}

export function makeShelf(seed: number): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, PAL.outline, 0, 0, 16, 32); px(c, '#7a4e28', 1, 1, 14, 30);
  const cols = ['#c83838', '#3858c8', '#38a848', '#d8a838', '#8838c8', '#e8e8e8'];
  for (let row = 0; row < 3; row++) {
    px(c, '#5a3418', 1, 10 + row * 10, 14, 1);
    let x = 2;
    while (x < 14) { const w = 1 + Math.floor(hash2(seed, row, x) * 2); px(c, cols[Math.floor(hash2(seed, row, x + 7) * cols.length)], x, 3 + row * 10, w, 7); x += w + 0; }
  }
  return cv;
}

export function makeRack(frame: number, seed: number): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, PAL.outline, 0, 0, 16, 32); px(c, '#2a2e3c', 1, 1, 14, 30);
  for (let i = 0; i < 6; i++) {
    px(c, '#3a4054', 2, 3 + i * 4, 12, 3);
    const on = hash2(seed, i, frame) > 0.4;
    px(c, on ? '#48f878' : '#1a3a20', 3, 4 + i * 4, 1, 1);
    px(c, hash2(seed, i, frame + 9) > 0.7 ? '#f8a848' : '#3a2a10', 5, 4 + i * 4, 1, 1);
  }
  return cv;
}

export function makePlant(): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, PAL.outline, 3, 22, 10, 9); px(c, '#c86838', 4, 23, 8, 7); px(c, '#e08850', 4, 23, 8, 1);
  px(c, PAL.outline, 2, 8, 12, 15); px(c, '#2f7a3c', 3, 9, 10, 13); px(c, '#4fa85a', 5, 10, 3, 5); px(c, '#4fa85a', 9, 14, 2, 4); px(c, '#2f7a3c', 7, 5, 2, 5);
  return cv;
}

export function makeSpacecraftStand(frame: number): HTMLCanvasElement {
  const [cv, c] = canvas(TS * 3, TS * 3);
  px(c, 'rgba(0,0,0,0.2)', 6, 42, 36, 4);
  px(c, '#8a92a8', 18, 30, 12, 14); px(c, '#6a7288', 14, 42, 20, 3);
  px(c, PAL.outline, 15, 10, 18, 20); px(c, '#d8b040', 16, 11, 16, 18); px(c, '#f0d060', 16, 11, 16, 3); px(c, '#b89030', 28, 11, 4, 18);
  px(c, PAL.outline, 0, 15, 15, 10); px(c, '#2a48a8', 1, 16, 13, 8); px(c, PAL.outline, 33, 15, 15, 10); px(c, '#2a48a8', 34, 16, 13, 8);
  for (let x = 3; x < 14; x += 3) { px(c, '#4a6ad0', x, 16, 1, 8); px(c, '#4a6ad0', 33 + x, 16, 1, 8); }
  px(c, '#e8e8f0', 20, 3, 8, 3); px(c, '#c8c8d0', 23, 6, 2, 5); px(c, frame % 2 ? '#f84848' : '#801818', 23, 2, 2, 1);
  return cv;
}

export function makeChair(): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS);
  px(c, PAL.outline, 3, 2, 10, 12); px(c, '#3a4880', 4, 3, 8, 5); px(c, '#4a5aa0', 4, 8, 8, 4); px(c, '#2a2e3c', 7, 12, 2, 3);
  return cv;
}

export function makeKiosk(frame: number): HTMLCanvasElement {
  const [cv, c] = canvas(TS, TS * 2);
  px(c, PAL.outline, 3, 4, 10, 26); px(c, '#e8e8f0', 4, 5, 8, 24); px(c, '#1a2a48', 5, 7, 6, 8); px(c, '#58a8f8', 6, 8, 4, 6);
  px(c, '#f8f8a0', 6 + (frame % 2) * 2, 9, 2, 2); px(c, '#c84848', 5, 18, 6, 2); px(c, '#a0a0b0', 6, 22, 4, 6);
  return cv;
}

// ── Characters ───────────────────────────────────────────────────────────────
export interface CharPal { hair: string; skin: string; shirt: string; pants: string; accent?: string; coat?: boolean; helmet?: boolean; cap?: boolean }

export const AVATARS: CharPal[] = [
  { hair: '#3a2818', skin: '#f2c49a', shirt: '#2c58b8', pants: '#2a2e3c' },
  { hair: '#e8c060', skin: '#f6d2b0', shirt: '#d84848', pants: '#3a3a48' },
  { hair: '#1a1a1a', skin: '#a86c48', shirt: '#38a858', pants: '#2a3a5a' },
  { hair: '#b84828', skin: '#f2c49a', shirt: '#e89830', pants: '#4a3a2a' },
  { hair: '#5a3a6a', skin: '#c88c64', shirt: '#8848c8', pants: '#2a2e3c' },
  { hair: '#e8e8e8', skin: '#7a4a2a', shirt: '#30a8b8', pants: '#3a3a48' },
];

/** dir: 0 down, 1 left, 2 right, 3 up. frame: 0 stand, 1/2 step. 16×20 sprite drawn with feet at (x+8, y+19). */
export function drawCharacter(c: Ctx, x: number, y: number, dir: number, frame: number, p: CharPal, badge?: string) {
  const o = PAL.outline;
  px(c, 'rgba(0,0,0,0.25)', x + 3, y + 18, 10, 2);
  const step = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  const bob = frame === 0 ? 0 : 1;
  const Y = y + bob;
  // legs
  if (dir === 0 || dir === 3) {
    px(c, o, x + 4, Y + 13, 8, 6 - bob);
    px(c, p.pants, x + 5, Y + 13, 2, step === 1 ? 4 : 5 - bob); px(c, p.pants, x + 9, Y + 13, 2, step === -1 ? 4 : 5 - bob);
  } else {
    px(c, o, x + 5, Y + 13, 6, 6 - bob);
    px(c, p.pants, x + 6 + (step === 1 ? -1 : 0), Y + 13, 2, 5 - bob); px(c, p.pants, x + 8 + (step === -1 ? 1 : 0), Y + 13, 2, 5 - bob);
  }
  // body
  const shirt = p.coat ? '#f4f4f8' : p.shirt;
  px(c, o, x + 3, Y + 7, 10, 7);
  px(c, shirt, x + 4, Y + 8, 8, 5);
  if (p.coat) { px(c, p.shirt, x + 7, Y + 8, 2, 5); px(c, '#d8d8e0', x + 4, Y + 12, 8, 1); }
  // arms
  const armSwing = dir === 0 || dir === 3 ? step : 0;
  if (dir !== 2) px(c, p.skin, x + 3, Y + 9 + (armSwing > 0 ? 1 : 0), 1, 3);
  if (dir !== 1) px(c, p.skin, x + 12, Y + 9 + (armSwing < 0 ? 1 : 0), 1, 3);
  if (badge && dir !== 3) px(c, badge, x + (dir === 1 ? 5 : dir === 2 ? 9 : 9), Y + 9, 2, 2);
  // head
  px(c, o, x + 3, Y - 1, 10, 9);
  px(c, p.skin, x + 4, Y, 8, 7);
  if (p.helmet) { px(c, '#f4f4f8', x + 3, Y - 2, 10, 4); px(c, '#88c8f8', x + 4, Y + 1, 8, 3); }
  else if (dir === 3) px(c, p.hair, x + 4, Y, 8, 7);
  else {
    px(c, p.hair, x + 4, Y, 8, 2);
    if (dir === 1) { px(c, p.hair, x + 9, Y, 3, 5); px(c, o, x + 5, Y + 3, 1, 2); }
    else if (dir === 2) { px(c, p.hair, x + 4, Y, 3, 5); px(c, o, x + 10, Y + 3, 1, 2); }
    else { px(c, p.hair, x + 4, Y + 2, 1, 2); px(c, p.hair, x + 11, Y + 2, 1, 2); px(c, o, x + 6, Y + 3, 1, 2); px(c, o, x + 9, Y + 3, 1, 2); px(c, '#e89090', x + 5, Y + 5, 1, 1); px(c, '#e89090', x + 10, Y + 5, 1, 1); }
  }
  if (p.cap) {
    px(c, o, x + 3, Y - 3, 10, 4); px(c, p.shirt, x + 4, Y - 2, 8, 3);
    if (dir === 0) px(c, o, x + 3, Y + 1, 10, 1); else if (dir === 1) px(c, o, x + 1, Y + 1, 6, 1); else if (dir === 2) px(c, o, x + 9, Y + 1, 6, 1);
    if (dir !== 3) px(c, p.accent ?? '#f2c14e', x + 7, Y - 2, 2, 2);
    if (dir !== 3) px(c, p.accent ?? '#f2c14e', x + (dir === 2 ? 9 : 5), Y + 9, 2, 2);
  }
}

export const NPC_PALS: Record<string, CharPal> = {
  admin: { hair: '#6a6a6a', skin: '#e8b890', shirt: '#2c3a6a', pants: '#1e2430' },
  engineer: { hair: '#1a1a1a', skin: '#c88c64', shirt: '#4ea8de', pants: '#e8e8f0', helmet: true },
  launch: { hair: '#a84828', skin: '#f2c49a', shirt: '#e86830', pants: '#3a3a48' },
  flight: { hair: '#2a1a10', skin: '#8a5a3a', shirt: '#f4f4f8', pants: '#2a2e3c', accent: '#1e2430' },
  archivist: { hair: '#d8d8d8', skin: '#f6d2b0', shirt: '#6a4a8a', pants: '#2a2e3c' },
  sci1: { hair: '#3a2818', skin: '#f2c49a', shirt: '#38a858', pants: '#2a2e3c', coat: true },
  sci2: { hair: '#1a1a1a', skin: '#a86c48', shirt: '#d84848', pants: '#2a2e3c', coat: true },
  sci3: { hair: '#e8c060', skin: '#f6d2b0', shirt: '#2c58b8', pants: '#2a2e3c', coat: true },
  sci4: { hair: '#5a3a6a', skin: '#c88c64', shirt: '#e89830', pants: '#2a2e3c', coat: true },
  guide: { hair: '#b84828', skin: '#f2c49a', shirt: '#f2c14e', pants: '#2a3a5a' },
  guard: { hair: '#1a1a24', skin: '#c88c64', shirt: '#24346e', pants: '#141a30', accent: '#f2c14e', cap: true },
};
