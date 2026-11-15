// Runs every mission's NASA baseline (at the mission's own difficulty) through
// the engine and prints the six pillars, blockers and the simulation outcome.
// `npm run test:engine`
import { OBJECTIVE_MAP, REFERENCE_DESIGNS } from '../shared/data/mission';
import { computeResources, fmt } from '../shared/engine/physics';
import { MissionSimulator, runMonteCarlo } from '../shared/engine/simulate';
import type { Difficulty, MissionDesign } from '../shared/types';

export function printDesign(name: string, d: MissionDesign) {
  const r = computeResources(d);
  console.log(`\n=== ${name} (${d.objectiveId}/${d.difficulty}) ===`);
  for (const p of Object.values(r.pillars)) console.log(`  ${p.status.padEnd(4)} ${p.label.padEnd(7)} ${p.summary}${p.bottleneck ? '  [BOTTLENECK]' : ''}`);
  console.log(`  power: sun ${fmt(r.power.loadSunW, 0)}W ecl ${fmt(r.power.loadEclipseW, 0)}W ecl% ${fmt(r.power.eclipseFraction * 100, 1)} DoD ${fmt(r.power.dodActual * 100, 0)}/${fmt(r.power.dodAllowed * 100, 0)}% margin ${fmt(r.power.marginFrac * 100, 0)}%`);
  console.log(`  link: ${r.link.componentName} ${fmt(r.link.rateMbps, 3)} Mbps (${r.link.limitedBy}) margin ${fmt(r.link.marginDb, 1)} dB, ${fmt(r.link.contactMinPerDay, 0)} min/day, ${fmt(r.link.downlinkGbPerDay, 2)} Gb/day; gen ${fmt(r.data.genGbPerDay, 2)} Gb/day`);
  console.log(`  mass: dry ${fmt(r.mass.dryKg, 0)} prop ${fmt(r.mass.propellantKg, 0)}/${fmt(r.mass.propellantCapacityKg, 0)} launch ${fmt(r.mass.launchMassKg, 0)} / cap ${fmt(r.mass.lvCapacityKg, 0)}; dv ${fmt(r.mass.dvTotal, 0)}`);
  console.log(`  time: dev ${fmt(r.time.devMonths, 0)} launch M${fmt(r.time.launchMonth, 0)} / M${r.time.deadlineMonth} life ${fmt(r.time.lifetimeYears, 1)}yr (${r.time.limiter})`);
  console.log(`  science: ${fmt(r.science.perYear, 1)}/yr total ${fmt(r.science.total, 0)} thr ${fmt(r.science.threshold, 0)} base ${fmt(r.science.baseline, 0)} cov ${fmt(r.science.coverageFactor, 2)}`);
  console.log(`  cost: $${fmt(r.cost.total, 0)}M / $${fmt(r.cost.cap, 0)}M   thermal ${fmt(r.thermal.marginFrac * 100, 0)}%  pointing ${r.pointing.achievedDeg}/${r.pointing.requiredDeg}`);
  console.log(`  est success ${fmt(r.estimatedSuccess * 100, 0)}% (sc ${fmt(r.reliability.spacecraft * 100, 0)}%)`);
  if (r.compatibility.blockers.length) console.log('  BLOCKERS:\n   - ' + r.compatibility.blockers.join('\n   - '));
  if (r.compatibility.warnings.length) console.log('  warnings:\n   - ' + r.compatibility.warnings.join('\n   - '));
  return r;
}

const only = process.argv[2];
let fails = 0;
for (const [k, ref] of Object.entries(REFERENCE_DESIGNS)) {
  if (only && only !== k) continue;
  const diff: Difficulty = OBJECTIVE_MAP[k].difficulty;
  const d: MissionDesign = { ...ref, difficulty: diff, scenarioSeed: 'TEST01' };
  const r = printDesign(k, d);
  if (r.compatibility.blockers.length) fails++;
  const t0 = Date.now();
  const sim = new MissionSimulator(d, undefined, { seed: 'run1', autoDecide: true });
  sim.runToEnd();
  const res = sim.result();
  const mc = runMonteCarlo(d, undefined, 100, 'mc');
  console.log(`[SIM ${k}] ${res.outcome} — ${res.endReason} sci ${fmt(res.science, 0)} days ${res.scienceDays} lost ${fmt(res.dataLostGb, 0)}Gb anomalies ${res.anomalies} (${Date.now() - t0} ms)`);
  console.log(`   MC: success ${fmt(mc.success * 100, 0)}% partial ${fmt(mc.partial * 100, 0)}% fail ${fmt(mc.failure * 100, 0)}% meanSci ${fmt(mc.meanScience, 0)}`, JSON.stringify(mc.lossReasons));
  if (mc.success < 0.5) fails++;
}
console.log(fails ? `\n${fails} baseline problem(s)` : '\nAll baselines fly.');
if (fails) process.exitCode = 1;
