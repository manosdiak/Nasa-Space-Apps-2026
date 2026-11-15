// Turns Easy/Medium preset choices into a full MissionDesign.
// The bus is fixed per mission; when the mission has no Rocket slot the
// cheapest rocket that can lift the spacecraft is picked automatically.
import { COMPONENT_MAP } from '../data/components';
import { LV_MAP } from '../data/mission';
import { presetsFor, type MissionPresetSet, type PresetOption } from '../data/missionPresets';
import type { ComponentSelection, MissionDesign } from '../types';
import { computeResources } from './physics';

export function chosenOption(set: MissionPresetSet, slotId: string, presets: Record<string, string> | undefined): PresetOption | undefined {
  const s = set.slots.find((x) => x.id === slotId);
  const id = presets?.[slotId];
  return s && id ? s.options.find((o) => o.id === id) : undefined;
}

function merge(list: ComponentSelection[], add: ComponentSelection[]) {
  for (const a of add) {
    if (!COMPONENT_MAP[a.id]) continue;
    const cur = list.find((x) => x.id === a.id);
    if (cur) cur.qty = Math.min(COMPONENT_MAP[a.id].maxQty, cur.qty + a.qty);
    else list.push({ ...a });
  }
}

/** Rebuild the hardware of `d` from its preset choices. Non-preset designs are returned unchanged. */
export function composeDesign(d: MissionDesign): MissionDesign {
  const p = presetsFor(d.objectiveId, d.difficulty);
  if (!p) return d;
  const set = p.set;
  const presets = { ...(d.presets ?? {}) };
  const components: ComponentSelection[] = [];
  merge(components, set.base);
  const n: MissionDesign = { ...d, presets, busId: set.busIds[0], fleetSize: 1, orbit: { ...set.defaultOrbit }, groundNetworkId: set.groundNetworkId, contactHoursPerDay: set.contactHoursPerDay };
  let lvChosen: string | undefined;
  for (const slot of set.slots) {
    const o = chosenOption(set, slot.id, presets);
    if (!o) continue;
    if (o.components) merge(components, o.components);
    if (o.orbit) n.orbit = { ...o.orbit };
    if (o.groundNetworkId) n.groundNetworkId = o.groundNetworkId;
    if (o.contactHoursPerDay) n.contactHoursPerDay = o.contactHoursPerDay;
    if (o.launchVehicleId) lvChosen = o.launchVehicleId;
  }
  n.components = components;
  n.busId = pickBus(set.busIds, components);
  if (lvChosen && LV_MAP[lvChosen]) n.launchVehicleId = lvChosen;
  else if (set.slots.some((s) => s.id === 'rocket')) n.launchVehicleId = set.autoRockets[0] ?? d.launchVehicleId;
  else n.launchVehicleId = autoRocket(n, set.autoRockets);
  return n;
}

/** First bus in the list that can carry the parts (structure rating and size class). */
export function pickBus(ids: string[], comps: ComponentSelection[]): string {
  const rank = { cube: 0, small: 1, mid: 2, large: 3 } as const;
  const kg = comps.reduce((a, s) => a + (COMPONENT_MAP[s.id]?.mass_kg ?? 0) * s.qty, 0);
  for (const id of ids) {
    const b = COMPONENT_MAP[id];
    if (!b) continue;
    const cls = rank[b.specs.busClass ?? 'small'];
    const fits = comps.every((s) => { const c = COMPONENT_MAP[s.id]; return !c || (rank[c.minBus] <= cls && cls <= rank[c.maxBus]); });
    if (fits && kg <= (b.specs.payloadCapacityKg ?? 0)) return id;
  }
  return ids[ids.length - 1];
}

/** Cheapest rocket (in list order) that lifts the design with ≥5% margin; else the biggest. */
export function autoRocket(d: MissionDesign, order: string[]): string {
  let best = order[order.length - 1] ?? d.launchVehicleId;
  for (const id of order) {
    if (!LV_MAP[id]) continue;
    const r = computeResources({ ...d, launchVehicleId: id });
    const cap = r.mass.lvCapacityKg;
    const fairOk = !r.compatibility.blockers.some((b) => /fairing/i.test(b));
    if (cap > 0 && r.mass.launchMassKg <= cap * 0.95 && fairOk) { best = id; break; }
  }
  return best;
}

/** True when every slot of an Easy/Medium mission has a choice. */
export function presetsComplete(d: MissionDesign): boolean {
  const p = presetsFor(d.objectiveId, d.difficulty);
  if (!p) return true;
  return p.set.slots.every((s) => !!d.presets?.[s.id]);
}
