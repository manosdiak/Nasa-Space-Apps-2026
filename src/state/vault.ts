// Archives — local persistence of mission runs + share codes.
import type { MissionRunSave, MissionReport } from '../../shared/types';

const KEY = 'smdg-vault-v1';
const MAX = 40;

function slimReport(r?: MissionReport): MissionReport | undefined {
  if (!r) return r;
  const tel = r.sim.telemetry;
  const step = Math.max(1, Math.ceil(tel.length / 160));
  return { ...r, sim: { ...r.sim, telemetry: tel.filter((_, i) => i % step === 0 || i === tel.length - 1), events: r.sim.events.slice(0, 120) } };
}

export const vault = {
  list(): MissionRunSave[] {
    try { return (JSON.parse(localStorage.getItem(KEY) || '[]') as MissionRunSave[]).sort((a, b) => b.savedAt - a.savedAt); } catch { return []; }
  },
  save(s: MissionRunSave): MissionRunSave[] {
    const all = this.list().filter((x) => x.id !== s.id);
    all.unshift({ ...s, report: slimReport(s.report) });
    const trimmed = all.slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(trimmed)); }
    catch { try { localStorage.setItem(KEY, JSON.stringify(trimmed.slice(0, 12))); } catch { /* storage full or unavailable */ } }
    return trimmed;
  },
  remove(id: string): MissionRunSave[] {
    const all = this.list().filter((x) => x.id !== id);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
    return all;
  },
  get(id: string) { return this.list().find((x) => x.id === id); },
};

// ── Share codes: deflate + base64url of the design (no report) ──────────────
function b64url(bytes: Uint8Array) {
  let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeShare(save: MissionRunSave): Promise<string> {
  const payload = JSON.stringify({ n: save.name, d: save.design, m: save.modifiers, e: save.designEvents });
  const data = new TextEncoder().encode(payload);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer());
    return 'M1.' + b64url(buf);
  }
  return 'M0.' + b64url(data);
}

export async function decodeShare(code: string): Promise<Pick<MissionRunSave, 'name' | 'design' | 'modifiers' | 'designEvents'>> {
  const c = code.trim();
  const [ver, body] = [c.slice(0, 3), c.slice(3)];
  let bytes = unb64url(body);
  if (ver === 'M1.') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  } else if (ver !== 'M0.') throw new Error('Not a mission share code');
  const o = JSON.parse(new TextDecoder().decode(bytes));
  if (!o.d?.objectiveId || !Array.isArray(o.d?.components)) throw new Error('Share code has no valid design');
  return { name: o.n ?? 'Shared design', design: o.d, modifiers: o.m ?? { budgetCapMult: 1, deadlineShiftMonths: 0, costOverrun: {}, extraLeadMonths: {}, launchDelayMonths: 0 }, designEvents: o.e ?? [] };
}
