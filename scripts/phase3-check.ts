// Phase 3 acceptance checks: mission catalog, tiered presets, room flow
// (mission select → presets → launch → Mission Control unlock), the 5-building
// map with the HQ guard, legacy-save migration and the word budget.
// `npm run test:phase3`
import { DIFFICULTY_MAP, OBJECTIVES, OBJECTIVE_MAP, REFERENCE_DESIGNS } from '../shared/data/mission';
import { EASY_PRESETS, MEDIUM_PRESETS, presetsFor } from '../shared/data/missionPresets';
import { computeResources } from '../shared/engine/physics';
import { composeDesign, presetsComplete } from '../shared/engine/presets';
import { freshDesign, initialRoomState, migrateDesign, reduce, type Action, type RoomState } from '../shared/room';
import { BUILDINGS, GUARD, getMaps } from '../src/game/maps';
import type { MissionDesign } from '../shared/types';

let pass = 0, fail = 0;
const ok = (cond: unknown, label: string) => { if (cond) { pass++; console.log(`  ✔ ${label}`); } else { fail++; console.log(`  ✘ ${label}`); } };
const words = (s: string) => s.trim().split(/\s+/).length;

console.log('Mission catalog');
const byLevel = (l: string) => OBJECTIVES.filter((o) => o.level === l).map((o) => o.id);
ok(OBJECTIVES.length === 7, '7 mission cards');
ok(byLevel('easy').join() === 'lro,storm', 'Easy: Lunar Reconnaissance Orbiter + Storm Watcher');
ok(byLevel('medium').join() === 'lim,ast', 'Medium: Lunar Ice Hunter + Asteroid Rendezvous');
ok(byLevel('hard').join() === 'mars,eor', 'Hard: Mars + Europa');
ok(byLevel('sandbox').join() === 'sandbox', 'Sandbox testbed');
ok(OBJECTIVES.every((o) => DIFFICULTY_MAP[o.difficulty] && o.tagline && o.target), 'every card has rules, tagline and target');
for (const [id, ref] of Object.entries(REFERENCE_DESIGNS)) {
  const r = computeResources({ ...ref, difficulty: OBJECTIVE_MAP[id].difficulty, scenarioSeed: 'P3' });
  ok(r.compatibility.blockers.length === 0 && r.estimatedSuccess > 0.55, `NASA baseline for ${id} is launchable (${Math.round(r.estimatedSuccess * 100)}%)`);
}

console.log('Tiered presets');
const EASY_SLOTS = ['engine', 'fuel', 'power', 'instrument', 'comms', 'orbit'];
for (const [id, set] of Object.entries(EASY_PRESETS)) {
  ok(set.slots.map((s) => s.id).join() === EASY_SLOTS.join(), `${id}: Easy has Engine, Fuel, Power, Science, Comms, Orbit`);
  ok(set.slots.every((s) => s.options.length === 3 && s.options.map((o) => o.tier).join() === '1,2,3'), `${id}: exactly 3 options (low/medium/high) per slot`);
  const base = freshDesign(id, 'P3');
  const pick = (k: number) => composeDesign({ ...base, presets: Object.fromEntries(set.slots.map((s) => [s.id, s.options[k].id])) });
  const mid = computeResources(pick(1)), high = computeResources(pick(2)), low = computeResources(pick(0));
  ok(mid.compatibility.blockers.length === 0 && mid.estimatedSuccess > 0.6, `${id}: all-balanced design flies (${Math.round(mid.estimatedSuccess * 100)}%)`);
  ok(high.pillars.budget.status === 'crit', `${id}: all-max design is over budget (forces trade-offs)`);
  ok(low.estimatedSuccess < 0.5, `${id}: all-cheapest design does not succeed`);
}
for (const [id, set] of Object.entries(MEDIUM_PRESETS)) {
  const ids = set.slots.map((s) => s.id);
  ok(set.slots.length >= 8 && ['attitude', 'thermal', 'engine', 'orbit', 'rocket'].every((x) => ids.includes(x as never)), `${id}: Medium adds attitude, thermal, propellant, altitude, rocket`);
  ok(set.slots.every((s) => s.options.length >= 3 && s.options.length <= 4 && s.why.length > 0), `${id}: 3–4 options + a why for each subsystem`);
}
ok(!presetsFor('mars', 'director') && !presetsFor('eor', 'director') && !presetsFor('sandbox', 'sandbox'), 'Hard & Sandbox use the full catalog (no presets)');

console.log('Room flow');
let st: RoomState = initialRoomState('T');
let seq = 0;
const act = (by: string, a: Action) => { st = reduce(st, { seq: ++seq, by, at: 1000 * seq, nonce: 'n', action: a }); };
act('p1', { t: 'join', id: 'p1', name: 'Ada', avatar: 0 });
ok(!st.missionSelected && st.launches === 0, 'starts with no mission and Mission Control locked');
act('p1', { t: 'selectMission', objectiveId: 'lro' });
ok(st.missionSelected && st.design.objectiveId === 'lro' && st.design.difficulty === 'cadet', 'Mission Selection loads Easy rules');
ok(!presetsComplete(st.design), 'Easy starts with empty choices');
act('p1', { t: 'signoff' });
ok(st.phase === 'design' && !!st.lastSignoff && !st.lastSignoff.ok && /every part/i.test(st.lastSignoff.blockers[0]), 'LAUNCH refused until every part is chosen');
for (const s of EASY_PRESETS.lro.slots) act('p1', { t: 'design', change: { k: 'preset', slot: s.id, option: s.options[1].id } });
ok(presetsComplete(st.design) && st.design.components.some((c) => c.id === 'prop_biprop'), 'preset picks compose real hardware');
act('p1', { t: 'signoff' });
ok(st.phase === 'sim' && st.launches === 1, 'LAUNCH starts the flight and unlocks Mission Control');
act('p1', { t: 'simDone' });
act('p1', { t: 'resetSim' });
ok(st.phase === 'design' && st.launches === 1, 'Mission Control stays unlocked after flying again');
act('p1', { t: 'selectMission', objectiveId: 'mars' });
ok(st.design.difficulty === 'director' && !st.design.presets, 'Hard mission switches to full engineering');
act('p2', { t: 'join', id: 'p2', name: 'Bo', avatar: 1 });
let threw = false;
try { reduce(st, { seq: seq + 1, by: 'p2', at: 0, nonce: 'x', action: { t: 'selectMission', objectiveId: 'lro' } }); } catch { threw = true; }
ok(threw, 'only the Flight Director can change a chosen mission in co-op');

console.log('Legacy saves');
const old = { ...REFERENCE_DESIGNS.lro, objectiveId: 'ecm', difficulty: 'engineer', scenarioSeed: 'OLD', nasa: { x: 1 }, components: [{ id: 'ins_bn_pack', qty: 1 }, { id: 'ins_tir', qty: 1 }] } as unknown as MissionDesign;
const m = migrateDesign(old);
ok(m.objectiveId === 'storm' && !('nasa' in m) && !m.components.some((c) => c.id === 'ins_bn_pack'), 'old objective/fields/parts are migrated');

console.log('Campus map');
const maps = getMaps();
ok(BUILDINGS.length === 5 && ['mission', 'command', 'mcc', 'archives', 'academy'].every((id) => BUILDINGS.some((b) => b.id === id)), 'exactly 5 buildings');
const hq = BUILDINGS.find((b) => b.id === 'command')!;
ok(GUARD.x === hq.door[0] && GUARD.y === hq.door[1] + 1, 'guard stands directly in front of the HQ Command door');
const ow = maps.overworld;
ok(!!GUARD.aside && !ow.solid[GUARD.aside[1] * ow.w + GUARD.aside[0]], 'guard has a free spot to step aside to in co-op');
ok(['mission', 'command', 'mcc', 'archives', 'academy'].every((id) => !!maps[id]), 'every building has an interior');

console.log('Word budget');
const card = OBJECTIVES.map((o) => words(o.tagline));
ok(Math.max(...card) <= 16, `mission taglines ≤ 16 words (max ${Math.max(...card)})`);
const blurbs = [...Object.values(EASY_PRESETS), ...Object.values(MEDIUM_PRESETS)].flatMap((s) => s.slots.flatMap((x) => x.options.map((o) => words(o.blurb))));
ok(Math.max(...blurbs) <= 12, `option blurbs ≤ 12 words (max ${Math.max(...blurbs)})`);
const whys = Object.values(MEDIUM_PRESETS).flatMap((s) => s.slots.map((x) => words(x.why)));
ok(Math.max(...whys) <= 22, `Medium "why" lines ≤ 22 words (max ${Math.max(...whys)})`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
