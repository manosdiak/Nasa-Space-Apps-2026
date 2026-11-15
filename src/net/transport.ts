// Network transports. All three speak the same sequenced-action protocol:
//  • SoloTransport   — in-process RoomCore (offline single player)
//  • LocalTransport  — BroadcastChannel between browser tabs; one tab is elected host
//                      (zero-server "hot-seat" co-op, also the fallback when no server)
//  • OnlineTransport — WebSocket to the Node server (true online, up to 4 players)
import { RoomCore, type Action, type RoomState, type SequencedAction } from '../../shared/room';
import { normalizeRoom, type ClientMsg, type Presence, type ServerMsg } from '../../shared/protocol';
import type { LeaderboardEntry } from '../../shared/types';
import { dbBoardList, dbBoardSubmit } from './claudeHost';

export type TransportKind = 'solo' | 'local' | 'online';
export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface TransportHandlers {
  welcome: (playerId: string, state: RoomState, roomId: string) => void;
  action: (sa: SequencedAction) => void;
  presence: (p: Presence) => void;
  gone: (id: string) => void;
  error: (message: string) => void;
  status: (s: ConnStatus, detail?: string) => void;
}

export interface JoinOpts { room: string; name: string; avatar: number; clientId: string }

export abstract class Transport {
  abstract kind: TransportKind;
  protected h: TransportHandlers;
  constructor(h: TransportHandlers) { this.h = h; }
  abstract connect(o: JoinOpts): void;
  abstract sendAction(a: Action): void;
  abstract sendPresence(p: Presence): void;
  abstract close(): void;
  isHost = false;

  /** Keep the transport's copy of the latest state (used for host hand-over). */
  setLatestState(_s: RoomState): void { /* optional */ }
  /** Ask the host for a full snapshot after a missed message. */
  resync(): void { /* optional */ }
  /** Where scores go: the server API (online), the Artifact's shared db (hosted build), or this browser. */
  boardLabel = 'Local leaderboard (this browser).';

  // Leaderboard: online uses the server API; hosted build uses the shared db; otherwise localStorage
  async submitScore(e: LeaderboardEntry): Promise<void> { localBoard.add(e); await dbBoardSubmit(e); }
  async fetchBoard(q: { objectiveId?: string; seed?: string; difficulty?: string }): Promise<LeaderboardEntry[]> {
    const shared = await dbBoardList(q);
    if (shared) { this.boardLabel = 'Shared leaderboard — everyone who opens this page.'; return shared; }
    return localBoard.list(q);
  }
}

const LB_KEY = 'smdg-leaderboard-v1';
export const localBoard = {
  read(): LeaderboardEntry[] { try { return JSON.parse(localStorage.getItem(LB_KEY) || '[]'); } catch { return []; } },
  add(e: LeaderboardEntry) { try { const all = this.read(); all.push(e); localStorage.setItem(LB_KEY, JSON.stringify(all.slice(-300))); } catch { /* storage unavailable */ } },
  list(q: { objectiveId?: string; seed?: string; difficulty?: string }) {
    return this.read().filter((e) => (!q.objectiveId || e.objectiveId === q.objectiveId) && (!q.seed || e.seed === q.seed) && (!q.difficulty || e.difficulty === q.difficulty))
      .sort((a, b) => b.score - a.score).slice(0, 50);
  },
};

// ── Solo ─────────────────────────────────────────────────────────────────────
export class SoloTransport extends Transport {
  kind: TransportKind = 'solo';
  private core: RoomCore | null = null;
  private me = '';
  connect(o: JoinOpts) {
    this.isHost = true;
    this.me = o.clientId;
    this.core = new RoomCore('SOLO');
    const r = this.core.handle(o.clientId, { t: 'join', id: o.clientId, name: o.name, avatar: o.avatar });
    if (r.error) return this.h.error(r.error);
    this.h.status('connected');
    queueMicrotask(() => this.h.welcome(o.clientId, this.core!.state, 'SOLO'));
  }
  sendAction(a: Action) {
    if (!this.core) return;
    const r = this.core.handle(this.me, a);
    if (r.error) this.h.error(r.error); else queueMicrotask(() => this.h.action(r.sa!));
  }
  sendPresence() { /* nobody to tell */ }
  close() { this.core = null; }
}

// ── Local (BroadcastChannel, host election) ─────────────────────────────────
type BcMsg =
  | { k: 'probe'; from: string }
  | { k: 'host'; from: string }
  | { k: 'hello'; from: string; name: string; avatar: number }
  | { k: 'welcome'; to: string; state: RoomState }
  | { k: 'action'; from: string; action: Action }
  | { k: 'seq'; sa: SequencedAction }
  | { k: 'err'; to: string; message: string }
  | { k: 'presence'; p: Presence }
  | { k: 'bye'; from: string }
  | { k: 'beat'; from: string; state?: RoomState }
  | { k: 'host-leaving'; from: string; state: RoomState };

export class LocalTransport extends Transport {
  kind: TransportKind = 'local';
  private ch: BroadcastChannel | null = null;
  private core: RoomCore | null = null;
  private me = '';
  private hostId = '';
  private lastState: RoomState | null = null;
  private lastBeat = 0;
  private timers: number[] = [];
  private joined = false;
  private opts!: JoinOpts;
  private onUnload = () => this.close();

  connect(o: JoinOpts) {
    this.opts = o; this.me = o.clientId;
    if (typeof BroadcastChannel === 'undefined') { this.h.error('This browser has no BroadcastChannel; use Solo or Online.'); return; }
    this.ch = new BroadcastChannel(`smdg-${normalizeRoom(o.room)}`);
    this.ch.onmessage = (ev) => this.onMsg(ev.data as BcMsg);
    this.h.status('connecting', 'Looking for a host tab…');
    this.post({ k: 'probe', from: this.me });
    this.timers.push(window.setTimeout(() => { if (!this.hostId) this.becomeHost(null); else this.sayHello(); }, 350));
    this.timers.push(window.setInterval(() => this.heartbeat(), 2000));
    window.addEventListener('pagehide', this.onUnload);
  }
  private post(m: BcMsg) { this.ch?.postMessage(m); }
  private sayHello() { this.post({ k: 'hello', from: this.me, name: this.opts.name, avatar: this.opts.avatar }); }

  private becomeHost(state: RoomState | null) {
    this.isHost = true; this.hostId = this.me;
    this.core = new RoomCore(normalizeRoom(this.opts.room), state ?? undefined);
    this.post({ k: 'host', from: this.me });
    if (!this.joined) {
      const r = this.core.handle(this.me, { t: 'join', id: this.me, name: this.opts.name, avatar: this.opts.avatar });
      if (r.error) return this.h.error(r.error);
      this.joined = true;
      this.h.status('connected', 'Hosting this room in this tab');
      this.h.welcome(this.me, this.core.state, normalizeRoom(this.opts.room));
      this.post({ k: 'seq', sa: r.sa! });
    } else {
      this.h.status('connected', 'Took over as host');
    }
  }

  private hostHandle(from: string, action: Action) {
    if (!this.core) return;
    const r = this.core.handle(from, action);
    if (r.error) { if (from === this.me) this.h.error(r.error); else this.post({ k: 'err', to: from, message: r.error }); return; }
    this.post({ k: 'seq', sa: r.sa! });
    this.h.action(r.sa!);
    this.lastState = this.core.state;
  }

  private onMsg(m: BcMsg) {
    switch (m.k) {
      case 'probe': if (this.isHost) this.post({ k: 'host', from: this.me }); break;
      case 'host': this.hostId = m.from; this.lastBeat = Date.now(); break;
      case 'hello':
        if (!this.isHost || !this.core) break;
        {
          const r = this.core.handle(m.from, { t: 'join', id: m.from, name: m.name, avatar: m.avatar });
          if (r.error) { this.post({ k: 'err', to: m.from, message: r.error }); break; }
          this.post({ k: 'welcome', to: m.from, state: this.core.state });
          this.post({ k: 'seq', sa: r.sa! });
          this.h.action(r.sa!);
        }
        break;
      case 'welcome':
        if (m.to !== this.me || this.joined) break;
        this.joined = true; this.lastState = m.state;
        this.h.status('connected', 'Joined a host tab');
        this.h.welcome(this.me, m.state, normalizeRoom(this.opts.room));
        break;
      case 'action': if (this.isHost) this.hostHandle(m.from, m.action); break;
      case 'seq':
        if (this.isHost || !this.joined) break;
        this.h.action(m.sa);
        break;
      case 'err': if (m.to === this.me) this.h.error(m.message); break;
      case 'presence': this.h.presence(m.p); break;
      case 'bye':
        if (this.isHost) this.hostHandle(m.from, { t: 'leave', id: m.from });
        this.h.gone(m.from);
        break;
      case 'beat': if (m.from === this.hostId) { this.lastBeat = Date.now(); if (m.state) this.lastState = m.state; } break;
      case 'host-leaving':
        this.h.gone(m.from);
        this.electAfterHostLoss(m.state, m.from);
        break;
    }
  }

  setLatestState(s: RoomState) { this.lastState = s; }


  private electAfterHostLoss(state: RoomState, oldHost: string) {
    const remaining = Object.keys(state.players).filter((id) => id !== oldHost).sort();
    if (remaining[0] === this.me) {
      this.becomeHost(state);
      this.hostHandle(oldHost, { t: 'leave', id: oldHost });
    } else this.hostId = remaining[0] ?? '';
  }

  private heartbeat() {
    if (this.isHost) { this.post({ k: 'beat', from: this.me, state: this.core?.state }); return; }
    if (this.joined && this.lastState && Date.now() - this.lastBeat > 7000) {
      // host vanished without saying goodbye
      this.lastBeat = Date.now();
      this.electAfterHostLoss(this.lastState, this.hostId);
    }
  }

  sendAction(a: Action) { if (this.isHost) this.hostHandle(this.me, a); else this.post({ k: 'action', from: this.me, action: a }); }
  sendPresence(p: Presence) { this.post({ k: 'presence', p }); }
  close() {
    window.removeEventListener('pagehide', this.onUnload);
    if (this.isHost && this.core) this.post({ k: 'host-leaving', from: this.me, state: this.core.state });
    else this.post({ k: 'bye', from: this.me });
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.ch?.close(); this.ch = null;
  }
}

// ── Online (WebSocket) ───────────────────────────────────────────────────────
export function defaultServerUrl(): string {
  const qs = new URLSearchParams(location.search).get('server');
  if (qs) return qs.replace(/^http/, 'ws').replace(/\/?$/, '').replace(/\/ws$/, '') + '/ws';
  if (import.meta.env.MODE === 'single' || location.protocol === 'file:') return '';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class OnlineTransport extends Transport {
  kind: TransportKind = 'online';
  private ws: WebSocket | null = null;
  private url: string;
  private opts!: JoinOpts;
  private closed = false;
  private retry = 0;
  private welcomed = false;
  constructor(h: TransportHandlers, url: string) { super(h); this.url = url; }

  connect(o: JoinOpts) { this.opts = o; this.open(); }
  private open() {
    if (!this.url) { this.h.status('offline'); this.h.error('No multiplayer server is configured for this page. Start `npm run server` or add ?server=wss://your-host.'); return; }
    this.h.status(this.retry ? 'reconnecting' : 'connecting', this.url);
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch (e) { this.h.error(`Cannot open ${this.url}: ${e}`); return; }
    this.ws = ws;
    const failTimer = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 5000);
    ws.onopen = () => {
      clearTimeout(failTimer);
      this.retry = 0;
      this.send({ type: 'hello', room: this.opts.room, name: this.opts.name, avatar: this.opts.avatar, clientId: this.opts.clientId });
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      if (m.type === 'welcome') { this.welcomed = true; this.h.status('connected', `Room ${m.roomId}`); this.h.welcome(m.playerId, m.state, m.roomId); }
      else if (m.type === 'action') this.h.action(m.sa);
      else if (m.type === 'presence') this.h.presence(m.p);
      else if (m.type === 'gone') this.h.gone(m.id);
      else if (m.type === 'error') this.h.error(m.message);
    };
    ws.onclose = () => {
      clearTimeout(failTimer);
      if (this.closed) return;
      if (!this.welcomed && this.retry >= 1) { this.h.status('offline'); this.h.error(`Could not reach the multiplayer server at ${this.url}.`); return; }
      this.retry++;
      this.welcomed = false;
      this.h.status('reconnecting');
      window.setTimeout(() => !this.closed && this.open(), Math.min(8000, 800 * this.retry));
    };
  }
  private send(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  sendAction(a: Action) { this.send({ type: 'action', action: a }); }
  sendPresence(p: Presence) { this.send({ type: 'presence', p }); }
  close() { this.closed = true; this.ws?.close(); }

  private api() { return this.url.replace(/^ws/, 'http').replace(/\/ws$/, ''); }
  async submitScore(e: LeaderboardEntry) {
    localBoard.add(e);
    try { await fetch(`${this.api()}/api/leaderboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) }); } catch { /* keep local copy */ }
  }
  async fetchBoard(q: { objectiveId?: string; seed?: string; difficulty?: string }) {
    try {
      const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
      const r = await fetch(`${this.api()}/api/leaderboard?${qs}`);
      if (r.ok) { this.boardLabel = 'Global leaderboard on the multiplayer server.'; return (await r.json()) as LeaderboardEntry[]; }
    } catch { /* fall back */ }
    return localBoard.list(q);
  }
}
