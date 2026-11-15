// ─────────────────────────────────────────────────────────────────────────────
// Shared room state + deterministic reducer.
// The host (Node server, a host browser tab, or the solo in-process core)
// sequences every action, stamps it with time + nonce, and broadcasts it.
// Every client runs the SAME reducer over the SAME sequence → identical state.
// Roles, permissions, resource locks and trade-off negotiation live here.
// ─────────────────────────────────────────────────────────────────────────────
import { COMPONENT_MAP } from './data/components';
import { DIFFICULTY_MAP, LEGACY_OBJECTIVE, OBJECTIVE_MAP, ORBIT_MAP, REFERENCE_DESIGNS, RESOURCE_OWNER, ROLES, ROLE_MAP, emptyDesign, GN_MAP, LV_MAP } from './data/mission';
import { SLOT_META, presetsFor, type SlotId } from './data/missionPresets';
import { NO_MODS, computeResources, fmt, impactOfChange, selectionWith, type ImpactCheck } from './engine/physics';
import { Rng } from './engine/rng';
import { emptyMetrics } from './engine/score';
import { composeDesign, presetsComplete } from './engine/presets';
import type {
  ComponentCategory, DesignEvent, DesignModifiers, Difficulty, MissionDesign, MissionRunSave, OrbitChoice, ResourceKey, RoleId, TeamMetrics,
} from './types';

export const MAX_PLAYERS = 4;
export const AVATAR_COUNT = 6;

export interface PlayerInfo { id: string; name: string; roles: RoleId[]; avatar: number; joinedAt: number; }
export interface ChatMsg { id: string; by: string; name: string; text: string; at: number; system?: boolean; }

export type DesignChange =
  | { k: 'objective'; objectiveId: string }
  | { k: 'difficulty'; difficulty: Difficulty }
  | { k: 'seed'; seed: string }
  | { k: 'bus'; busId: string }
  | { k: 'component'; id: string; qty: number }
  | { k: 'fleet'; n: number }
  | { k: 'orbit'; orbit: OrbitChoice }
  | { k: 'launch'; lvId: string }
  | { k: 'ground'; gnId: string }
  | { k: 'contact'; hours: number }
  | { k: 'reserve'; pct: number }
  | { k: 'years'; years: number }
  | { k: 'reference' }
  | { k: 'clear' }
  | { k: 'preset'; slot: string; option: string };

export interface Proposal {
  id: string; by: string; byName: string; byRoles: RoleId[];
  change: DesignChange; summary: string; impacts: ImpactCheck[]; needs: RoleId[];
  votes: Partial<Record<RoleId, 'yes' | 'no'>>; fixes: DesignChange[];
  status: 'open' | 'approved' | 'rejected' | 'withdrawn'; createdAt: number; resolvedAt?: number; reason: string;
}

export type Action =
  | { t: 'join'; id: string; name: string; avatar: number }
  | { t: 'leave'; id: string }
  | { t: 'claimRole'; role: RoleId }
  | { t: 'releaseRole'; role: RoleId }
  | { t: 'setTeamName'; name: string }
  | { t: 'design'; change: DesignChange }
  | { t: 'vote'; proposalId: string; vote: 'yes' | 'no'; fix?: DesignChange }
  | { t: 'withdraw'; proposalId: string }
  | { t: 'lock'; resource: ResourceKey }
  | { t: 'unlock'; resource: ResourceKey }
  | { t: 'chat'; text: string }
  | { t: 'signoff' }
  | { t: 'decide'; index: number; choice: string; waitedMs: number }
  | { t: 'simDone' }
  | { t: 'resetSim' }
  | { t: 'loadRun'; save: MissionRunSave; branch: boolean }
  | { t: 'selectMission'; objectiveId: string };

export interface SequencedAction { seq: number; by: string; at: number; nonce: string; action: Action; }

export interface RoomState {
  id: string;
  seq: number;
  teamName: string;
  players: Record<string, PlayerInfo>;
  design: MissionDesign;
  modifiers: DesignModifiers;
  designEvents: DesignEvent[];
  designActions: number;
  lastEventAt: number;
  proposals: Proposal[];
  locks: Partial<Record<ResourceKey, RoleId>>;
  chat: ChatMsg[];
  feed: { at: number; text: string; kind: 'info' | 'warn' | 'event' | 'ok' }[];
  metrics: TeamMetrics;
  phase: 'design' | 'sim' | 'done';
  sim: { runId: string; seed: string; decisions: string[]; startedAt: number; designVersion: number } | null;
  lastSignoff: { at: number; ok: boolean; blockers: string[] } | null;
  branchOf: { id: string; name: string } | null;
  recentAdds: Record<string, number>;
  designVersion: number;
  /** false until someone picks a mission on the Mission Selection screen */
  missionSelected: boolean;
  /** launches GO'd in this room — Mission Control unlocks after the first one */
  launches: number;
}

export function initialRoomState(id: string, seed = 'ARTEMIS'): RoomState {
  return {
    id, seq: 0, teamName: 'Mission Team', players: {}, design: freshDesign('lro', seed), modifiers: cloneMods(NO_MODS), designEvents: [],
    designActions: 0, lastEventAt: 0, proposals: [], locks: {}, chat: [], feed: [], metrics: emptyMetrics(), phase: 'design', sim: null,
    lastSignoff: null, branchOf: null, recentAdds: {}, designVersion: 0, missionSelected: false, launches: 0,
  };
}

/** A new design for a mission: Easy/Medium start with empty choices, Hard with a bare bus, Sandbox with a working baseline. */
export function freshDesign(objectiveId: string, seed = 'ARTEMIS'): MissionDesign {
  const obj = OBJECTIVE_MAP[objectiveId] ?? OBJECTIVE_MAP.sandbox;
  const d = emptyDesign(obj.id, obj.difficulty, seed);
  if (presetsFor(obj.id, obj.difficulty)) return composeDesign({ ...d, presets: {} });
  if (obj.level === 'sandbox') { const ref = REFERENCE_DESIGNS.sandbox; return { ...d, ...ref, components: ref.components.map((x) => ({ ...x })), orbit: { ...ref.orbit }, reservePct: 0 }; }
  return d;
}

/** Bring an old or shared design up to date (removed missions, removed Phase 2 fields, preset hardware). */
export function migrateDesign(input: MissionDesign): MissionDesign {
  const d = { ...(input as MissionDesign & { nasa?: unknown }) };
  delete (d as { nasa?: unknown }).nasa;
  if (!OBJECTIVE_MAP[d.objectiveId]) d.objectiveId = LEGACY_OBJECTIVE[d.objectiveId] ?? 'sandbox';
  if (!DIFFICULTY_MAP[d.difficulty]) d.difficulty = OBJECTIVE_MAP[d.objectiveId].difficulty;
  d.components = (d.components ?? []).filter((c) => COMPONENT_MAP[c.id]).map((c) => ({ ...c }));
  if (!COMPONENT_MAP[d.busId] || COMPONENT_MAP[d.busId].category !== 'bus') d.busId = 'bus_espa';
  if (!ORBIT_MAP[d.orbit?.id]) d.orbit = { id: 'sso', altitudeKm: 700, ltan: 'day' };
  if (!LV_MAP[d.launchVehicleId]) d.launchVehicleId = 'lv_f9';
  if (!GN_MAP[d.groundNetworkId]) d.groundNetworkId = 'gs_comm';
  return presetsFor(d.objectiveId, d.difficulty) ? composeDesign({ ...d, presets: d.presets ?? {} }) : d;
}

export const cloneMods = (m: DesignModifiers): DesignModifiers => ({ ...m, costOverrun: { ...m.costOverrun }, extraLeadMonths: { ...m.extraLeadMonths } });

// ── Permissions ─────────────────────────────────────────────────────────────
export function roleForChange(c: DesignChange): RoleId {
  switch (c.k) {
    case 'objective': case 'difficulty': case 'seed': case 'orbit': case 'years': case 'reference': case 'clear': return 'director';
    case 'preset': return SLOT_META[c.slot as SlotId]?.role ?? 'director';
    case 'bus': case 'fleet': return 'systems';
    case 'launch': case 'ground': case 'contact': case 'reserve': return 'ops';
    case 'component': {
      const cat = COMPONENT_MAP[c.id]?.category as ComponentCategory | undefined;
      if (cat === 'instrument' || cat === 'optics') return 'science';
      if (cat === 'comms') return 'ops';
      return 'systems';
    }
  }
}

export function holdersOf(state: RoomState, role: RoleId): PlayerInfo[] {
  return Object.values(state.players).filter((p) => p.roles.includes(role));
}
export function canAct(state: RoomState, playerId: string, role: RoleId): boolean {
  const p = state.players[playerId];
  if (!p) return false;
  if (p.roles.includes(role)) return true;
  return holdersOf(state, role).length === 0; // unclaimed roles are shared
}

export function describeChange(c: DesignChange, d: MissionDesign): string {
  switch (c.k) {
    case 'objective': return `Change objective to ${OBJECTIVE_MAP[c.objectiveId]?.name}`;
    case 'difficulty': return `Set difficulty to ${DIFFICULTY_MAP[c.difficulty]?.name}`;
    case 'seed': return `Set scenario seed to ${c.seed}`;
    case 'bus': return `Switch bus to ${COMPONENT_MAP[c.busId]?.name}`;
    case 'component': {
      const cur = d.components.find((s) => s.id === c.id)?.qty ?? 0;
      const name = COMPONENT_MAP[c.id]?.name ?? c.id;
      return c.qty === 0 ? `Remove ${name}` : cur === 0 ? `Add ${c.qty > 1 ? `${c.qty}× ` : ''}${name}` : `${name}: ${cur} → ${c.qty}`;
    }
    case 'fleet': return `Fleet size ${d.fleetSize} → ${c.n}`;
    case 'orbit': return `Orbit → ${ORBIT_MAP[c.orbit.id]?.name}${ORBIT_MAP[c.orbit.id]?.altitudeRangeKm ? ` @ ${c.orbit.altitudeKm} km` : ''}${c.orbit.ltan === 'dawn-dusk' ? ' (dawn-dusk)' : ''}`;
    case 'launch': return `Launch vehicle → ${LV_MAP[c.lvId]?.name}`;
    case 'ground': return `Ground network → ${GN_MAP[c.gnId]?.name}`;
    case 'contact': return `Contact time → ${c.hours} h/day`;
    case 'reserve': return `Cost reserve → ${Math.round(c.pct * 100)}%`;
    case 'years': return `Mission duration → ${c.years} yr`;
    case 'reference': return 'Load the mentor baseline design';
    case 'clear': return 'Clear all components';
    case 'preset': {
      const set = presetsFor(d.objectiveId, d.difficulty)?.set;
      const o = set?.slots.find((x) => x.id === c.slot)?.options.find((x) => x.id === c.option);
      return `${SLOT_META[c.slot as SlotId]?.label ?? c.slot} → ${o?.label ?? c.option}`;
    }
  }
}

export function applyChange(d: MissionDesign, c: DesignChange): MissionDesign {
  const n: MissionDesign = { ...d, orbit: { ...d.orbit }, components: d.components.map((x) => ({ ...x })) };
  switch (c.k) {
    case 'objective': {
      const obj = OBJECTIVE_MAP[c.objectiveId]; if (!obj) return d;
      n.objectiveId = c.objectiveId; n.missionYears = obj.baselineYears;
      const fam = Object.keys(obj.orbitSuitability).sort((a, b) => (obj.orbitSuitability[b as never] ?? 0) - (obj.orbitSuitability[a as never] ?? 0))[0];
      const orbit = Object.values(ORBIT_MAP).find((o) => o.family === fam);
      if (orbit && (obj.orbitSuitability[ORBIT_MAP[n.orbit.id]?.family] ?? 0) === 0) n.orbit = { id: orbit.id, altitudeKm: orbit.defaultAltitudeKm, ltan: 'day' };
      return n;
    }
    case 'difficulty': n.difficulty = c.difficulty; n.reservePct = Math.max(n.reservePct, DIFFICULTY_MAP[c.difficulty].minReservePct); if (c.difficulty === 'sandbox') n.reservePct = 0; return n;
    case 'seed': n.scenarioSeed = c.seed.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'ARTEMIS'; return n;
    case 'bus': {
      if (COMPONENT_MAP[c.busId]?.category !== 'bus') return d;
      n.busId = c.busId;
      return n;
    }
    case 'component': if (COMPONENT_MAP[c.id] && COMPONENT_MAP[c.id].category !== 'bus') n.components = selectionWith(n.components, c.id, Math.max(0, Math.min(COMPONENT_MAP[c.id].maxQty, Math.round(c.qty)))); return n;
    case 'fleet': n.fleetSize = Math.max(1, Math.min(24, Math.round(c.n))); return n;
    case 'orbit': {
      const o = ORBIT_MAP[c.orbit.id]; if (!o) return d;
      const alt = o.altitudeRangeKm ? Math.max(o.altitudeRangeKm[0], Math.min(o.altitudeRangeKm[1], Math.round(c.orbit.altitudeKm))) : o.defaultAltitudeKm;
      n.orbit = { id: o.id, altitudeKm: alt, ltan: c.orbit.ltan === 'dawn-dusk' && o.family === 'SSO' ? 'dawn-dusk' : 'day' };
      return n;
    }
    case 'launch': if (LV_MAP[c.lvId]) n.launchVehicleId = c.lvId; return n;
    case 'ground': if (GN_MAP[c.gnId]) n.groundNetworkId = c.gnId; return n;
    case 'contact': n.contactHoursPerDay = Math.max(0.5, Math.min(24, c.hours)); return n;
    case 'reserve': n.reservePct = Math.max(0, Math.min(0.5, c.pct)); return n;
    case 'years': n.missionYears = Math.max(0.5, Math.min(15, Math.round(c.years * 2) / 2)); return n;
    case 'reference': {
      const ref = REFERENCE_DESIGNS[d.objectiveId]; if (!ref) return d;
      const r: MissionDesign = { ...ref, components: ref.components.map((x) => ({ ...x })), orbit: { ...ref.orbit }, difficulty: d.difficulty, scenarioSeed: d.scenarioSeed,
        reservePct: Math.max(ref.reservePct, DIFFICULTY_MAP[d.difficulty].minReservePct) };
      return r;
    }
    case 'clear': n.components = []; return n;
    case 'preset': {
      const set = presetsFor(d.objectiveId, d.difficulty)?.set;
      const ok = set?.slots.find((x) => x.id === c.slot)?.options.some((o) => o.id === c.option);
      if (!ok) return d;
      return composeDesign({ ...n, presets: { ...(d.presets ?? {}), [c.slot]: c.option } });
    }
  }
}

// ── Reducer ──────────────────────────────────────────────────────────────────
export class ActionError extends Error {}

function sys(state: RoomState, text: string, at: number, kind: RoomState['feed'][number]['kind'] = 'info') {
  state.feed = [...state.feed.slice(-59), { at, text, kind }];
}

function rebalanceRoles(state: RoomState) {
  const ps = Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const order: RoleId[] = ['director', 'systems', 'science', 'ops'];
  for (const p of ps) p.roles = [];
  if (!ps.length) return;
  order.forEach((r, i) => ps[i % ps.length].roles.push(r));
}

/** Pure-ish reducer: mutates a structural copy. Throws ActionError for invalid actions (host drops them). */
export function reduce(prev: RoomState, sa: SequencedAction): RoomState {
  const state: RoomState = { ...prev, players: { ...prev.players }, seq: sa.seq };
  for (const k of Object.keys(state.players)) state.players[k] = { ...state.players[k], roles: [...state.players[k].roles] };
  const a = sa.action;
  const me = state.players[sa.by];
  const name = me?.name ?? 'someone';
  switch (a.t) {
    case 'join': {
      if (state.players[a.id]) { state.players[a.id].name = a.name; state.players[a.id].avatar = a.avatar; return state; }
      if (Object.keys(state.players).length >= MAX_PLAYERS) throw new ActionError('Room is full (4 players).');
      state.players[a.id] = { id: a.id, name: a.name.slice(0, 16) || 'Cadet', roles: [], avatar: a.avatar % AVATAR_COUNT, joinedAt: sa.at + sa.seq / 1e6 };
      rebalanceRoles(state);
      sys(state, `${a.name} joined the team.`, sa.at, 'ok');
      return state;
    }
    case 'leave': {
      const p = state.players[a.id]; if (!p) return state;
      delete state.players[a.id];
      rebalanceRoles(state);
      state.proposals = state.proposals.map((x) => (x.by === a.id && x.status === 'open' ? { ...x, status: 'withdrawn', resolvedAt: sa.at } : x));
      sys(state, `${p.name} left. Roles were redistributed.`, sa.at, 'warn');
      return state;
    }
    case 'claimRole': {
      if (!me) throw new ActionError('Not in room.');
      const holders = holdersOf(state, a.role).filter((p) => p.id !== me.id);
      if (holders.length) throw new ActionError(`${ROLE_MAP[a.role].name} is held by ${holders[0].name}. Ask them to release it.`);
      if (!me.roles.includes(a.role)) me.roles.push(a.role);
      sys(state, `${name} is now ${ROLE_MAP[a.role].name}.`, sa.at);
      return state;
    }
    case 'releaseRole': {
      if (!me) throw new ActionError('Not in room.');
      if (me.roles.length <= 1 && Object.keys(state.players).length > 1) { /* allow, role becomes shared */ }
      me.roles = me.roles.filter((r) => r !== a.role);
      sys(state, `${name} released ${ROLE_MAP[a.role].name} — anyone may claim it.`, sa.at);
      return state;
    }
    case 'setTeamName': state.teamName = a.name.slice(0, 24) || 'Mission Team'; return state;
    case 'chat': {
      if (!me) throw new ActionError('Not in room.');
      const text = a.text.trim().slice(0, 280);
      if (!text) return state;
      state.chat = [...state.chat.slice(-99), { id: `${sa.seq}`, by: sa.by, name, text, at: sa.at }];
      state.metrics = { ...state.metrics, chatMessages: state.metrics.chatMessages + 1 };
      return state;
    }
    case 'lock': case 'unlock': {
      if (!me) throw new ActionError('Not in room.');
      const owner = RESOURCE_OWNER[a.resource];
      if (!canAct(state, sa.by, owner)) throw new ActionError(`Only the ${ROLE_MAP[owner].name} can lock ${a.resource}.`);
      state.locks = { ...state.locks };
      if (a.t === 'lock') { state.locks[a.resource] = owner; sys(state, `${name} locked ${a.resource.toUpperCase()}: changes that consume it need ${ROLE_MAP[owner].short} approval.`, sa.at); }
      else { delete state.locks[a.resource]; sys(state, `${name} unlocked ${a.resource.toUpperCase()}.`, sa.at); }
      return state;
    }
    case 'design': {
      if (!me) throw new ActionError('Not in room.');
      if (state.phase !== 'design') throw new ActionError('The mission is flying — return to design (Mission Control) first.');
      return proposeOrApply(state, sa, a.change);
    }
    case 'vote': {
      const p = state.proposals.find((x) => x.id === a.proposalId);
      if (!p || p.status !== 'open') throw new ActionError('That proposal is closed.');
      if (!me) throw new ActionError('Not in room.');
      const myNeeded = p.needs.filter((r) => me.roles.includes(r) || holdersOf(state, r).length === 0);
      if (!myNeeded.length) throw new ActionError('Your roles are not needed for this approval.');
      const votes = { ...p.votes };
      for (const r of myNeeded) votes[r] = a.vote;
      const fixes = [...p.fixes];
      if (a.fix && a.vote === 'yes') {
        const fr = roleForChange(a.fix);
        if (!canAct(state, sa.by, fr)) throw new ActionError('You can only attach fixes in your own subsystem.');
        fixes.push(a.fix);
      }
      let np: Proposal = { ...p, votes, fixes };
      if (a.vote === 'no') {
        np = { ...np, status: 'rejected', resolvedAt: sa.at };
        state.metrics = { ...state.metrics, rejected: state.metrics.rejected + 1, resolveMsTotal: state.metrics.resolveMsTotal + (sa.at - p.createdAt) };
        sys(state, `${name} rejected: ${p.summary}.`, sa.at, 'warn');
      } else if (np.needs.every((r) => votes[r] === 'yes')) {
        np = { ...np, status: 'approved', resolvedAt: sa.at };
        let d = applyChange(state.design, p.change);
        for (const f of fixes) d = applyChange(d, f);
        state.design = d;
        state.designVersion++;
        state.metrics = { ...state.metrics, approved: state.metrics.approved + 1, resolveMsTotal: state.metrics.resolveMsTotal + (sa.at - p.createdAt) };
        sys(state, `Approved: ${p.summary}${fixes.length ? ` + ${fixes.map((f) => describeChange(f, state.design)).join(', ')}` : ''}.`, sa.at, 'ok');
        countAction(state, p.byRoles[0] ?? roleForChange(p.change));
        maybeDesignEvent(state, sa);
      }
      state.proposals = state.proposals.map((x) => (x.id === p.id ? np : x)).slice(-30);
      return state;
    }
    case 'withdraw': {
      const p = state.proposals.find((x) => x.id === a.proposalId);
      if (!p || p.status !== 'open') return state;
      if (p.by !== sa.by) throw new ActionError('Only the proposer can withdraw it.');
      state.proposals = state.proposals.map((x) => (x.id === p.id ? { ...x, status: 'withdrawn', resolvedAt: sa.at } : x));
      return state;
    }
    case 'signoff': {
      if (!me) throw new ActionError('Not in room.');
      if (!canAct(state, sa.by, 'director')) throw new ActionError('Only the Flight Director can give the launch GO.');
      if (state.phase !== 'design') throw new ActionError('Already flying.');
      const res = computeResources(state.design, state.modifiers);
      const open = state.proposals.filter((p) => p.status === 'open');
      const missing = presetsComplete(state.design) ? [] : ['Make a choice for every part first.'];
      const blockers = [...missing, ...res.compatibility.blockers, ...(open.length ? [`${open.length} open proposal(s) still awaiting team approval.`] : [])];
      state.metrics = { ...state.metrics, signoffAttempts: state.metrics.signoffAttempts + 1, signoffFailures: state.metrics.signoffFailures + (blockers.length ? 1 : 0) };
      state.lastSignoff = { at: sa.at, ok: blockers.length === 0, blockers };
      if (blockers.length) { sys(state, `Launch poll: NO-GO — ${blockers[0]}`, sa.at, 'warn'); return state; }
      state.phase = 'sim';
      state.launches = (state.launches ?? 0) + 1;
      state.sim = { runId: `run-${sa.seq}-${sa.nonce}`, seed: state.design.scenarioSeed, decisions: [], startedAt: sa.at, designVersion: state.designVersion };
      sys(state, `🚀 GO! ${name} launched the mission. Watch it live in Mission Control.`, sa.at, 'ok');
      return state;
    }
    case 'decide': {
      if (!state.sim) throw new ActionError('No simulation running.');
      if (!canAct(state, sa.by, 'ops')) throw new ActionError('Anomaly responses belong to the Ops & Resource Controller.');
      if (a.index !== state.sim.decisions.length) return state; // duplicate / stale
      state.sim = { ...state.sim, decisions: [...state.sim.decisions, a.choice] };
      state.metrics = { ...state.metrics, decisions: state.metrics.decisions + 1, decisionMsTotal: state.metrics.decisionMsTotal + Math.min(600000, Math.max(0, a.waitedMs)) };
      countAction(state, 'ops');
      return state;
    }
    case 'simDone': if (state.phase === 'sim') state.phase = 'done'; return state;
    case 'selectMission': {
      if (!me) throw new ActionError('Not in room.');
      if (!OBJECTIVE_MAP[a.objectiveId]) throw new ActionError('Unknown mission.');
      if (state.missionSelected && !canAct(state, sa.by, 'director')) throw new ActionError('Only the Flight Director can change the mission.');
      if (state.phase === 'sim') throw new ActionError('A mission is flying — wait for it to finish.');
      state.design = freshDesign(a.objectiveId, state.design.scenarioSeed);
      state.modifiers = cloneMods(NO_MODS); state.designEvents = []; state.lastEventAt = 0; state.designActions = 0;
      state.proposals = []; state.locks = {}; state.phase = 'design'; state.sim = null; state.branchOf = null; state.lastSignoff = null;
      state.missionSelected = true; state.designVersion++;
      sys(state, `${name} picked the mission: ${OBJECTIVE_MAP[a.objectiveId].name}.`, sa.at, 'event');
      return state;
    }
    case 'resetSim': {
      if (!canAct(state, sa.by, 'director') && state.phase === 'sim') throw new ActionError('Only the Flight Director can abort a flying mission.');
      state.phase = 'design'; state.sim = null;
      sys(state, `${name} returned the team to the design phase.`, sa.at);
      return state;
    }
    case 'loadRun': {
      if (!canAct(state, sa.by, 'director')) throw new ActionError('Only the Flight Director can load a saved run into the room.');
      const s = a.save;
      state.design = migrateDesign({ ...s.design, orbit: { ...s.design.orbit }, components: s.design.components.map((x) => ({ ...x })) });
      state.missionSelected = true;
      state.modifiers = cloneMods(s.modifiers ?? NO_MODS);
      state.designEvents = [...(s.designEvents ?? [])];
      state.phase = 'design'; state.sim = null; state.proposals = []; state.designVersion++;
      state.branchOf = a.branch ? { id: s.id, name: s.name } : null;
      sys(state, a.branch ? `Time-Machine: branched from "${s.name}". Change a parameter and fly again to compare.` : `Loaded "${s.name}".`, sa.at, 'event');
      return state;
    }
  }
}

function countAction(state: RoomState, role: RoleId) {
  const m = state.metrics;
  state.metrics = { ...m, actions: m.actions + 1, actionsByRole: { ...m.actionsByRole, [role]: (m.actionsByRole[role] ?? 0) + 1 } };
}

function proposeOrApply(state: RoomState, sa: SequencedAction, change: DesignChange): RoomState {
  const me = state.players[sa.by];
  const ownerRole = roleForChange(change);
  const next = applyChange(state.design, change);
  if (JSON.stringify(next) === JSON.stringify(state.design)) return state;
  const before = computeResources(state.design, state.modifiers);
  const after = computeResources(next, state.modifiers);
  const impacts = impactOfChange(before, after);
  const needs = new Set<RoleId>();
  const reasons: string[] = [];
  if (!me.roles.includes(ownerRole) && holdersOf(state, ownerRole).length) { needs.add(ownerRole); reasons.push(`${ROLE_MAP[ownerRole].short} owns this decision`); }
  const structural = change.k === 'objective' || change.k === 'difficulty' || change.k === 'seed' || change.k === 'reference' || change.k === 'clear';
  if (!structural) {
    for (const imp of impacts) {
      const owner = imp.owner as RoleId;
      if (imp.afterStatus === 'ok') continue;
      if (me.roles.includes(owner) || holdersOf(state, owner).length === 0) continue;
      needs.add(owner); reasons.push(`${imp.resource.toUpperCase()} → ${imp.afterStatus === 'crit' ? 'RED' : 'YELLOW'}`);
    }
    for (const [res, lockRole] of Object.entries(state.locks) as [ResourceKey, RoleId][]) {
      const b = before.pillars[res], a = after.pillars[res];
      if (a.utilization > b.utilization + 1e-9 && !me.roles.includes(lockRole) && holdersOf(state, lockRole).length) { needs.add(lockRole); reasons.push(`${res.toUpperCase()} is locked`); }
    }
  }
  // Churn tracking: adding then quickly removing the same part
  if (change.k === 'component') {
    const prevQty = state.design.components.find((s) => s.id === change.id)?.qty ?? 0;
    state.recentAdds = { ...state.recentAdds };
    if (change.qty > prevQty) state.recentAdds[change.id] = state.designActions;
    else if (change.qty < prevQty && state.recentAdds[change.id] !== undefined && state.designActions - state.recentAdds[change.id] <= 3) {
      state.metrics = { ...state.metrics, reverts: state.metrics.reverts + 1 };
    }
  }
  const summary = describeChange(change, state.design);
  if (needs.size === 0) {
    state.design = next;
    state.designVersion++;
    if (change.k === 'objective' || change.k === 'difficulty' || change.k === 'seed') {
      state.modifiers = cloneMods(NO_MODS); state.designEvents = []; state.lastEventAt = 0; state.designActions = 0; state.branchOf = null;
      if (change.k === 'difficulty') state.design = { ...state.design, reservePct: Math.max(state.design.reservePct, DIFFICULTY_MAP[change.difficulty].minReservePct) };
    }
    const worse = impacts.filter((i) => i.afterStatus !== 'ok').map((i) => `${i.resource.toUpperCase()} ${i.afterStatus === 'crit' ? 'RED' : 'YELLOW'}`);
    sys(state, `${me.name}: ${summary}${worse.length ? ` (⚠ ${worse.join(', ')})` : ''}`, sa.at, worse.length ? 'warn' : 'info');
    countAction(state, me.roles.includes(ownerRole) ? ownerRole : me.roles[0] ?? ownerRole);
    if (!structural) maybeDesignEvent(state, sa);
    return state;
  }
  const p: Proposal = {
    id: `p${sa.seq}`, by: sa.by, byName: me.name, byRoles: [...me.roles], change, summary, impacts, needs: [...needs], votes: {}, fixes: [],
    status: 'open', createdAt: sa.at, reason: reasons.join('; '),
  };
  state.proposals = [...state.proposals.filter((x) => x.status === 'open' || sa.at - (x.resolvedAt ?? 0) < 120000).slice(-20), p];
  state.metrics = { ...state.metrics, proposals: state.metrics.proposals + 1 };
  sys(state, `${me.name} proposes: ${summary} — needs ${p.needs.map((r) => ROLE_MAP[r].short).join(' + ')} approval (${p.reason}).`, sa.at, 'event');
  return state;
}

// ── Random design-phase events (budget cuts, delays, overruns) ──────────────
function maybeDesignEvent(state: RoomState, sa: SequencedAction) {
  state.designActions++;
  const diff = DIFFICULTY_MAP[state.design.difficulty];
  if (state.designEvents.length >= diff.maxDesignEvents) return;
  if (state.designActions < 5 || state.designActions - state.lastEventAt < 6) return;
  const rng = new Rng(`${state.design.scenarioSeed}|design|${state.designActions}`);
  if (!rng.chance(diff.designEventRate)) return;
  const roll = rng.next();
  const parts = state.design.components.map((c) => c.id).filter((id) => COMPONENT_MAP[id]);
  const mods = cloneMods(state.modifiers);
  let ev: DesignEvent;
  const id = `e${state.designActions}`;
  if (roll < 0.3) {
    mods.budgetCapMult *= 0.9;
    ev = { id, kind: 'budget_cut', title: 'Budget cut: −10%', message: 'Congress trimmed the science budget. Your grant cap drops 10% — find savings or justify the cost.', atAction: state.designActions };
  } else if (roll < 0.48) {
    mods.launchDelayMonths += 3;
    ev = { id, kind: 'launch_delay', title: 'Launch window delay', message: 'The launch provider slipped its manifest by 3 months. Check your deadline and launch window.', atAction: state.designActions };
  } else if (roll < 0.68 && parts.length) {
    const target = rng.pick(parts);
    mods.extraLeadMonths[target] = (mods.extraLeadMonths[target] ?? 0) + 5;
    ev = { id, kind: 'supplier_delay', title: 'Supplier delay', message: `The supplier of ${COMPONENT_MAP[target].name} is 5 months late. If it is your longest-lead item, launch slips.`, atAction: state.designActions, targetComponent: target };
  } else if (roll < 0.9 && parts.length) {
    const target = rng.pick(parts);
    mods.costOverrun[target] = (mods.costOverrun[target] ?? 1) * 1.3;
    ev = { id, kind: 'cost_overrun', title: 'Cost overrun', message: `${COMPONENT_MAP[target].name} came in 30% over its estimate during critical design review.`, atAction: state.designActions, targetComponent: target };
  } else if (roll < 0.95) {
    mods.budgetCapMult *= 1.05;
    ev = { id, kind: 'plus_up', title: 'Budget plus-up: +5%', message: 'A successful review earned a small budget increase.', atAction: state.designActions };
  } else {
    const inst = parts.filter((p) => COMPONENT_MAP[p].category === 'instrument');
    const target = inst.length ? rng.pick(inst) : parts[0];
    if (!target) return;
    mods.costOverrun[target] = (mods.costOverrun[target] ?? 1) * 0.85;
    ev = { id, kind: 'tech_breakthrough', title: 'Technology breakthrough', message: `A heritage design cut the cost of ${COMPONENT_MAP[target].name} by 15%.`, atAction: state.designActions, targetComponent: target };
  }
  state.modifiers = mods;
  state.designEvents = [...state.designEvents, ev];
  state.lastEventAt = state.designActions;
  sys(state, `📰 ${ev.title}: ${ev.message}`, sa.at, 'event');
  void fmt;
}

// ── Host core: sequences actions and keeps the authoritative copy ──────────
export class RoomCore {
  state: RoomState;
  constructor(id: string, initial?: RoomState) {
    this.state = initial ?? initialRoomState(id);
  }
  /** Validate + sequence. Returns the broadcastable action or an error for the sender. */
  handle(by: string, action: Action, now = Date.now()): { sa?: SequencedAction; error?: string } {
    const sa: SequencedAction = { seq: this.state.seq + 1, by, at: now, nonce: Math.random().toString(36).slice(2, 8), action };
    try {
      this.state = reduce(this.state, sa);
      return { sa };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function roleBadge(roles: RoleId[]) { return roles.map((r) => ROLE_MAP[r].short).join('+') || 'crew'; }
export { ROLES };
