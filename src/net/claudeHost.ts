// Hosted-build helpers: when the game runs as a published claude.ai Artifact
// (single-file build), it can use the viewer's runtime capabilities:
//   room      → real-time online co-op between viewers (see ClaudeRoomTransport)
//   db        → a shared, persistent leaderboard
//   downloads → saving exported JSON
// Everything degrades gracefully: when a capability is absent the game falls
// back to solo / local tabs / localStorage.
import type { LeaderboardEntry } from '../../shared/types';

export const HOSTED = import.meta.env.MODE === 'single';

type Cap = Record<string, (...a: never[]) => unknown> & object;
const cache = new Map<string, Promise<Cap | null>>();

/** Resolve a runtime capability namespace or null (never throws, never hangs > 10 s). */
export function getCap<T = Cap>(name: string): Promise<T | null> {
  if (!cache.has(name)) {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<Cap | null> } };
    const p: Promise<Cap | null> = !w.claude?.use ? Promise.resolve(null)
      : Promise.race([w.claude.use(name).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 10000))]);
    cache.set(name, p);
  }
  return cache.get(name)! as Promise<T | null>;
}

// ── Shared leaderboard on the artifact's db ──────────────────────────────────
interface DbDoc { set(d: Record<string, unknown>): Promise<void> }
interface DbSnap { docs: { data(): Record<string, unknown> | undefined }[] }
interface DbQuery { orderBy(f: string, d?: string): DbQuery; limit(n: number): DbQuery; where(f: string, op: string, v: unknown): DbQuery; get(): Promise<DbSnap> }
interface DbNs { doc(p: string): DbDoc; collection(p: string): DbQuery }

export async function dbBoardSubmit(e: LeaderboardEntry): Promise<boolean> {
  if (!HOSTED) return false;
  const db = await getCap<DbNs>('db');
  if (!db) return false;
  try { await db.doc(`scores/${e.id.replace(/[^A-Za-z0-9_-]/g, '_')}`).set({ ...e }); return true; } catch { return false; }
}

export async function dbBoardList(q: { objectiveId?: string; seed?: string; difficulty?: string }): Promise<LeaderboardEntry[] | null> {
  if (!HOSTED) return null;
  const db = await getCap<DbNs>('db');
  if (!db) return null;
  try {
    let query = db.collection('scores');
    if (q.objectiveId) query = query.where('objectiveId', '==', q.objectiveId);
    if (q.seed) query = query.where('seed', '==', q.seed);
    if (q.difficulty) query = query.where('difficulty', '==', q.difficulty);
    const snap = await query.orderBy('score', 'desc').limit(50).get();
    return snap.docs.map((d) => d.data() as unknown as LeaderboardEntry).filter((x) => x && typeof x.score === 'number');
  } catch { return null; }
}

// ── Saving files ─────────────────────────────────────────────────────────────
interface DownloadsNs { save(r: { filename: string; data: string | Blob }): Promise<unknown> }

/** Returns how the export was delivered. */
export async function saveJsonFile(filename: string, json: string): Promise<'download' | 'clipboard' | 'failed'> {
  if (HOSTED) {
    const dl = await getCap<DownloadsNs>('downloads');
    if (dl) { try { await dl.save({ filename, data: new Blob([json], { type: 'application/json' }) }); return 'download'; } catch { /* declined or refused */ } }
    try { await navigator.clipboard.writeText(json); return 'clipboard'; } catch { return 'failed'; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'download';
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
