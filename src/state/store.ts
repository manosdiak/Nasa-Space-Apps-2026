import { create } from 'zustand';
import { computeResources } from '../../shared/engine/physics';
import { canAct, reduce, roleForChange, type Action, type DesignChange, type RoomState, type SequencedAction } from '../../shared/room';
import type { Presence } from '../../shared/protocol';
import type { MissionReport, MissionRunSave, PendingDecision, ResourceState, RoleId, SimEventRecord, SimResult, TelemetryPoint } from '../../shared/types';
import { LocalTransport, OnlineTransport, SoloTransport, defaultServerUrl, type ConnStatus, type Transport, type TransportKind } from '../net/transport';
import { HOSTED } from '../net/claudeHost';
import { ClaudeRoomTransport } from '../net/roomTransport';
import { vault } from './vault';

export type PanelId = 'mission' | 'mcc' | 'archives' | 'academy' | 'command' | 'help';
export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'warn' | 'crit' | 'event'; at: number }
export interface Dialogue { speaker: string; color?: string; lines: string[]; index: number; then?: { panel: PanelId; tab?: string } }

export interface SimView {
  runId: string;
  day: number;
  totalDays: number;
  cruiseDays: number;
  telemetry: TelemetryPoint[];
  events: SimEventRecord[];
  pending: PendingDecision | null;
  pendingSince: number;
  done: boolean;
  result: SimResult | null;
  speed: number;          // days per second
  playing: boolean;
  mcProgress: number;     // 0..1
  report: MissionReport | null;
  science: number;
}

interface Profile { name: string; avatar: number; clientId: string }

/** clientId is per browser TAB (sessionStorage) so several tabs can be different players. */
function tabId(): string {
  try {
    let id = sessionStorage.getItem('smdg-tab-id');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('smdg-tab-id', id); }
    return id;
  } catch { return 'p' + Math.random().toString(36).slice(2, 10); }
}

function loadProfile(): Profile {
  let saved: Partial<Profile> = {};
  try { saved = JSON.parse(localStorage.getItem('smdg-profile') || '{}') ?? {}; } catch { /* ignore */ }
  return { name: saved.name ?? '', avatar: saved.avatar ?? Math.floor(Math.random() * 6), clientId: tabId() };
}

interface Store {
  profile: Profile;
  setProfile: (p: Partial<Profile>) => void;

  transport: Transport | null;
  mode: TransportKind | null;
  status: ConnStatus;
  statusDetail: string;
  roomId: string;
  playerId: string;
  room: RoomState | null;
  resources: ResourceState | null;
  resourcesKey: string;
  presence: Record<string, Presence>;

  scene: 'title' | 'select' | 'game';
  mapId: string;
  panel: { id: PanelId; tab?: string } | null;
  dialogue: Dialogue | null;
  toasts: Toast[];
  chatOpen: boolean;
  unread: number;
  sim: SimView | null;
  vaultRuns: MissionRunSave[];
  compare: [string | null, string | null];
  ask: { text: string; yes: string; onYes: () => void } | null;
  confirmAction: (text: string, yes: string, onYes: () => void) => void;

  connect: (kind: TransportKind, room: string) => void;
  disconnect: () => void;
  send: (a: Action) => void;
  design: (c: DesignChange) => void;
  openPanel: (id: PanelId, tab?: string) => void;
  closePanel: () => void;
  say: (d: Omit<Dialogue, 'index'>) => void;
  advanceDialogue: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  setMap: (id: string) => void;
  myRoles: () => RoleId[];
  can: (role: RoleId) => boolean;
  canChange: (c: DesignChange) => boolean;
  refreshVault: () => void;
  setCompare: (slot: 0 | 1, id: string | null) => void;
  setSim: (s: Partial<SimView> | null) => void;
  /** Mission Selection screen */
  pickMission: (objectiveId: string) => void;
  openSelect: () => void;
  /** Easy-mode intro slides already seen (per viewer, per mission) */
  guideSeen: Record<string, boolean>;
  markGuideSeen: (objectiveId: string) => void;
  /** solo vs co-op: HQ Command is co-op only */
  isCoop: () => boolean;
  mccUnlocked: () => boolean;
}

function loadGuideSeen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem('smdg-guides') || '{}') ?? {}; } catch { return {}; }
}

let toastId = 1;

export const useStore = create<Store>((set, get) => ({
  profile: loadProfile(),
  setProfile: (p) => {
    const profile = { ...get().profile, ...p };
    try { localStorage.setItem('smdg-profile', JSON.stringify({ name: profile.name, avatar: profile.avatar })); } catch { /* ignore */ }
    set({ profile });
  },

  transport: null, mode: null, status: 'idle', statusDetail: '', roomId: '', playerId: '', room: null, resources: null, resourcesKey: '', presence: {},
  scene: 'title', mapId: 'overworld', panel: null, dialogue: null, toasts: [], chatOpen: false, unread: 0, sim: null,
  vaultRuns: vault.list(), compare: [null, null], ask: null,
  confirmAction: (text, yes, onYes) => set({ ask: { text, yes, onYes } }),

  connect: (kind, roomCode) => {
    get().transport?.close();
    const { profile } = get();
    const handlers = {
      welcome: (playerId: string, state: RoomState, roomId: string) => {
        set({ playerId, roomId, room: state, scene: state.missionSelected ? 'game' : 'select', mapId: 'overworld' });
        recompute();
        if (kind !== 'solo') get().toast(`Joined room ${roomId}. Share the code with up to 3 teammates.`, 'ok');
      },
      action: (sa: SequencedAction) => applyRemote(sa),
      presence: (p: Presence) => { if (p.id !== get().playerId) set((s) => ({ presence: { ...s.presence, [p.id]: p } })); },
      gone: (id: string) => set((s) => { const presence = { ...s.presence }; delete presence[id]; return { presence }; }),
      error: (m: string) => get().toast(m, 'crit'),
      status: (status: ConnStatus, detail?: string) => set({ status, statusDetail: detail ?? '' }),
    };
    let t: Transport;
    if (kind === 'online') t = HOSTED ? new ClaudeRoomTransport(handlers) : new OnlineTransport(handlers, defaultServerUrl());
    else if (kind === 'local') t = new LocalTransport(handlers);
    else t = new SoloTransport(handlers);
    set({ transport: t, mode: kind, status: 'connecting', presence: {} });
    t.connect({ room: roomCode, name: profile.name || 'Cadet', avatar: profile.avatar, clientId: profile.clientId });
  },
  disconnect: () => { get().transport?.close(); set({ transport: null, mode: null, room: null, scene: 'title', status: 'idle', panel: null, sim: null, presence: {} }); },

  send: (a) => get().transport?.sendAction(a),
  design: (c) => {
    const s = get();
    if (!s.room) return;
    if (s.room.phase !== 'design') { s.toast('The mission is flying. Return to design from Mission Control to make changes.', 'warn'); return; }
    s.transport?.sendAction({ t: 'design', change: c });
  },
  openPanel: (id, tab) => set({ panel: { id, tab }, dialogue: null }),
  closePanel: () => set({ panel: null }),
  say: (d) => set({ dialogue: { ...d, index: 0 } }),
  advanceDialogue: () => {
    const d = get().dialogue;
    if (!d) return;
    if (d.index + 1 < d.lines.length) set({ dialogue: { ...d, index: d.index + 1 } });
    else { set({ dialogue: null }); if (d.then) get().openPanel(d.then.panel, d.then.tab); }
  },
  toast: (text, kind = 'info') => {
    const t: Toast = { id: toastId++, text, kind, at: Date.now() };
    set((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === 'crit' ? 7000 : 5000);
  },
  setMap: (id) => set({ mapId: id }),
  myRoles: () => { const s = get(); return s.room?.players[s.playerId]?.roles ?? []; },
  can: (role) => { const s = get(); return !!s.room && canAct(s.room, s.playerId, role); },
  canChange: (c) => get().can(roleForChange(c)),
  refreshVault: () => set({ vaultRuns: vault.list() }),
  setCompare: (slot, id) => set((s) => { const c: [string | null, string | null] = [...s.compare] as [string | null, string | null]; c[slot] = id; return { compare: c }; }),
  setSim: (p) => set((s) => ({ sim: p === null ? null : ({ ...(s.sim as SimView), ...p }) })),
  pickMission: (objectiveId) => {
    const s = get();
    if (!s.room) return;
    if (s.room.missionSelected && s.room.design.objectiveId === objectiveId && s.room.phase !== 'sim') { set({ scene: 'game' }); return; }
    s.transport?.sendAction({ t: 'selectMission', objectiveId });
  },
  openSelect: () => set({ scene: 'select', panel: null, dialogue: null }),
  guideSeen: loadGuideSeen(),
  markGuideSeen: (id) => {
    const g = { ...get().guideSeen, [id]: true };
    try { localStorage.setItem('smdg-guides', JSON.stringify(g)); } catch { /* ignore */ }
    set({ guideSeen: g });
  },
  isCoop: () => get().mode !== null && get().mode !== 'solo',
  mccUnlocked: () => (get().room?.launches ?? 0) > 0 || !!get().room?.sim,
}));

function recompute() {
  const s = useStore.getState();
  if (!s.room) return;
  const key = JSON.stringify([s.room.design, s.room.modifiers]);
  if (key === s.resourcesKey) return;
  useStore.setState({ resources: computeResources(s.room.design, s.room.modifiers), resourcesKey: key });
}

function applyRemote(sa: SequencedAction) {
  const s = useStore.getState();
  if (!s.room) return;
  if (sa.seq <= s.room.seq) return;
  if (sa.seq > s.room.seq + 1 && s.transport?.kind !== 'solo') { s.transport?.resync(); if (!(s.transport instanceof OnlineTransport)) return; }
  let next: RoomState;
  try { next = reduce(s.room, sa); } catch (e) {
    console.warn('reducer rejected sequenced action', sa, e);
    next = { ...s.room, seq: sa.seq };
  }
  const prev = s.room;
  useStore.setState({ room: next });
  s.transport?.setLatestState(next);
  recompute();
  // Side-effect notifications
  const me = s.playerId;
  const a = sa.action;
  if (a.t === 'chat' && sa.by !== me && !s.chatOpen) useStore.setState({ unread: s.unread + 1 });
  if (next.designEvents.length > prev.designEvents.length) {
    const ev = next.designEvents[next.designEvents.length - 1];
    s.toast(`📰 ${ev.title}: ${ev.message}`, 'event');
  }
  const newProps = next.proposals.filter((p) => p.status === 'open' && !prev.proposals.some((q) => q.id === p.id));
  for (const p of newProps) {
    const mine = p.needs.some((r) => canAct(next, me, r));
    if (p.by === me) s.toast(`Your change needs approval from ${p.needs.join(' + ')}: ${p.reason}`, 'warn');
    else if (mine) s.toast(`${p.byName} needs your approval: ${p.summary}`, 'event');
  }
  if (a.t === 'signoff' && next.lastSignoff && !next.lastSignoff.ok && sa.by === me) s.toast(`NO-GO: ${next.lastSignoff.blockers[0]}`, 'crit');
  if (a.t === 'signoff' && next.phase === 'sim' && prev.phase !== 'sim') s.toast('🚀 Liftoff! Mission Control is now open — watch it live.', 'ok');
  if (a.t === 'loadRun' && sa.by !== me) s.toast(`Flight Director loaded "${a.save.name}"`, 'info');
  if (a.t === 'selectMission') {
    useStore.setState({ scene: 'game', panel: null });
    if (sa.by !== me) s.toast(`Mission changed by ${prev.players[sa.by]?.name ?? 'the Flight Director'}`, 'event');
  }
}

/** Derived: report context for the vault */
export function teamOf(room: RoomState) {
  return Object.values(room.players).map((p) => ({ name: p.name, roles: p.roles }));
}
