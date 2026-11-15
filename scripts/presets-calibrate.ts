// Enumerates every Easy/Medium preset combination and reports how many fly.
// `npx tsx scripts/presets-calibrate.ts [missionId]`
import { EASY_PRESETS, MEDIUM_PRESETS, type MissionPresetSet } from '../shared/data/missionPresets';
import { OBJECTIVE_MAP } from '../shared/data/mission';
import { computeResources, fmt } from '../shared/engine/physics';
import { composeDesign } from '../shared/engine/presets';
import { freshDesign } from '../shared/room';

const only = process.argv[2];
const verbose = process.argv.includes('-v');

function run(id: string, set: MissionPresetSet) {
  const base = freshDesign(id, 'TEST01');
  const slots = set.slots;
  const total = slots.reduce((a, s) => a * s.options.length, 1);
  const stats: { key: string; ok: boolean; est: number; cost: number; sci: number; worst: string; block: string }[] = [];
  const optOk: Record<string, number> = {};
  const idx = slots.map(() => 0);
  for (let n = 0; n < total; n++) {
    const presets: Record<string, string> = {};
    slots.forEach((s, i) => (presets[s.id] = s.options[idx[i]].id));
    const d = composeDesign({ ...base, presets });
    const r = computeResources(d);
    const bad = Object.values(r.pillars).filter((p) => p.status === 'crit').map((p) => p.key);
    const ok = r.compatibility.blockers.length === 0 && r.estimatedSuccess >= 0.55;
    const key = slots.map((s, i) => `${s.id[0]}${idx[i] + 1}`).join('');
    stats.push({ key, ok, est: r.estimatedSuccess, cost: r.cost.total / r.cost.cap, sci: r.science.total / r.science.baseline, worst: bad.join(','), block: r.compatibility.blockers[0] ?? '' });
    if (ok) slots.forEach((s, i) => (optOk[`${s.id}:${s.options[idx[i]].id}`] = (optOk[`${s.id}:${s.options[idx[i]].id}`] ?? 0) + 1));
    for (let i = slots.length - 1; i >= 0; i--) { idx[i]++; if (idx[i] < slots[i].options.length) break; idx[i] = 0; }
  }
  const okN = stats.filter((s) => s.ok).length;
  console.log(`\n### ${id} (${OBJECTIVE_MAP[id].difficulty}) — ${okN}/${total} combos fly (${fmt((100 * okN) / total, 0)}%)`);
  const show = (label: string, pick: (s: { options: { id: string }[] }) => string) => {
    const presets: Record<string, string> = {};
    slots.forEach((s) => (presets[s.id] = pick(s)));
    const d = composeDesign({ ...base, presets });
    const r = computeResources(d);
    console.log(`  ${label.padEnd(9)} est ${fmt(r.estimatedSuccess * 100, 0).padStart(3)}%  $${fmt(r.cost.total, 0)}/${fmt(r.cost.cap, 0)}M  sci ${fmt(r.science.total, 0)}/${fmt(r.science.baseline, 0)}  mass ${fmt(r.mass.launchMassKg, 0)}/${fmt(r.mass.lvCapacityKg, 0)} ${d.launchVehicleId}  ` +
      Object.values(r.pillars).map((p) => `${p.key[0].toUpperCase()}:${p.status}`).join(' ') + (r.compatibility.blockers[0] ? `  ✗ ${r.compatibility.blockers[0].slice(0, 90)}` : ''));
  };
  show('all-low', (s) => s.options[0].id);
  show('all-mid', (s) => s.options[Math.min(1, s.options.length - 1)].id);
  show('all-high', (s) => s.options[s.options.length - 1].id);
  for (const s of slots) console.log(`  ${s.id.padEnd(10)} ` + s.options.map((o) => `${o.id}:${fmt((100 * (optOk[`${s.id}:${o.id}`] ?? 0)) / Math.max(1, okN), 0)}%`).join('  '));
  const blockers: Record<string, number> = {};
  for (const s of stats) if (s.block) blockers[s.block.replace(/[\d,.]+/g, '#')] = (blockers[s.block.replace(/[\d,.]+/g, '#')] ?? 0) + 1;
  console.log('  top blockers: ' + Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${v}× ${k.slice(0, 80)}`).join(' | '));
  if (verbose) for (const s of stats.filter((x) => x.ok).sort((a, b) => b.est - a.est).slice(0, 8)) console.log(`   ${s.key} est ${fmt(s.est * 100, 0)} cost ${fmt(s.cost * 100, 0)}% sci ${fmt(s.sci * 100, 0)}%`);
}

for (const [id, set] of Object.entries(EASY_PRESETS)) if (!only || only === id) run(id, set);
for (const [id, set] of Object.entries(MEDIUM_PRESETS)) if (!only || only === id) run(id, set);
