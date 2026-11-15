// ─────────────────────────────────────────────────────────────────────────────
// Multiplayer server: HTTP (static build + leaderboard API) and WebSocket rooms.
// Each room runs the shared RoomCore, which sequences actions through the same
// deterministic reducer the clients use. Presence (walking avatars) is relayed.
//   npm run server        (dev, port 8787; Vite proxies /ws and /api)
//   npm run build && npm start   (production: serves dist/ + ws on one port)
// ─────────────────────────────────────────────────────────────────────────────
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomCore, MAX_PLAYERS } from '../shared/room';
import { normalizeRoom, type ClientMsg, type ServerMsg } from '../shared/protocol';
import type { LeaderboardEntry } from '../shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(__dirname, '../dist');
const DATA_DIR = resolve(__dirname, 'data');
const LB_FILE = join(DATA_DIR, 'leaderboard.json');

// ── Leaderboard persistence ────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true });
let leaderboard: LeaderboardEntry[] = existsSync(LB_FILE) ? JSON.parse(readFileSync(LB_FILE, 'utf8')) : [];
let saveTimer: NodeJS.Timeout | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeFileSync(LB_FILE, JSON.stringify(leaderboard.slice(-2000), null, 1)); }, 500);
}
function validEntry(e: unknown): e is LeaderboardEntry {
  const x = e as LeaderboardEntry;
  return !!x && typeof x.team === 'string' && typeof x.score === 'number' && Number.isFinite(x.score) && x.score >= 0 && x.score < 5000 && typeof x.objectiveId === 'string' && typeof x.seed === 'string';
}

// ── Rooms ────────────────────────────────────────────────────────────────────
interface Client { ws: WebSocket; id: string; room: string; lastPresence: number; }
interface Room { core: RoomCore; clients: Map<string, Client>; emptySince: number | null; }
const rooms = new Map<string, Room>();

function getRoom(code: string): Room {
  let r = rooms.get(code);
  if (!r) { r = { core: new RoomCore(code), clients: new Map(), emptySince: null }; rooms.set(code, r); }
  return r;
}
function send(ws: WebSocket, msg: ServerMsg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room: Room, msg: ServerMsg, except?: string) {
  const data = JSON.stringify(msg);
  for (const c of room.clients.values()) if (c.id !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.clients.size === 0 && r.emptySince && now - r.emptySince > 30 * 60_000) rooms.delete(code);
}, 60_000);

// ── HTTP ─────────────────────────────────────────────────────────────────────
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 64_000) throw new Error('too large'); }
  return data;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0) });
  if (url.pathname === '/api/rooms') return json(res, 200, [...rooms.entries()].filter(([, r]) => r.clients.size > 0).map(([code, r]) => ({ code, players: r.clients.size, team: r.core.state.teamName, objective: r.core.state.design.objectiveId })));
  if (url.pathname === '/api/leaderboard') {
    if (req.method === 'POST') {
      try {
        const e = JSON.parse(await readBody(req));
        if (!validEntry(e)) return json(res, 400, { error: 'invalid entry' });
        const entry: LeaderboardEntry = { ...e, team: e.team.slice(0, 24), players: (e.players ?? []).slice(0, 4).map((p: string) => String(p).slice(0, 16)), at: Date.now() };
        leaderboard.push(entry); persist();
        return json(res, 200, { ok: true });
      } catch { return json(res, 400, { error: 'bad json' }); }
    }
    const obj = url.searchParams.get('objectiveId'), seed = url.searchParams.get('seed'), diff = url.searchParams.get('difficulty');
    const rows = leaderboard.filter((e) => (!obj || e.objectiveId === obj) && (!seed || e.seed === seed) && (!diff || e.difficulty === diff))
      .sort((a, b) => b.score - a.score).slice(0, 50);
    return json(res, 200, rows);
  }
  // Static files (production build)
  if (!existsSync(DIST)) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('Server running. Start the client with `npm run client` (or `npm run build` to serve it from here).'); }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  let client: Client | null = null;
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'ping') return send(ws, { type: 'pong', t: msg.t });
    if (msg.type === 'hello') {
      if (client) return;
      const code = normalizeRoom(msg.room);
      const room = getRoom(code);
      const id = String(msg.clientId || '').slice(0, 24) || Math.random().toString(36).slice(2, 10);
      const existing = room.clients.get(id);
      if (!existing && room.clients.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: `Room ${code} is full (${MAX_PLAYERS} players). Try another room code.` });
      if (existing) { try { existing.ws.close(); } catch { /* ignore */ } }
      client = { ws, id, room: code, lastPresence: 0 };
      room.clients.set(id, client);
      room.emptySince = null;
      const r = room.core.handle(id, { t: 'join', id, name: String(msg.name || 'Cadet').slice(0, 16), avatar: Number(msg.avatar) || 0 });
      if (r.error) { send(ws, { type: 'error', message: r.error }); room.clients.delete(id); client = null; return; }
      send(ws, { type: 'welcome', playerId: id, state: room.core.state, roomId: code });
      broadcast(room, { type: 'action', sa: r.sa! }, id);
      console.log(`[room ${code}] ${msg.name} joined (${room.clients.size}/${MAX_PLAYERS})`);
      return;
    }
    if (!client) return;
    const room = rooms.get(client.room);
    if (!room) return;
    if (msg.type === 'action') {
      if (msg.action?.t === 'join' || msg.action?.t === 'leave') return;
      const r = room.core.handle(client.id, msg.action);
      if (r.error) return send(ws, { type: 'error', message: r.error });
      broadcast(room, { type: 'action', sa: r.sa! });
    } else if (msg.type === 'presence') {
      const now = Date.now();
      if (now - client.lastPresence < 40) return; // ~25 Hz cap
      client.lastPresence = now;
      broadcast(room, { type: 'presence', p: { ...msg.p, id: client.id } }, client.id);
    }
  });
  ws.on('close', () => {
    if (!client) return;
    const room = rooms.get(client.room);
    if (!room || room.clients.get(client.id)?.ws !== ws) return;
    room.clients.delete(client.id);
    const r = room.core.handle(client.id, { t: 'leave', id: client.id });
    if (r.sa) broadcast(room, { type: 'action', sa: r.sa });
    broadcast(room, { type: 'gone', id: client.id });
    if (room.clients.size === 0) room.emptySince = Date.now();
    console.log(`[room ${client.room}] player left (${room.clients.size}/${MAX_PLAYERS})`);
  });
});

server.listen(PORT, () => console.log(`🚀 Mission HQ server on http://localhost:${PORT}  (ws: /ws, api: /api/leaderboard)`));
