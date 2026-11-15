// One-sentence, plain-English tips for the six resource bars.
import type { ResourceKey, ResourceState, Status } from '../../../shared/types';

export const BAR_ICON: Record<ResourceKey, string> = { mass: '⚖️', power: '⚡', budget: '💰', data: '💾', comms: '📡', time: '⏳' };
export const BAR_LABEL: Record<ResourceKey, string> = { mass: 'Mass', power: 'Power', budget: 'Budget', data: 'Data', comms: 'Comms', time: 'Time/Fuel' };
export const BAR_HELP: Record<ResourceKey, string> = {
  mass: 'How heavy your spacecraft + fuel is vs. what the rocket can lift.',
  power: 'Power your panels make vs. what your parts use (shadow included).',
  budget: 'Total cost vs. your grant.',
  data: 'Onboard memory vs. data piling up between radio contacts.',
  comms: 'Data you can send home each day vs. data you collect.',
  time: 'Launch date, fuel and lifetime vs. what the mission needs.',
};

const rank: Record<Status, number> = { ok: 0, warn: 1, crit: 2 };
const worse = (a: Status, b: Status): Status => (rank[a] >= rank[b] ? a : b);

/** Status of the combined Time/Fuel bar. */
export function timeFuel(res: ResourceState): Status {
  let s = res.pillars.time.status;
  if (res.compatibility.blockers.some((b) => /propellant|no propellant tank|propulsion system/i.test(b))) s = 'crit';
  else if (res.compatibility.warnings.some((w) => /tanks hold|run dry/i.test(w))) s = worse(s, 'warn');
  return s;
}

export function barStatus(key: ResourceKey, res: ResourceState): Status {
  if (key === 'time') return timeFuel(res);
  if (key === 'mass' && res.compatibility.blockers.some((b) => /structure is rated|does not fit in the/i.test(b))) return 'crit';
  return res.pillars[key].status;
}

/** The one-sentence tip shown under each bar. */
export function barTip(key: ResourceKey, res: ResourceState): string {
  const s = barStatus(key, res);
  const B = res.compatibility.blockers, W = res.compatibility.warnings;
  switch (key) {
    case 'mass':
      if (B.some((b) => /structure is rated/i.test(b))) return 'Too many heavy parts for this spacecraft frame.';
      if (B.some((b) => /does not fit in the/i.test(b))) return 'Too big for the rocket\'s nose cone — pick a bigger rocket.';
      if (res.mass.lvCapacityKg <= 0) return 'This rocket can\'t reach your orbit — pick another rocket.';
      return s === 'crit' ? 'Too heavy for the rocket! Use lighter parts, less fuel or a bigger rocket.' : s === 'warn' ? 'Close to the rocket\'s limit.' : 'The rocket lifts it with room to spare.';
    case 'power':
      if (B.some((b) => /electric engine needs/i.test(b))) return 'Your electric engine needs more solar power during the cruise.';
      if (B.some((b) => /No power generation/i.test(b))) return 'No power source — add solar panels.';
      if (B.some((b) => /No battery/i.test(b))) return 'No battery — you need one for the shadow side.';
      return s === 'crit' ? 'Not enough power: add panels or batteries, or drop a power-hungry part.' : s === 'warn' ? 'Power is tight — a bit more solar would help.' : 'Plenty of power, even in shadow.';
    case 'budget':
      return s === 'crit' ? 'Over budget — pick cheaper parts or a cheaper rocket.' : s === 'warn' ? 'Almost out of money.' : 'Within budget.';
    case 'data':
      return s === 'crit' ? 'Memory fills up before you can send the data home.' : s === 'warn' ? 'Memory is nearly full between contacts.' : 'Enough memory between radio contacts.';
    case 'comms':
      if (B.some((b) => /No communications/i.test(b))) return 'No radio — you could never hear from it!';
      if (B.some((b) => /cannot track/i.test(b))) return 'Those ground antennas can\'t reach that far — use the Deep Space Network.';
      return s === 'crit' ? 'Radio too slow — data will be lost. Upgrade comms.' : s === 'warn' ? 'The radio barely keeps up.' : 'Your radio sends home everything you collect.';
    case 'time': {
      if (B.some((b) => /no propellant tank/i.test(b))) return 'Your engine has no fuel tank!';
      if (B.some((b) => /not even enough for orbit insertion/i.test(b))) return 'Not enough fuel to brake into orbit — bigger tank or better engine.';
      if (B.some((b) => /requires .* Δv|no propulsion system/i.test(b))) return 'You need an engine to brake into orbit.';
      if (B.some((b) => /high-thrust burn/i.test(b))) return 'This braking burn needs a chemical engine.';
      if (W.some((w) => /run dry/i.test(w))) return 'Fuel runs out before the mission ends.';
      if (W.some((w) => /space junk/i.test(w))) return 'Space-junk rule: add an engine so it can deorbit.';
      if (res.time.lifetimeYears < res.time.plannedOpsYears) return `It won't last the whole mission (limit: ${res.time.limiter.split(' (')[0].toLowerCase()}).`;
      if (res.time.launchMonth > res.time.deadlineMonth) return 'Launch slips past the deadline — parts take too long to build.';
      if (W.some((w) => /no fuel reserve/i.test(w))) return 'Enough fuel, but no reserve for emergencies.';
      return 'On schedule, with enough fuel and lifetime.';
    }
  }
}

/** Value text for the bar. */
export function barValue(key: ResourceKey, res: ResourceState, fmtN: (x: number, d?: number) => string, money: (m: number) => string, sandbox: boolean): string {
  const P = res.pillars;
  switch (key) {
    case 'mass': return `${fmtN(P.mass.used, 0)} / ${fmtN(P.mass.capacity, 0)} kg`;
    case 'power': return `${fmtN(P.power.capacity, 0)} W made · need ${fmtN(P.power.used, 0)}`;
    case 'budget': return sandbox ? money(P.budget.used) : `${money(P.budget.used)} / ${money(P.budget.capacity)}`;
    case 'data': return `${fmtN(res.data.genGbPerDay, 1)} Gb/day`;
    case 'comms': return `${fmtN(res.link.downlinkGbPerDay, 1)} Gb/day sent`;
    case 'time': return res.mass.propellantNeededKg > 0 ? `fuel need ${fmtN(res.mass.propellantNeededKg, 0)} / ${fmtN(res.mass.propellantCapacityKg, 0)} kg` : `launch month ${fmtN(res.time.launchMonth, 0)}`;
  }
}

/** Fill fraction for the bar (≥1 = full/over). */
export function barFill(key: ResourceKey, res: ResourceState): number {
  if (key === 'time') {
    const s = timeFuel(res);
    if (res.mass.propellantCapacityKg > 0 && res.mass.propellantNeededKg > 0) return Math.max(s === 'crit' ? 1.05 : 0, res.mass.propellantNeededKg / res.mass.propellantCapacityKg);
    return s === 'crit' ? 1.1 : s === 'warn' ? 0.9 : Math.min(1, res.time.launchMonth / Math.max(1, res.time.deadlineMonth));
  }
  const u = res.pillars[key].utilization;
  return Number.isFinite(u) ? u : 2;
}
