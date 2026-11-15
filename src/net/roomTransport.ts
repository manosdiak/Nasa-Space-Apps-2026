// Online co-op for the hosted (claude.ai Artifact) build — no server needed.
// Uses the viewer's `room` capability: every team joins a named room
// ("smdg-<code>"). One peer is elected HOST and runs the shared RoomCore
// (the same deterministic sequencer the Node server runs); the others send
// it actions and apply the host's sequenced broadcast. Avatars travel in
// presence. Messages are chunked to respect the 4 KiB per-message limit.
import { RoomCore, type Action, type RoomState, type SequencedAction } from '../../shared/room';
import { normalizeRoom, type Presence } from '../../shared/protocol';
import { getCap } from './claudeHost';
import { Transport, type JoinOpts } from './transport';

interface Peer { peer: string; isMe: boolean; sameTab: boolean; presence: Readonly<Record<string, unknown>> }
interface PeersChange { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[]; updated: readonly Peer[] }
interface Msg { peer: string; isMe: boolean; sameTab: boolean; data?: unknown }
interface NamedRoom {
  emit(topic: string, data?: unknown): Promise<void>;
  on(topic: string, h: (m: Msg) => void, e?: (err: { code: string; message: string }) => void): () => void;
  presence(p: Record<string, unknown>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(h: (c: PeersChange) => void, e?: (err: { code: string; message: string }) => void): () => void;
  leave(): Promise<void>;
}
interface RoomNs { join(name: string): Promise<NamedRoom> }

type Wire =
  | { k: 'hello'; cid: string; name: string; avatar: number }
  | { k: 'welcome'; to: string; state: RoomState }
  | { k: 'act'; cid: string; action: Action }
  | { k: 'seq'; sa: SequencedAction }
  | { k: 'err'; to: string; message: string }
  | { k: 'resync'; cid: string };

const TOPIC = 'm';
const CHUNK = 2600;

function toB64(s: string) { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i++) x += String.fromCharCode(b[i]); return btoa(x); }
function fromB64(s: string) { const x = atob(s); return new TextDecoder().decode(Uint8Array.from(x, (c) => c.charCodeAt(0))); }

export class ClaudeRoomTransport extends Transport {
  kind = 'online' as const;
  private room: NamedRoom | null = null;
  private core: RoomCore | null = null;
  private opts!: JoinOpts;
  private me = '';
  private hostPeer = '';
  private myPeer = '';
  private latest: RoomState | null = null;
  private joined = false;
  private parts = new Map<string, { n: number; got: string[]; count: number; at: number }>();
  private queue: Promise<void> = Promise.resolve();
  private unsubs: (() => void)[] = [];
  private electTimer = 0;
  private closed = false;
  private peerCid = new Map<string, string>();

  connect(o: JoinOpts) {
    this.opts = o; this.me = o.clientId;
    this.h.status('connecting', 'Joining the claude.ai room…');
    void this.start();
  }

  private async start() {
    const ns = await getCap<RoomNs>('room');
    if (!ns) { this.h.status('offline'); this.h.error('Online play is not available in this view. Use Solo or Local tabs.'); return; }
    try { this.room = await ns.join(`smdg-${normalizeRoom(this.opts.room).toLowerCase()}`); }
    catch (e) { this.h.status('offline'); this.h.error(`Could not join the online room (${(e as { code?: string }).code ?? 'error'}).`); return; }
    const room = this.room;
    this.unsubs.push(room.on(TOPIC, (m) => this.onChunk(m), (e) => this.h.error(`Room connection ended (${e.code}).`)));
    this.unsubs.push(room.onPeers((c) => this.onPeers(c)));
    await room.presence({ cid: this.me, name: this.opts.name, avatar: this.opts.avatar, host: false });
    // Give the room a moment to report who is already here, then join a host or become one.
    this.electTimer = window.setTimeout(() => this.decide(), 1600);
  }

  private hostOf(peers: readonly Peer[]): Peer | null {
    const hosts = peers.filter((p) => p.presence?.host === true && typeof p.presence?.cid === 'string');
    if (!hosts.length) return null;
    return [...hosts].sort((a, b) => (a.peer < b.peer ? -1 : 1))[0];
  }

  private decide() {
    if (!this.room || this.closed) return;
    const mine = this.room.peers().find((p) => p.sameTab);
    if (mine) this.myPeer = mine.peer;
    const host = this.hostOf(this.room.peers().filter((p) => !p.sameTab));
    if (host) { this.hostPeer = host.peer; this.send({ k: 'hello', cid: this.me, name: this.opts.name, avatar: this.opts.avatar }); window.setTimeout(() => { if (!this.joined && !this.closed) this.decide(); }, 4000); }
    else this.becomeHost(this.latest);
  }

  private becomeHost(state: RoomState | null) {
    this.isHost = true; this.hostPeer = this.myPeer;
    this.core = new RoomCore(normalizeRoom(this.opts.room), state ?? undefined);
    void this.room?.presence({ host: true });
    if (!this.joined) {
      const r = this.core.handle(this.me, { t: 'join', id: this.me, name: this.opts.name, avatar: this.opts.avatar });
      if (r.error) { this.h.error(r.error); return; }
      this.joined = true;
      this.latest = this.core.state;
      this.h.status('connected', 'Hosting this online room');
      this.h.welcome(this.me, this.core.state, normalizeRoom(this.opts.room));
    } else this.h.status('connected', 'Took over as host');
  }

  private onPeers(c: PeersChange) {
    for (const p of c.peers) if (typeof p.presence?.cid === 'string') this.peerCid.set(p.peer, p.presence.cid as string);
    for (const p of c.peers) if (p.sameTab) this.myPeer = p.peer;
    // Avatars
    for (const p of [...c.joined, ...c.updated]) {
      if (p.sameTab || typeof p.presence?.cid !== 'string') continue;
      const pos = p.presence.pos as Omit<Presence, 'id'> | undefined;
      if (pos && typeof pos.x === 'number') this.h.presence({ ...pos, id: p.presence.cid as string });
    }
    for (const p of c.left) {
      const cid = this.peerCid.get(p.peer);
      if (!cid) continue;
      this.h.gone(cid);
      if (this.isHost && this.core && cid !== this.me) this.hostHandle(cid, { t: 'leave', id: cid });
    }
    // Host lost → the remaining peer with the smallest label takes over with its copy of the state
    if (this.joined && !this.isHost && c.left.some((p) => p.peer === this.hostPeer)) {
      const oldHostCid = this.peerCid.get(this.hostPeer);
      const others = c.peers.filter((p) => typeof p.presence?.cid === 'string').sort((a, b) => (a.peer < b.peer ? -1 : 1));
      if (others[0]?.sameTab) { this.becomeHost(this.latest); if (oldHostCid) this.hostHandle(oldHostCid, { t: 'leave', id: oldHostCid }); }
      else if (others[0]) this.hostPeer = others[0].peer;
    }
    // Split-brain: two hosts → the larger label steps down and rejoins
    if (this.isHost) {
      const h = this.hostOf(c.peers);
      if (h && !h.sameTab) {
        this.isHost = false; this.core = null; this.hostPeer = h.peer;
        void this.room?.presence({ host: false });
        this.send({ k: 'resync', cid: this.me });
        this.send({ k: 'hello', cid: this.me, name: this.opts.name, avatar: this.opts.avatar });
      }
    } else if (this.joined) {
      const h = this.hostOf(c.peers);
      if (h && h.peer !== this.hostPeer) { this.hostPeer = h.peer; this.send({ k: 'resync', cid: this.me }); }
    }
  }

  private hostHandle(from: string, action: Action) {
    if (!this.core) return;
    const r = this.core.handle(from, action);
    if (r.error) { if (from === this.me) this.h.error(r.error); else this.send({ k: 'err', to: from, message: r.error }); return; }
    this.latest = this.core.state;
    this.h.action(r.sa!);
    this.send({ k: 'seq', sa: r.sa! });
  }

  private onWire(w: Wire) {
    switch (w.k) {
      case 'hello':
        if (!this.isHost || !this.core) return;
        {
          const r = this.core.handle(w.cid, { t: 'join', id: w.cid, name: w.name, avatar: w.avatar });
          if (r.error) { this.send({ k: 'err', to: w.cid, message: r.error }); return; }
          this.latest = this.core.state;
          this.h.action(r.sa!);
          this.send({ k: 'seq', sa: r.sa! });
          this.send({ k: 'welcome', to: w.cid, state: this.core.state });
        }
        return;
      case 'resync': if (this.isHost && this.core) this.send({ k: 'welcome', to: w.cid, state: this.core.state }); return;
      case 'welcome':
        if (w.to !== this.me) return;
        this.latest = w.state;
        if (!this.joined) { this.joined = true; this.h.status('connected', 'Joined online room'); }
        this.h.welcome(this.me, w.state, normalizeRoom(this.opts.room));
        return;
      case 'act': if (this.isHost) this.hostHandle(w.cid, w.action); return;
      case 'seq': if (!this.isHost && this.joined) this.h.action(w.sa); return;
      case 'err': if (w.to === this.me) this.h.error(w.message); return;
    }
  }

  // ── chunked wire ──
  private send(w: Wire) {
    if (!this.room) return;
    const body = toB64(JSON.stringify(w));
    const id = Math.random().toString(36).slice(2, 10);
    const n = Math.max(1, Math.ceil(body.length / CHUNK));
    const room = this.room;
    this.queue = this.queue.then(async () => {
      for (let i = 0; i < n; i++) {
        await room.emit(TOPIC, { id, i, n, d: body.slice(i * CHUNK, (i + 1) * CHUNK) }).catch(() => undefined);
        if (n > 4 && i % 6 === 5) await new Promise((r) => setTimeout(r, 120));
      }
    });
  }
  private onChunk(m: Msg) {
    if (m.sameTab) return;
    const c = m.data as { id?: string; i?: number; n?: number; d?: string };
    if (!c || typeof c.id !== 'string' || typeof c.i !== 'number' || typeof c.n !== 'number' || typeof c.d !== 'string' || c.n > 400) return;
    let e = this.parts.get(c.id);
    if (!e) { e = { n: c.n, got: new Array(c.n), count: 0, at: Date.now() }; this.parts.set(c.id, e); }
    if (e.got[c.i] === undefined) { e.got[c.i] = c.d; e.count++; }
    if (e.count === e.n) {
      this.parts.delete(c.id);
      try { this.onWire(JSON.parse(fromB64(e.got.join(''))) as Wire); } catch { /* malformed — ignore */ }
    }
    if (this.parts.size > 50) { const now = Date.now(); for (const [k, v] of this.parts) if (now - v.at > 30000) this.parts.delete(k); }
  }

  sendAction(a: Action) { if (this.isHost) this.hostHandle(this.me, a); else this.send({ k: 'act', cid: this.me, action: a }); }
  sendPresence(p: Presence) { void this.room?.presence({ pos: { map: p.map, x: +p.x.toFixed(2), y: +p.y.toFixed(2), dir: p.dir, moving: p.moving, t: p.t } }).catch(() => undefined); }
  setLatestState(s: RoomState) { this.latest = s; }
  resync() { if (!this.isHost) this.send({ k: 'resync', cid: this.me }); }
  close() {
    this.closed = true;
    clearTimeout(this.electTimer);
    for (const u of this.unsubs) u();
    void this.room?.leave().catch(() => undefined);
    this.room = null;
  }
}
