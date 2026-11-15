// Top-down tile engine: grid movement with smooth interpolation (Gen-3 style),
// y-sorted props & characters, building interiors with fade transitions,
// remote players interpolated from presence, and interaction prompts.
import { getMaps, tileKey, type GameMap, type Interactable, type Npc, type Prop } from './maps';
import {
  AVATARS, NPC_PALS, TS, drawCharacter, makeBigScreen, makeBush, makeChair, makeConsole, makeDesk, makeFlag, makeFountain, makeKiosk, makeLamp,
  makeLaunchTower, makePlant, makeRack, makeRocketStatue, makeShelf, makeSign, makeSpacecraftStand, makeTree, paintGround, PAL,
} from './sprites';
import type { Presence } from '../../shared/protocol';

export interface RemotePlayer { id: string; name: string; avatar: number; color: string; badge: string; map: string; x: number; y: number; dir: number; moving: boolean; emote?: string }
export interface EngineHooks {
  blocked: () => boolean;
  onInteract: (it: Interactable | null, npc: Npc | null) => void;
  onMapChange: (mapId: string, name: string) => void;
  onPresence: (p: Omit<Presence, 'id'>) => void;
  remotes: () => RemotePlayer[];
  me: () => { name: string; avatar: number; color: string; badge: string };
  /** NPCs with an `aside` spot step there while this returns true (HQ guard in co-op). */
  npcAside?: (id: string) => boolean;
  /** Locked building interiors return the message to show at the door. */
  doorLock?: (interior: string) => { speaker: string; lines: string[] } | null;
  onLocked?: (msg: { speaker: string; lines: string[] }) => void;
}

const DIRS: Record<number, [number, number]> = { 0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1] };
const KEYMAP: Record<string, number> = { ArrowDown: 0, s: 0, S: 0, ArrowLeft: 1, a: 1, A: 1, ArrowRight: 2, d: 2, D: 2, ArrowUp: 3, w: 3, W: 3 };
const INTERACT = new Set(['e', 'E', ' ', 'Enter', 'z', 'Z']);

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private b: CanvasRenderingContext2D;
  private hooks: EngineHooks;
  private maps = getMaps();
  map: GameMap;
  private groundCache = new Map<string, HTMLCanvasElement>();
  private sprites: Record<string, HTMLCanvasElement | HTMLCanvasElement[]> = {};
  private scale = 3;
  private raf = 0;
  private lastT = 0;
  private time = 0;
  private held: number[] = [];
  private virtual: number | null = null;
  private running = false;
  // player
  px = 0; py = 0; private tx = 0; private ty = 0; private fx = 0; private fy = 0; private prog = 1; dir = 0;
  private stepFrame = 0; private turnTimer = 0; private run = false;
  private fade = 0; private fadeDir = 0; private pendingWarp: { map: string; x: number; y: number; dir: number } | null = null;
  private banner = { text: '', t: 0 };
  private remoteState = new Map<string, { x: number; y: number; dir: number; moving: boolean; anim: number }>();
  private npcState = new Map<string, { x: number; y: number; dir: number; timer: number; fx: number; fy: number; prog: number }>();
  private lastPresence = 0;
  private lastSent = '';

  constructor(canvas: HTMLCanvasElement, hooks: EngineHooks, startMap = 'overworld') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.buf = document.createElement('canvas');
    this.b = this.buf.getContext('2d')!;
    this.hooks = hooks;
    this.map = this.maps[startMap] ?? this.maps.overworld;
    this.placePlayer(this.map.spawn.x, this.map.spawn.y, this.map.spawn.dir);
    this.buildSprites();
    this.resize();
  }

  private buildSprites() {
    const s = this.sprites;
    s.tree = makeTree(0); s.tree2 = makeTree(1); s.bush = makeBush(); s.lamp = makeLamp(); s.sign = makeSign();
    s.fountain = [0, 1, 2].map(makeFountain); s.rocket = makeRocketStatue(); s.tower = makeLaunchTower();
    s.flagB = [0, 1].map((f) => makeFlag(f, '#2c58b8')); s.flagR = [0, 1].map((f) => makeFlag(f, '#d84848'));
    s.desk = makeDesk(); s.plant = makePlant(); s.chair = makeChair(); s.kiosk = [0, 1].map(makeKiosk); s.sc = [0, 1].map(makeSpacecraftStand);
    for (let i = 0; i < 16; i++) s[`shelf${i}`] = makeShelf(i);
  }
  private consoleCache = new Map<string, HTMLCanvasElement[]>();
  private consoleSprite(color = '#2ce06a') {
    if (!this.consoleCache.has(color)) this.consoleCache.set(color, [0, 1, 2].map((f) => makeConsole(f, color)));
    return this.consoleCache.get(color)!;
  }
  private screenCache = new Map<string, HTMLCanvasElement[]>();
  private screenSprite(w: number, kind: 'earth' | 'chart' | 'orbit') {
    const k = `${w}${kind}`;
    if (!this.screenCache.has(k)) this.screenCache.set(k, Array.from({ length: 8 }, (_, f) => makeBigScreen(f, w, kind)));
    return this.screenCache.get(k)!;
  }
  private rackCache = new Map<number, HTMLCanvasElement[]>();
  private rackSprite(seed: number) {
    if (!this.rackCache.has(seed)) this.rackCache.set(seed, [0, 1, 2, 3].map((f) => makeRack(f, seed)));
    return this.rackCache.get(seed)!;
  }

  private ground(m: GameMap) {
    let c = this.groundCache.get(m.id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = m.w * TS; c.height = m.h * TS;
    const g = c.getContext('2d')!;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) paintGround(g, m.ground[y * m.w + x], x, y, x * TS, y * TS);
    for (const b of m.buildings) this.paintBuilding(g, b);
    this.groundCache.set(m.id, c);
    return c;
  }

  private paintBuilding(g: CanvasRenderingContext2D, b: GameMap['buildings'][number]) {
    const X = b.x * TS, Y = b.y * TS, W = b.w * TS, H = b.h * TS;
    const roofH = Math.floor(H * 0.48);
    const px = (c: string, x: number, y: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    px('rgba(0,0,0,0.25)', X + 3, Y + H - 2, W, 5);
    px(PAL.outline, X - 1, Y - 1, W + 2, H + 2);
    // wall
    px(b.wall, X, Y + roofH, W, H - roofH);
    px('rgba(0,0,0,0.08)', X, Y + H - 5, W, 5);
    for (let wx = X + 6; wx < X + W - 12; wx += 22) {
      const winY = Y + roofH + 5;
      px(PAL.outline, wx - 1, winY - 1, 14, 12); px('#8ac8f8', wx, winY, 12, 10); px('#c8e8ff', wx + 1, winY + 1, 4, 3); px(PAL.outline, wx + 5, winY, 1, 10);
    }
    // roof
    px(b.roofDark, X, Y, W, roofH);
    for (let ry = 0; ry < roofH - 3; ry += 4) px(b.roof, X, Y + ry, W, 3);
    px('rgba(255,255,255,0.18)', X, Y, W, 2);
    px(b.roofDark, X, Y + roofH - 3, W, 3);
    px(PAL.outline, X, Y + roofH, W, 1);
    // sign board
    g.font = '8px "Press Start 2P", monospace';
    const tw = Math.ceil(g.measureText(b.label).width);
    const sx = Math.round(X + W / 2 - tw / 2 - 3), sy = Y + roofH - 13;
    px(PAL.outline, sx - 1, sy - 1, tw + 8, 12); px('#203050', sx, sy, tw + 6, 10);
    g.fillStyle = '#f8e8a0'; g.textBaseline = 'top'; g.fillText(b.label, sx + 3, sy + 1);
    // door
    const [dx, dy] = b.door;
    const DX = dx * TS, DY = dy * TS;
    px(PAL.outline, DX + 1, DY - 3, 14, 19); px('#6a4628', DX + 2, DY - 2, 12, 18); px('#8a6038', DX + 3, DY - 1, 10, 17);
    px('#4a3018', DX + 7, DY - 1, 2, 17); px('#f8d870', DX + 10, DY + 7, 2, 2);
    px('#d8d0c0', DX + 1, DY + 14, 14, 2);
  }

  resize() {
    const dpr = 1;
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr);
    const target = w < 700 ? 13 : 24; // tiles across
    this.scale = Math.max(2, Math.floor(Math.min(w / (target * TS), h / (12 * TS))));
    this.buf.width = Math.ceil(this.canvas.width / this.scale); this.buf.height = Math.ceil(this.canvas.height / this.scale);
    this.ctx.imageSmoothingEnabled = false; this.b.imageSmoothingEnabled = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.lastT = performance.now();
    const loop = (t: number) => { this.raf = requestAnimationFrame(loop); const dt = Math.max(0, Math.min(0.05, (t - this.lastT) / 1000)); this.lastT = t; this.update(dt); this.render(); };
    this.raf = requestAnimationFrame(loop);
    this.showBanner(this.map.name);
    this.hooks.onMapChange(this.map.id, this.map.name);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onBlur = () => { this.held = []; this.run = false; };
  private onKeyDown = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.key === 'Shift') this.run = true;
    if (this.hooks.blocked()) return;
    const d = KEYMAP[e.key];
    if (d !== undefined) { e.preventDefault(); if (!this.held.includes(d)) this.held.push(d); }
    else if (INTERACT.has(e.key) && !e.repeat) { e.preventDefault(); this.interact(); }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') this.run = false;
    const d = KEYMAP[e.key];
    if (d !== undefined) this.held = this.held.filter((x) => x !== d);
  };
  setVirtual(d: number | null) { this.virtual = d; }
  releaseAll() { this.held = []; this.virtual = null; }

  private placePlayer(x: number, y: number, dir: number) {
    this.tx = x; this.ty = y; this.fx = x; this.fy = y; this.px = x; this.py = y; this.prog = 1; this.dir = dir;
  }

  private walkable(x: number, y: number) {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
    if (m.solid[y * m.w + x]) return false;
    for (const [, s] of this.npcState) if (Math.round(s.x) === x && Math.round(s.y) === y) return false;
    return true;
  }

  facingTile(): [number, number] { const [dx, dy] = DIRS[this.dir]; return [this.tx + dx, this.ty + dy]; }

  interact() {
    if (this.hooks.blocked() || this.prog < 1) return;
    const [x, y] = this.facingTile();
    const npc = this.map.npcs.find((n) => { const s = this.npcState.get(n.id); return s ? Math.round(s.x) === x && Math.round(s.y) === y : n.x === x && n.y === y; });
    if (npc) {
      const s = this.npcState.get(npc.id);
      if (s) s.dir = (this.dir + 2) % 4 === 0 ? 3 : this.dir === 0 ? 3 : this.dir === 3 ? 0 : this.dir === 1 ? 2 : 1;
      this.hooks.onInteract(null, npc);
      return;
    }
    const it = this.map.interact.get(tileKey(x, y));
    if (it) { this.hooks.onInteract(it, null); return; }
    const door = this.map.warps.get(tileKey(x, y));
    const lock = door && door.map !== 'overworld' ? this.hooks.doorLock?.(door.map) : null;
    if (lock) this.hooks.onLocked?.(lock);
  }

  /** what the player is facing right now (for the "!" prompt) */
  private facingThing(): string | null {
    const [x, y] = this.facingTile();
    const npc = this.map.npcs.find((n) => { const s = this.npcState.get(n.id); return s ? Math.round(s.x) === x && Math.round(s.y) === y : false; });
    if (npc) return npc.name;
    const lbl = this.map.interact.get(tileKey(x, y))?.label;
    if (lbl) return lbl;
    const door = this.map.warps.get(tileKey(x, y));
    if (door && door.map !== 'overworld' && this.hooks.doorLock?.(door.map)) return `${this.map.buildings.find((b) => b.interior === door.map)?.name ?? 'Door'} (locked)`;
    return null;
  }

  private warpTo(w: { map: string; x: number; y: number; dir: number }) {
    this.pendingWarp = w; this.fadeDir = 1;
  }

  private showBanner(text: string) { this.banner = { text, t: 2.2 }; }

  private update(dt: number) {
    this.time += dt;
    if (this.banner.t > 0) this.banner.t -= dt;
    // fade transitions
    if (this.fadeDir !== 0) {
      this.fade += this.fadeDir * dt * 4;
      if (this.fade >= 1 && this.fadeDir === 1) {
        this.fade = 1;
        const w = this.pendingWarp!;
        this.map = this.maps[w.map];
        this.npcState.clear();
        this.placePlayer(w.x, w.y, w.dir);
        this.fadeDir = -1;
        this.showBanner(this.map.name);
        this.hooks.onMapChange(this.map.id, this.map.name);
      } else if (this.fade <= 0 && this.fadeDir === -1) { this.fade = 0; this.fadeDir = 0; this.pendingWarp = null; }
    }
    // NPCs
    for (const n of this.map.npcs) {
      let s = this.npcState.get(n.id);
      if (!s) {
        const [hx, hy] = n.aside && this.hooks.npcAside?.(n.id) ? n.aside : [n.x, n.y];
        s = { x: hx, y: hy, dir: n.dir, timer: 2 + Math.random() * 3, fx: hx, fy: hy, prog: 1 };
        this.npcState.set(n.id, s);
      }
      if (s.prog < 1) {
        s.prog = Math.min(1, s.prog + dt * 2.5);
        const [dx, dy] = DIRS[s.dir];
        s.x = s.fx + dx * s.prog; s.y = s.fy + dy * s.prog;
        if (s.prog >= 1) { s.x = Math.round(s.x); s.y = Math.round(s.y); if (n.wander) this.map.solid[s.y * this.map.w + s.x] = 1; }
        continue;
      }
      if (n.aside) {
        const [wx, wy] = this.hooks.npcAside?.(n.id) ? n.aside : [n.x, n.y];
        if (s.x !== wx || s.y !== wy) {
          const dx = Math.sign(wx - s.x), dy = dx ? 0 : Math.sign(wy - s.y);
          const nx = s.x + dx, ny = s.y + dy;
          const playerThere = (nx === this.tx && ny === this.ty) || (nx === Math.round(this.px) && ny === Math.round(this.py));
          if (!playerThere) { s.dir = dx > 0 ? 2 : dx < 0 ? 1 : dy > 0 ? 0 : 3; s.fx = s.x; s.fy = s.y; s.prog = 0; }
        } else if (s.timer > 0) { s.timer -= dt; if (s.timer <= 0) s.dir = n.dir; }
        continue;
      }
      if (!n.wander) continue;
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer = 1.5 + Math.random() * 3;
        const d = Math.floor(Math.random() * 4);
        s.dir = d;
        const [dx, dy] = DIRS[d];
        const nx = s.x + dx, ny = s.y + dy;
        const home = Math.abs(nx - n.x) <= 2 && Math.abs(ny - n.y) <= 2;
        const idx = ny * this.map.w + nx;
        if (home && nx >= 0 && ny >= 0 && nx < this.map.w && ny < this.map.h && !this.map.solid[idx] && !(nx === this.tx && ny === this.ty) && !(nx === Math.round(this.px) && ny === Math.round(this.py))) {
          this.map.solid[s.y * this.map.w + s.x] = 0;
          this.map.solid[idx] = 1;
          s.fx = s.x; s.fy = s.y; s.prog = 0;
        }
      }
    }
    // player movement
    const blocked = this.hooks.blocked() || this.fadeDir !== 0;
    const want = blocked ? undefined : this.virtual ?? this.held[this.held.length - 1];
    if (this.prog < 1) {
      const speed = this.run ? 8 : 4.6;
      this.prog = Math.min(1, this.prog + dt * speed);
      const [dx, dy] = DIRS[this.dir];
      this.px = this.fx + dx * this.prog; this.py = this.fy + dy * this.prog;
      this.stepFrame += dt * (this.run ? 12 : 8);
      if (this.prog >= 1) {
        this.px = this.tx; this.py = this.ty;
        const w = this.map.warps.get(tileKey(this.tx, this.ty));
        if (w) { this.warpTo(w); return; }
      }
    }
    if (this.prog >= 1 && want !== undefined) {
      if (this.dir !== want && this.turnTimer <= 0 && this.held.length <= 1 && this.virtual === null) { this.dir = want; this.turnTimer = 0.09; }
      else {
        this.dir = want;
        const [dx, dy] = DIRS[want];
        const nx = this.tx + dx, ny = this.ty + dy;
        const door = this.map.warps.get(tileKey(nx, ny));
        const lock = door && door.map !== 'overworld' ? this.hooks.doorLock?.(door.map) : null;
        if (lock) { this.held = []; this.virtual = null; this.hooks.onLocked?.(lock); }
        else if (this.walkable(nx, ny)) { this.fx = this.tx; this.fy = this.ty; this.tx = nx; this.ty = ny; this.prog = 0; }
      }
    }
    if (this.turnTimer > 0) this.turnTimer -= dt;
    if (this.prog >= 1 && want === undefined) this.stepFrame = 0;
    // presence
    const now = performance.now();
    const sig = `${this.map.id}|${this.px.toFixed(2)}|${this.py.toFixed(2)}|${this.dir}|${this.prog < 1}`;
    if (sig !== this.lastSent && now - this.lastPresence > 66) {
      this.lastPresence = now; this.lastSent = sig;
      this.hooks.onPresence({ map: this.map.id, x: this.px, y: this.py, dir: this.dir as 0 | 1 | 2 | 3, moving: this.prog < 1, t: Date.now() });
    }
    // remote interpolation
    for (const r of this.hooks.remotes()) {
      let s = this.remoteState.get(r.id);
      if (!s) { s = { x: r.x, y: r.y, dir: r.dir, moving: r.moving, anim: 0 }; this.remoteState.set(r.id, s); }
      const k = Math.min(1, dt * 12);
      if (Math.abs(r.x - s.x) > 3 || Math.abs(r.y - s.y) > 3) { s.x = r.x; s.y = r.y; }
      s.x += (r.x - s.x) * k; s.y += (r.y - s.y) * k; s.dir = r.dir;
      s.moving = r.moving || Math.abs(r.x - s.x) + Math.abs(r.y - s.y) > 0.02;
      s.anim = s.moving ? s.anim + dt * 8 : 0;
    }
  }

  private render() {
    const b = this.b, m = this.map;
    const vw = this.buf.width, vh = this.buf.height;
    b.fillStyle = m.bg; b.fillRect(0, 0, vw, vh);
    const mapW = m.w * TS, mapH = m.h * TS;
    let camX = this.px * TS + TS / 2 - vw / 2, camY = this.py * TS + TS / 2 - vh / 2;
    camX = mapW <= vw ? (mapW - vw) / 2 : Math.max(0, Math.min(mapW - vw, camX));
    camY = mapH <= vh ? (mapH - vh) / 2 : Math.max(0, Math.min(mapH - vh, camY));
    camX = Math.round(camX); camY = Math.round(camY);
    b.drawImage(this.ground(m), -camX, -camY);
    // locked doors: red stand-by lamp + padlock
    for (const bd of m.buildings) {
      if (!this.hooks.doorLock?.(bd.interior)) continue;
      const X = Math.round(bd.door[0] * TS - camX), Y = Math.round(bd.door[1] * TS - camY);
      const on = Math.floor(this.time * 2) % 2 === 0;
      b.fillStyle = PAL.outline; b.fillRect(X + 4, Y + 3, 8, 8);
      b.fillStyle = '#f8d848'; b.fillRect(X + 5, Y + 6, 6, 5);
      b.fillStyle = PAL.outline; b.fillRect(X + 7, Y + 8, 2, 2);
      b.fillStyle = '#f8d848'; b.fillRect(X + 6, Y + 2, 1, 4); b.fillRect(X + 9, Y + 2, 1, 4); b.fillRect(X + 6, Y + 1, 4, 1);
      b.fillStyle = on ? '#f84848' : '#702020'; b.fillRect(X + 6, Y - 6, 4, 3);
    }
    // animated water
    const frame = Math.floor(this.time * 3);
    // y-sorted drawables
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    const sx = (x: number) => Math.round(x * TS - camX), sy = (y: number) => Math.round(y * TS - camY);
    const inView = (x: number, y: number, pad = 3) => x * TS > camX - pad * TS && x * TS < camX + vw + pad * TS && y * TS > camY - pad * TS && y * TS < camY + vh + 6 * TS;
    for (const p of m.props) {
      if (!inView(p.x, p.y)) continue;
      list.push({ y: p.y + (p.kind === 'screen' ? -10 : 0), draw: () => this.drawProp(p, sx(p.x), sy(p.y), frame) });
    }
    for (const n of m.npcs) {
      const s = this.npcState.get(n.id) ?? { x: n.x, y: n.y, dir: n.dir, prog: 1 };
      const pal = NPC_PALS[n.pal] ?? AVATARS[0];
      const fr = s.prog < 1 ? 1 + (Math.floor(this.time * 8) % 2) : 0;
      list.push({ y: s.y + 0.01, draw: () => drawCharacter(b, sx(s.x), sy(s.y) - 4, s.dir, fr, pal) });
    }
    const me = this.hooks.me();
    for (const r of this.hooks.remotes()) {
      if (r.map !== m.id) continue;
      const s = this.remoteState.get(r.id) ?? { x: r.x, y: r.y, dir: r.dir, moving: false, anim: 0 };
      const fr = s.moving ? 1 + (Math.floor(s.anim) % 2) : 0;
      list.push({ y: s.y + 0.02, draw: () => { drawCharacter(b, sx(s.x), sy(s.y) - 4, s.dir, fr, AVATARS[r.avatar % AVATARS.length], r.color); this.nameTag(sx(s.x) + 8, sy(s.y) - 9, r.name, r.color, r.badge); } });
    }
    const myFrame = this.prog < 1 ? 1 + (Math.floor(this.stepFrame) % 2) : 0;
    list.push({ y: this.py + 0.03, draw: () => { drawCharacter(b, sx(this.px), sy(this.py) - 4, this.dir, myFrame, AVATARS[me.avatar % AVATARS.length], me.color); this.nameTag(sx(this.px) + 8, sy(this.py) - 9, me.name, me.color, me.badge); } });
    list.sort((a, c) => a.y - c.y);
    for (const d of list) d.draw();
    // interaction prompt
    const thing = this.prog >= 1 && !this.hooks.blocked() ? this.facingThing() : null;
    if (thing) {
      const bx = sx(this.px) + 8, by = sy(this.py) - 22 - Math.round(Math.sin(this.time * 6));
      b.fillStyle = PAL.outline; b.fillRect(bx - 4, by - 9, 9, 10); b.fillStyle = '#ffffff'; b.fillRect(bx - 3, by - 8, 7, 8);
      b.fillStyle = '#d83030'; b.fillRect(bx, by - 7, 1, 4); b.fillRect(bx, by - 2, 1, 1);
      this.label(thing, vw / 2, vh - 14);
    }
    // banner
    if (this.banner.t > 0) {
      const a = Math.min(1, this.banner.t * 2);
      b.globalAlpha = a;
      b.font = '8px "Press Start 2P", monospace';
      const tw = b.measureText(this.banner.text).width;
      b.fillStyle = PAL.outline; b.fillRect(4, 4, tw + 14, 16); b.fillStyle = '#f8f0d8'; b.fillRect(5, 5, tw + 12, 14);
      b.fillStyle = '#2a2a3a'; b.textBaseline = 'top'; b.fillText(this.banner.text, 11, 9);
      b.globalAlpha = 1;
    }
    if (this.fade > 0) { b.fillStyle = `rgba(8,10,20,${this.fade})`; b.fillRect(0, 0, vw, vh); }
    this.ctx.drawImage(this.buf, 0, 0, this.buf.width * this.scale, this.buf.height * this.scale);
    this.drawTags();
  }

  private label(text: string, cx: number, y: number) {
    const b = this.b;
    b.font = '8px "Press Start 2P", monospace';
    const t = `E: ${text}`;
    const w = Math.ceil(b.measureText(t).width);
    const x = Math.round(cx - w / 2);
    b.fillStyle = 'rgba(16,20,36,0.85)'; b.fillRect(x - 5, y - 3, w + 10, 13);
    b.fillStyle = '#f8e8a0'; b.textBaseline = 'top'; b.fillText(t, x, y);
  }

  private tags: { cx: number; y: number; text: string; color: string }[] = [];
  /** Name tags are queued in buffer coordinates and drawn on the full-resolution canvas
   *  at an integer multiple of the pixel font size, so they stay crisp at any zoom. */
  private nameTag(cx: number, y: number, name: string, color: string, badge: string) {
    this.tags.push({ cx, y, text: `${name}${badge ? ' ' + badge : ''}`, color });
  }
  private drawTags() {
    if (this.fade > 0.3) { this.tags = []; return; }
    const c = this.ctx, s = this.scale;
    const px = 8 * Math.max(1, s - 1);
    c.font = `${px}px "Press Start 2P", monospace`;
    c.textBaseline = 'top';
    const placed: { x: number; y: number; w: number }[] = [];
    for (const t of [...this.tags].sort((a, b) => b.y - a.y)) {
      const w = Math.ceil(c.measureText(t.text).width);
      const x = Math.round(t.cx * s - w / 2);
      let y = Math.round(t.y * s - px - 6);
      // keep neighbouring tags readable: stack a tag above any it would overlap
      for (let guard = 0; guard < 4 && placed.some((p) => x < p.x + p.w + 12 && p.x < x + w + 12 && Math.abs(p.y - y) < px + 10); guard++) y -= px + 12;
      placed.push({ x, y, w });
      c.fillStyle = 'rgba(16,20,36,0.8)'; c.fillRect(x - 5, y - 4, w + 10, px + 8);
      c.fillStyle = t.color; c.fillRect(x - 5, y + px + 3, w + 10, 2);
      c.fillStyle = '#ffffff'; c.fillText(t.text, x, y);
    }
    this.tags = [];
  }

  private drawProp(p: Prop, x: number, y: number, frame: number) {
    const b = this.b, s = this.sprites;
    const bottom = (img: HTMLCanvasElement, w = 1) => b.drawImage(img, x - ((img.width - w * TS) >> 1), y + TS - img.height);
    switch (p.kind) {
      case 'tree': bottom(s.tree as HTMLCanvasElement); break;
      case 'tree2': bottom(s.tree2 as HTMLCanvasElement); break;
      case 'bush': bottom(s.bush as HTMLCanvasElement); break;
      case 'lamp': bottom(s.lamp as HTMLCanvasElement); break;
      case 'sign': bottom(s.sign as HTMLCanvasElement); break;
      case 'fountain': b.drawImage((s.fountain as HTMLCanvasElement[])[Math.floor(this.time * 4) % 3], x, y - 2 * TS); break;
      case 'rocket': b.drawImage(s.rocket as HTMLCanvasElement, x, y + TS - (s.rocket as HTMLCanvasElement).height); break;
      case 'tower': b.drawImage(s.tower as HTMLCanvasElement, x, y + TS - (s.tower as HTMLCanvasElement).height); break;
      case 'flag': bottom(((p.color === '#d84848' ? s.flagR : s.flagB) as HTMLCanvasElement[])[Math.floor(this.time * 2) % 2]); break;
      case 'console': bottom(this.consoleSprite(p.color)[Math.floor(this.time * 2 + p.x) % 3]); break;
      case 'screen': b.drawImage(this.screenSprite(p.w ?? 4, p.screen ?? 'earth')[frame % 8], x, y - TS + 2); break;
      case 'desk': b.drawImage(s.desk as HTMLCanvasElement, x, y); break;
      case 'shelf': bottom(s[`shelf${(p.variant ?? 0) % 16}`] as HTMLCanvasElement); break;
      case 'rack': bottom(this.rackSprite(p.variant ?? 0)[Math.floor(this.time * 3) % 4]); break;
      case 'plant': bottom(s.plant as HTMLCanvasElement); break;
      case 'chair': b.drawImage(s.chair as HTMLCanvasElement, x, y); break;
      case 'kiosk': bottom((s.kiosk as HTMLCanvasElement[])[Math.floor(this.time * 2) % 2]); break;
      case 'sc': b.drawImage((s.sc as HTMLCanvasElement[])[Math.floor(this.time * 2) % 2], x, y - 2 * TS + 8); break;
    }
  }

  get mapId() { return this.map.id; }
}
