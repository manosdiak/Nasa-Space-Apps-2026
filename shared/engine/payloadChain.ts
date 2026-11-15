// Payload chain: an instrument only works with the right optics and, for
// infrared detectors, enough cooling. Returns a science multiplier per
// instrument plus short, plain-language notes. (Pure: no physics import.)
import { OPTICS_INFO } from '../data/nasaMissions';
import type { Orbit, SpacecraftComponent } from '../types';

interface Item { comp: SpacecraftComponent; qty: number }

export function effectiveColdK(items: Item[], orbit: Orbit | undefined, ltan: string): { k: number; how: string } {
  let best = { k: 250, how: 'no cooling' };
  for (const { comp } of items) {
    if (comp.category !== 'thermal' || !comp.specs.coolsToK) continue;
    let k = comp.specs.coolsToK;
    let how = comp.name;
    if (comp.id === 'th_vgroove') {
      const fam = orbit?.family;
      if (fam === 'L2' || fam === 'L1') { k = 45; how = 'passive radiators at L1/L2'; }
      else if (fam === 'SSO' && ltan === 'dawn-dusk') { k = 75; how = 'passive radiators in a dawn-dusk orbit'; }
      else if (fam === 'ASTEROID' || fam === 'JUPITER') { k = 80; how = 'passive radiators far from the Sun'; }
      else { k = 140; how = 'passive radiators (Sun angle keeps changing)'; }
    }
    if (k < best.k) best = { k, how };
  }
  return best;
}

export function chainEval(items: Item[], orbit: Orbit | undefined, ltan: string) {
  const optics = items.filter((i) => i.comp.category === 'optics');
  const cold = effectiveColdK(items, orbit, ltan);
  const mult: Record<string, number> = {};
  const notes: string[] = [];
  const warnings: string[] = [];
  for (const { comp } of items) {
    if (comp.category !== 'instrument') continue;
    let m = 1;
    if (comp.specs.needsOptics?.length) {
      const match = optics.filter((o) => comp.specs.needsOptics!.includes(o.comp.specs.opticsKind!));
      const names = comp.specs.needsOptics.map((k) => OPTICS_INFO[k]?.name ?? k).join(' or ');
      if (!match.length) { m = 0; warnings.push(`${comp.name} has no ${names} — it collects nothing.`); }
      else { m *= Math.max(...match.map((o) => o.comp.specs.opticsGain ?? 1)); notes.push(`${comp.name} uses the ${match[0].comp.name}.`); }
    }
    if (comp.specs.cryoK && cold.k > comp.specs.cryoK) {
      m *= 0.15;
      warnings.push(`${comp.name} must be colder than ${comp.specs.cryoK} K (now ~${cold.k} K). Add a cryocooler.`);
    }
    mult[comp.id] = m;
  }
  for (const o of optics) {
    const used = items.some((i) => i.comp.category === 'instrument' && i.comp.specs.needsOptics?.includes(o.comp.specs.opticsKind!));
    if (!used) warnings.push(`${o.comp.name} has no instrument that uses it — dead weight.`);
  }
  return { mult, notes, warnings, cold };
}
