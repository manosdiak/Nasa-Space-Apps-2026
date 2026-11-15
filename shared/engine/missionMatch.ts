// "Closest real NASA mission": scores your design against real missions by
// target, size, wavelengths, propulsion and power.
import { COMPONENT_MAP } from '../data/components';
import { OBJECTIVE_MAP, ORBIT_MAP } from '../data/mission';
import { FLEET_MISSIONS, type FleetOrbit } from '../data/nasaMissions';
import type { MissionDesign, ResourceState } from '../types';

const ORBIT_TO_FLEET: Record<string, FleetOrbit> = {
  leo: 'LEO', sso: 'SSO', gto: 'GEO', geo: 'GEO', llo: 'LUNAR', l1: 'L1', l2: 'L2', mars: 'MARS', vesta: 'ASTEROID', jupiter: 'JUPITER',
};
const ORBIT_NEAR: Partial<Record<FleetOrbit, FleetOrbit[]>> = { LEO: ['SSO'], SSO: ['LEO'], L1: ['L2'], L2: ['L1'], JUPITER: ['ASTEROID'], LUNAR: ['MARS'], MARS: ['LUNAR', 'ASTEROID'], ASTEROID: ['MARS'] };
const MASS_ORDER = ['cube', 'small', 'mid', 'large', 'flagship'];

export function matchMissions(d: MissionDesign, res: ResourceState) {
  const items = d.components.map((s) => ({ comp: COMPONENT_MAP[s.id], qty: s.qty })).filter((i) => i.comp);
  const disc = OBJECTIVE_MAP[d.objectiveId]?.discipline;
  const orbit = ORBIT_TO_FLEET[d.orbit.id] ?? (ORBIT_MAP[d.orbit.id]?.family as FleetOrbit) ?? 'LEO';
  const wet = res.mass.wetKg;
  const cube = !!COMPONENT_MAP[d.busId]?.specs.cubeU;
  const massClass = cube ? 'cube' : wet < 350 ? 'small' : wet < 2200 ? 'mid' : wet < 5000 ? 'large' : 'flagship';
  const bands = new Set(items.filter((i) => i.comp.category === 'instrument').map((i) => i.comp.specs.wavelength!));
  const N = Math.max(1, d.fleetSize);
  const engines = items.filter((i) => i.comp.category === 'propulsion' && !i.comp.specs.tankOnly);
  const prop = engines.some((i) => i.comp.specs.chemical === false) ? 'electric' : engines.length ? 'chemical' : 'none';
  const power = items.some((i) => i.comp.specs.source === 'rtg') ? 'rtg' : 'solar';
  const bucket = (n: number) => (n === 1 ? 0 : n < 10 ? 1 : 2);
  const MAX = 2 + 3 + 1.5 + 3 + 1 + 1 + 0.7;
  return FLEET_MISSIONS.map((m) => {
    let s = 0;
    const why: string[] = [];
    if (m.discipline === disc) s += 2;
    if (m.orbit === orbit) { s += 3; why.push(`same target (${orbit.toLowerCase()})`); } else if (ORBIT_NEAR[orbit]?.includes(m.orbit)) s += 1.2;
    const dm = Math.abs(MASS_ORDER.indexOf(m.massClass) - MASS_ORDER.indexOf(massClass));
    if (dm === 0) { s += 1.5; why.push(`${massClass} size`); } else if (dm === 1) s += 0.7;
    const inter = m.bands.filter((b) => bands.has(b)).length;
    const uni = new Set([...m.bands, ...bands]).size || 1;
    if (inter) { s += 3 * (inter / uni); why.push(`${m.bands.filter((b) => bands.has(b)).join(' + ')} sensors`); }
    if (bucket(m.fleet) === bucket(N)) s += 1;
    if (m.propulsion === prop) { s += 1; if (prop === 'electric') why.push('electric engines'); }
    if (m.power === power) { s += 0.7; if (power === 'rtg') why.push('nuclear power'); }
    return { id: m.id, name: m.name, similarity: Math.min(1, s / MAX), why, lore: m.lore, status: `${m.status} · ${m.year}` };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
