// ─────────────────────────────────────────────────────────────────────────────
// Deterministic physics & trade-off engine.
// computeResources(design) → every budget (mass, power, cost, data, comms, time),
// the launch compatibility verdict, plain-language explanations and bottlenecks.
// All functions are pure: same design in → same numbers out (client, server, sim).
// ─────────────────────────────────────────────────────────────────────────────
import { COMPONENT_MAP, busRank } from '../data/components';
import { CAPACITY_REF_ALT, DIFFICULTY_MAP, GN_MAP, LV_MAP, OBJECTIVE_MAP, ORBIT_MAP, ROLE_MAP, RESOURCE_OWNER } from '../data/mission';
import type {
  Band, ComponentSelection, CostBudget, DataBudget, DesignModifiers, Explanation, GroundNetwork, LinkBudget, MassBudget,
  MissionDesign, Orbit, PillarState, PowerBudget, ResourceKey, ResourceState, ScienceEstimate, SpacecraftComponent, Status, TimeBudget,
} from '../types';
import { chainEval } from './payloadChain';

// ── Constants ────────────────────────────────────────────────────────────────
export const RE = 6371;               // km
export const MU_E = 398600.4418;      // km³/s²
export const RM = 1737.4;             // km
export const MU_M = 4902.8;           // km³/s²
export const C_KMS = 299792.458;      // km/s
export const BOLTZMANN_DB = -228.6;   // dBW/K/Hz
export const G0 = 9.80665;            // m/s²
export const AU_KM = 1.496e8;
export const SEC_PER_YEAR = 3.156e7;
export const X_E = 0.65;              // eclipse power-path efficiency (SMAD, direct energy transfer)
export const X_D = 0.85;              // daylight power-path efficiency
export const BATTERY_EFF = 0.9;
export const LINK_EFF = 0.9;          // framing / protocol overhead
export const REQ_EBN0_DB = 2.5;       // turbo-coded BPSK/QPSK at BER 1e-6 incl. implementation loss
export const ELEVATION_MASK_DEG = 10;

export const NO_MODS: DesignModifiers = { budgetCapMult: 1, deadlineShiftMonths: 0, costOverrun: {}, extraLeadMonths: {}, launchDelayMonths: 0 };

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const log10 = Math.log10;
export const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '∞');

// ── Orbital mechanics ────────────────────────────────────────────────────────
export function centralBody(o: Orbit) {
  if (o.central === 'moon') return { R: RM, mu: MU_M };
  if (o.central === 'mars') return { R: 3389.5, mu: 42828 };
  if (o.central === 'vesta') return { R: 263, mu: 17.29 };
  return { R: RE, mu: MU_E };
}

/** Orbital period in seconds for a circular orbit at altitude h (km). */
export function periodS(h: number, R = RE, mu = MU_E) {
  const a = R + h;
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/** Fraction of each orbit spent in eclipse for a circular orbit with sun-beta angle β (cylindrical shadow). */
export function eclipseFraction(h: number, betaDeg: number, R = RE): number {
  const a = R + h;
  const betaStar = Math.asin(R / a);
  const b = rad(Math.abs(betaDeg));
  if (b >= betaStar) return 0;
  const x = Math.sqrt(h * h + 2 * R * h) / (a * Math.cos(b));
  if (x >= 1) return 0;
  return Math.acos(x) / Math.PI;
}

/** Earth-central half-angle of a ground station's visibility cone (deg) for elevation mask ε. */
export function stationHalfAngleDeg(h: number, maskDeg = ELEVATION_MASK_DEG, R = RE) {
  const e = rad(maskDeg);
  return deg(Math.acos((R * Math.cos(e)) / (R + h))) - maskDeg;
}

/** Slant range (km) to a satellite at altitude h seen at elevation ε. */
export function slantRangeKm(h: number, elevDeg: number, R = RE) {
  const e = rad(elevDeg);
  return Math.sqrt((R + h) ** 2 - (R * Math.cos(e)) ** 2) - R * Math.sin(e);
}

// Atmosphere: piecewise-exponential density (Vallado, moderate solar activity). [h0 km, ρ0 kg/m³, H km]
const ATM: [number, number, number][] = [
  [150, 2.07e-9, 22.523], [180, 5.464e-10, 29.74], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298], [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
  [700, 3.614e-14, 88.667], [800, 1.17e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268],
];
export function atmosphereDensity(h: number): number {
  if (h > 1500) return 0;
  let row = ATM[0];
  for (const r of ATM) if (h >= r[0]) row = r;
  return row[1] * Math.exp(-(h - row[0]) / row[2]);
}

/** Drag deceleration (m/s²) for ballistic coefficient B = Cd·A/m (m²/kg). */
export function dragAccel(h: number, B: number, densityMult = 1) {
  const v = Math.sqrt(MU_E / (RE + h)) * 1000; // m/s
  return 0.5 * atmosphereDensity(h) * densityMult * v * v * B;
}

/** Rate of altitude loss (km/day) from drag: da/dt = −√(μa)·ρ·B. */
export function decayRateKmPerDay(h: number, B: number, densityMult = 1) {
  const a = (RE + h) * 1000;
  const mu = MU_E * 1e9;
  return (Math.sqrt(mu * a) * atmosphereDensity(h) * densityMult * B * 86400) / 1000;
}

/** Natural orbital lifetime (years) until re-entry at ~180 km — numerically integrated. */
export function decayLifetimeYears(h0: number, B: number, densityMult = 1): number {
  if (h0 > 1400) return Infinity;
  let h = h0, t = 0;
  while (h > 180 && t < 400 * 365) {
    const r = decayRateKmPerDay(h, B, densityMult);
    const step = r > 0 ? clamp(0.5 / r, 0.05, 365) : 365; // aim for ≈0.5 km per step
    h -= r * step;
    t += step;
  }
  return t / 365;
}

/** Ionizing dose rate behind 2.5 mm Al (krad/yr). LEO/SSO depend strongly on altitude (inner belt / SAA). */
const LEO_DOSE: [number, number][] = [[300, 0.05], [400, 0.1], [500, 0.25], [600, 0.5], [700, 0.9], [800, 1.6], [1000, 3.5], [1200, 7]];
export function doseRateKradPerYear(o: Orbit, h: number): number {
  if (o.radiationKradPerYear !== undefined) return o.radiationKradPerYear;
  const t = LEO_DOSE;
  if (h <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (h <= t[i][0]) {
      const [h0, d0] = t[i - 1], [h1, d1] = t[i];
      const f = (h - h0) / (h1 - h0);
      return d0 * Math.pow(d1 / d0, f);
    }
  }
  return t[t.length - 1][1] * (o.family === 'SSO' ? 1.2 : 1);
}

/** Tsiolkovsky: propellant mass for Δv (m/s) with dry mass m (kg) and Isp (s). */
export function propellantFor(dv: number, mDry: number, isp: number) {
  if (dv <= 0) return 0;
  return mDry * (Math.exp(dv / (isp * G0)) - 1);
}
/** Inverse Tsiolkovsky: Δv (m/s) available from mp of propellant. */
export function dvFrom(mp: number, mDry: number, isp: number) {
  if (mp <= 0 || mDry <= 0) return 0;
  return isp * G0 * Math.log((mDry + mp) / mDry);
}

// ── RF / optical link budget ─────────────────────────────────────────────────
export function bandFrequencyHz(band: Band, rangeKm: number): number {
  switch (band) {
    case 'UHF': return 437e6;
    case 'S': return 2.25e9;
    case 'X': return 8.42e9;
    case 'Ka': return rangeKm > 2e6 ? 32e9 : 26e9;
    default: return 2.8e14;
  }
}
export function dishGainDbi(diameterM: number, fHz: number, eff = 0.55) {
  const lambda = 299792458 / fHz;
  return 10 * log10(eff * Math.pow((Math.PI * diameterM) / lambda, 2));
}
export function beamwidthDeg(gainDbi: number) {
  return Math.min(180, Math.sqrt(27000 / Math.pow(10, gainDbi / 10)));
}
export function freeSpaceLossDb(rangeKm: number, fHz: number) {
  return 20 * log10((4 * Math.PI * rangeKm * 1000 * fHz) / 299792458);
}
export function pointingLossDb(errorDeg: number, beamDeg: number) {
  return Math.min(30, 12 * Math.pow(errorDeg / beamDeg, 2));
}
const ATM_LOSS: Record<Band, number> = { UHF: 3.5, S: 0.3, X: 0.5, Ka: 2.5, optical: 0 };

export interface LinkCalc {
  band: Band; eirpDbw: number; gtDbK: number; pathLossDb: number; pointingLossDb: number; otherLossDb: number;
  cn0DbHz: number; physRateMbps: number; rateMbps: number; marginDb: number; beamDeg: number; limitedBy: 'physics' | 'modem';
}

/** Achievable downlink rate for one radio/terminal to one ground network at a given range. */
export function computeLink(comp: SpacecraftComponent, gn: GroundNetwork, rangeKm: number, pointingErrDeg: number, reqMarginDb: number): LinkCalc | null {
  const s = comp.specs;
  const band = s.band!;
  if (band === 'optical') {
    if (gn.gtByBand.optical === undefined) return null;
    const beam = s.pointingReqDeg ?? 0.05;
    let phys = (s.opticalRefRateMbps ?? 100) * Math.pow((s.opticalRefDistKm ?? 4e5) / Math.max(rangeKm, 1), 2);
    if (pointingErrDeg > beam) phys *= Math.pow(beam / pointingErrDeg, 4);
    const rate = Math.min(phys, s.maxRateMbps ?? phys);
    return { band, eirpDbw: 10 * log10(s.txPowerW ?? 1), gtDbK: 0, pathLossDb: 0, pointingLossDb: pointingErrDeg > beam ? 40 * log10(pointingErrDeg / beam) : 0,
      otherLossDb: 0, cn0DbHz: 0, physRateMbps: phys, rateMbps: rate, marginDb: 10 * log10(Math.max(phys, 1e-9) / Math.max(rate, 1e-9)) + reqMarginDb,
      beamDeg: beam, limitedBy: phys > rate ? 'modem' : 'physics' };
  }
  const gt = gn.gtByBand[band];
  if (gt === undefined) return null;
  const f = bandFrequencyHz(band, rangeKm);
  const gain = s.dishDiameterM ? dishGainDbi(s.dishDiameterM, f) : (s.antennaGainDbi ?? 0);
  const beam = beamwidthDeg(gain);
  const lineLoss = 1;
  const eirp = 10 * log10(s.txPowerW ?? 1) + gain - lineLoss;
  const lfs = freeSpaceLossDb(rangeKm, f);
  const lp = pointingLossDb(pointingErrDeg, beam);
  const other = ATM_LOSS[band];
  const cn0 = eirp + gt - lfs - lp - other - BOLTZMANN_DB;
  const physBps = Math.pow(10, (cn0 - REQ_EBN0_DB - reqMarginDb) / 10);
  const phys = physBps / 1e6;
  const rate = Math.min(phys, s.maxRateMbps ?? phys);
  const margin = cn0 - 10 * log10(Math.max(rate * 1e6, 1)) - REQ_EBN0_DB;
  return { band, eirpDbw: eirp, gtDbK: gt, pathLossDb: lfs, pointingLossDb: lp, otherLossDb: other + lineLoss, cn0DbHz: cn0,
    physRateMbps: phys, rateMbps: rate, marginDb: margin, beamDeg: beam, limitedBy: phys > rate ? 'modem' : 'physics' };
}

// ── Helpers on the design ───────────────────────────────────────────────────
export interface Expanded { comp: SpacecraftComponent; qty: number }
export function expand(design: MissionDesign): { bus: SpacecraftComponent; items: Expanded[] } {
  const bus = COMPONENT_MAP[design.busId] ?? COMPONENT_MAP['bus_espa'];
  const items: Expanded[] = [];
  for (const s of design.components) {
    const comp = COMPONENT_MAP[s.id];
    if (comp && s.qty > 0) items.push({ comp, qty: s.qty });
  }
  return { bus, items };
}
const sumQty = (items: Expanded[], pred: (c: SpacecraftComponent) => boolean) => items.filter((i) => pred(i.comp)).reduce((a, i) => a + i.qty, 0);

export function orbitAltitude(design: MissionDesign): number {
  const o = ORBIT_MAP[design.orbit.id];
  if (!o) return 500;
  if (o.altitudeRangeKm) return clamp(design.orbit.altitudeKm || o.defaultAltitudeKm, o.altitudeRangeKm[0], o.altitudeRangeKm[1]);
  return o.defaultAltitudeKm;
}

/** Typical Earth range used for link sizing (worst case for deep space). */
export function linkRangeKm(o: Orbit, h: number, worst = true): number {
  if (o.contactMode === 'passes') return slantRangeKm(h, 20);
  if (o.family === 'GEO') return 37500;
  if (o.earthDistanceKm) return worst ? o.earthDistanceKm[1] : (o.earthDistanceKm[0] + o.earthDistanceKm[1]) / 2;
  return h;
}

export interface OrbitGeometry {
  periodMin: number; orbitsPerDay: number; eclipseFrac: number; cyclesPerYear: number; sunAU: number;
  passesPerDay: number; passMin: number; contactMinPerDay: number; maxGapHours: number; rangeKm: number; rangeKmMean: number;
}

export function orbitGeometry(design: MissionDesign, gn: GroundNetwork | undefined): OrbitGeometry {
  const o = ORBIT_MAP[design.orbit.id];
  const h = orbitAltitude(design);
  const { R, mu } = centralBody(o);
  let periodMin: number, ecl: number, cycles: number;
  if (o.family === 'GTO') { periodMin = 630; ecl = 0.06; cycles = 830; }
  else if (o.family === 'L1' || o.family === 'L2' || o.family === 'JUPITER') { periodMin = 0; ecl = 0; cycles = 0; }
  else {
    periodMin = periodS(h, R, mu) / 60;
    const beta = o.family === 'SSO' && design.orbit.ltan === 'dawn-dusk' ? 75 : o.betaDeg;
    ecl = eclipseFraction(h, beta, R);
    cycles = o.family === 'GEO' ? 90 : ecl > 0 ? (1440 / periodMin) * 365 : 0;
  }
  const orbitsPerDay = periodMin > 0 ? 1440 / periodMin : 0;
  const rangeKm = linkRangeKm(o, h, o.contactMode === 'passes');
  const rangeKmMean = linkRangeKm(o, h, false);
  let passesPerDay = 0, passMin = 0, contactMin = 0, maxGapHours = 24;
  const inRange = gn && rangeKm <= gn.maxRangeKm && rangeKmMean >= gn.minRangeKm;
  if (gn && inRange) {
    if (o.contactMode === 'passes') {
      const lam = stationHalfAngleDeg(h);
      const maxPassMin = ((2 * lam) / 360) * periodMin;
      passMin = 0.7 * maxPassMin;
      const polarCount = gn.polarStations ? 2 : 0;
      const midCount = gn.stations - polarCount;
      const polarOrbit = o.inclinationDeg > 80;
      const perStationFactor = polarCount * (polarOrbit ? 3 : 0.3) + midCount * (polarOrbit ? 0.8 : 1.2);
      passesPerDay = Math.min(orbitsPerDay * gn.stations, orbitsPerDay * ((2 * lam) / 180) * perStationFactor);
      contactMin = passesPerDay * passMin;
      const capMin = clamp(design.contactHoursPerDay, 0.25, 24) * 60;
      if (contactMin > capMin) { passesPerDay *= capMin / contactMin; contactMin = capMin; }
      maxGapHours = passesPerDay > 0 ? Math.min(14, (24 / passesPerDay) * 3) : 24;
    } else {
      const hours = clamp(design.contactHoursPerDay, 0, Math.min(24, gn.maxHoursPerDay));
      contactMin = hours * 60 * o.visibilityFraction;
      passesPerDay = hours > 0 ? Math.max(1, Math.round(hours / 8)) : 0;
      passMin = passesPerDay ? contactMin / passesPerDay : 0;
      maxGapHours = hours >= 23.5 ? 24 * (1 - o.visibilityFraction) + 0.5 : 24 - hours * o.visibilityFraction;
    }
    contactMin *= gn.weatherAvailability;
  }
  return { periodMin, orbitsPerDay, eclipseFrac: ecl, cyclesPerYear: cycles, sunAU: o.distanceFromSunAU, passesPerDay, passMin,
    contactMinPerDay: contactMin, maxGapHours, rangeKm, rangeKmMean };
}

/** Achieved pointing accuracy (deg) from the ADCS suite. */
export function pointingAccuracy(items: Expanded[], scMassKg: number): { deg: number; driver: string; wheels: number; hasIntegrated: boolean; hasST: boolean } {
  const wheels = sumQty(items, (c) => c.specs.adcsType === 'wheel');
  const integ = items.some((i) => i.comp.specs.adcsType === 'integrated');
  const st = items.filter((i) => i.comp.specs.adcsType === 'startracker');
  const stBest = st.length ? Math.min(...st.map((i) => i.comp.specs.pointingDeg ?? 0.05)) : null;
  let d = 5, driver = 'No attitude control: spin-stabilized only (~5°)';
  if (integ) { d = 0.5; driver = 'CubeSat ADCS unit (~0.5°)'; }
  if (wheels >= 3) { d = 0.1; driver = `${wheels} reaction wheels with sun sensors (~0.1°)`; }
  if (stBest !== null && (wheels >= 3 || integ)) { d = Math.max(stBest, wheels >= 3 ? 0.01 : 0.05); driver = `${wheels >= 3 ? 'Wheels' : 'ADCS unit'} + star tracker (~${d}°)`; }
  const maxKg = Math.max(0, ...items.filter((i) => i.comp.specs.maxSpacecraftKg).map((i) => i.comp.specs.maxSpacecraftKg!));
  if ((wheels >= 3 || integ) && maxKg > 0 && scMassKg > maxKg) { d *= 5; driver += ` — but wheels too small for ${fmt(scMassKg, 0)} kg (×5 worse)`; }
  return { deg: d, driver, wheels, hasIntegrated: integ, hasST: st.length > 0 };
}

const BASIC_ALWAYS_ON = new Set(['bus', 'computer', 'adcs', 'thermal']);

// ── The main entry point ─────────────────────────────────────────────────────
export function computeResources(design: MissionDesign, mods: DesignModifiers = NO_MODS): ResourceState {
  const obj = OBJECTIVE_MAP[design.objectiveId] ?? OBJECTIVE_MAP['sandbox'];
  const diff = DIFFICULTY_MAP[design.difficulty] ?? DIFFICULTY_MAP['engineer'];
  const orbit = ORBIT_MAP[design.orbit.id] ?? ORBIT_MAP['sso'];
  const lv = LV_MAP[design.launchVehicleId] ?? LV_MAP['lv_f9'];
  const gn = GN_MAP[design.groundNetworkId] ?? GN_MAP['gs_comm'];
  const { bus, items } = expand(design);
  const N = clamp(Math.round(design.fleetSize || 1), 1, 24);
  const h = orbitAltitude(design);
  const years = Math.max(0.25, design.missionYears);
  const totalYears = orbit.cruiseYears + years;
  const busClass = bus.specs.busClass!;
  const explanations: Explanation[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const hasMLI = items.some((i) => i.comp.id === 'th_mli');

  // ── Fit checks ──
  for (const { comp } of items) {
    if (busRank(busClass) < busRank(comp.minBus)) blockers.push(`${comp.name} is too large for a ${bus.name}.`);
    else if (busRank(busClass) > busRank(comp.maxBus)) blockers.push(`${comp.name} is CubeSat/smallsat hardware that doesn't scale to a ${bus.name}.`);
  }
  for (const s of design.components) {
    const c = COMPONENT_MAP[s.id];
    if (c && s.qty > c.maxQty) blockers.push(`At most ${c.maxQty}× ${c.name}.`);
  }

  const geo = orbitGeometry(design, gn);

  // ── Dry mass (needed early for pointing / drag) ──
  const componentsKg = items.reduce((a, i) => a + i.comp.mass_kg * i.qty, 0);
  const harness = 0.03 * (bus.mass_kg + componentsKg);
  const dryKg = bus.mass_kg + componentsKg + harness;
  const contingencyKg = dryKg * diff.massContingency;
  const dryWithCont = dryKg + contingencyKg;

  // ── Pointing ──
  const pt = pointingAccuracy(items, dryWithCont);
  const pointingReqs: { deg: number; who: string }[] = [];
  for (const { comp } of items) {
    if (comp.category === 'instrument' && comp.specs.pointingReqDeg) pointingReqs.push({ deg: comp.specs.pointingReqDeg, who: comp.name });
    if (comp.category === 'comms') {
      if (comp.specs.band === 'optical') pointingReqs.push({ deg: comp.specs.pointingReqDeg ?? 0.05, who: comp.name });
      else if (comp.specs.dishDiameterM) {
        const g = dishGainDbi(comp.specs.dishDiameterM, bandFrequencyHz(comp.specs.band!, geo.rangeKm));
        pointingReqs.push({ deg: +(beamwidthDeg(g) / 4).toFixed(3), who: comp.name });
      }
    }
  }
  const req = pointingReqs.length ? pointingReqs.reduce((a, b) => (b.deg < a.deg ? b : a)) : { deg: 5, who: 'nothing demanding' };
  const pointing = { achievedDeg: pt.deg, requiredDeg: req.deg, driver: `${pt.driver}. Tightest requirement: ${req.who} (${req.deg}°).`, ok: pt.deg <= req.deg + 1e-9 };
  if (!pointing.ok) explanations.push({ pillar: 'science', severity: 'warn', text: `Pointing: ${req.who} needs ${req.deg}° but your ADCS achieves only ${pt.deg}°. Add reaction wheels and/or a star tracker. Off-pointing costs science and link margin.` });

  // ── Communications ──
  const commsItems = items.filter((i) => i.comp.category === 'comms');
  let best: { comp: SpacecraftComponent; calc: LinkCalc } | null = null;
  for (const { comp } of commsItems) {
    const calc = computeLink(comp, gn, geo.rangeKm, pt.deg, diff.linkMarginDb);
    if (!calc) continue;
    if (!best || calc.rateMbps > best.calc.rateMbps) best = { comp, calc };
  }
  const rfCount = commsItems.filter((i) => i.comp.specs.band !== 'optical').reduce((a, i) => a + i.qty, 0);
  const inRange = geo.rangeKm <= gn.maxRangeKm && geo.rangeKmMean >= gn.minRangeKm;
  const rateMbps = best ? best.calc.rateMbps : 0;
  const downlinkGbPerDay = (rateMbps * geo.contactMinPerDay * 60 * LINK_EFF) / 1000;
  const link: LinkBudget = {
    band: best ? best.calc.band : 'none', componentName: best ? best.comp.name : '—', rangeKm: geo.rangeKm,
    eirpDbw: best?.calc.eirpDbw ?? 0, gtDbK: best?.calc.gtDbK ?? 0, pathLossDb: best?.calc.pathLossDb ?? 0, pointingLossDb: best?.calc.pointingLossDb ?? 0,
    otherLossDb: best?.calc.otherLossDb ?? 0, cn0DbHz: best?.calc.cn0DbHz ?? 0, requiredEbN0Db: REQ_EBN0_DB + diff.linkMarginDb,
    marginDb: best?.calc.marginDb ?? 0, linkRateMbps: best?.calc.physRateMbps ?? 0, rateMbps, limitedBy: best?.calc.limitedBy ?? 'physics',
    contactMinPerDay: geo.contactMinPerDay, passesPerDay: geo.passesPerDay, passMinutes: geo.passMin, downlinkGbPerDay,
    latencyS: geo.rangeKm / C_KMS, beamwidthDeg: best?.calc.beamDeg ?? 0,
  };
  if (!commsItems.length) blockers.push('No communications system — the spacecraft could never be commanded or return data.');
  else if (!inRange) blockers.push(`${gn.name} cannot track a spacecraft at ${fmt(geo.rangeKmMean, 0)} km (supports ${fmt(gn.minRangeKm, 0)}–${fmt(gn.maxRangeKm, 0)} km).`);
  else if (!best) blockers.push(`None of your radios/terminals use a band that ${gn.name} can receive (${Object.keys(gn.gtByBand).join(', ')}).`);
  if (commsItems.length && rfCount === 0) (diff.id === 'director' ? blockers : warnings).push('Optical-only spacecraft: you need an RF radio for commanding and safe-mode recovery when clouds or pointing errors break the laser link.');

  // ── Instruments & data ──
  const instruments = items.filter((i) => i.comp.category === 'instrument');
  const compression = Math.max(1, ...items.filter((i) => i.comp.specs.compression).map((i) => i.comp.specs.compression!));
  const storageGb = items.reduce((a, i) => a + (i.comp.specs.storageGb ?? 0) * i.qty, 0);
  const daylightScale = clamp((1 - geo.eclipseFrac) / 0.62, 0.3, 1.4);
  const targetDuty = (kind: string | undefined) => (obj.targetDutyFamilies?.includes(kind as never) && orbit.family === 'JUPITER' ? 0.002 : 1);
  const effDuty = (c: SpacecraftComponent) => clamp((c.specs.dutyCycle ?? 1) * (c.specs.needsDaylight ? daylightScale : 1) * targetDuty(c.specs.kind), 0, 1);
  // Deep-space orbiters record only a few targeted observations per day (data budget; science is unaffected)
  const dataDuty = (c: SpacecraftComponent) => effDuty(c) * (c.data_rate_mbps > 0.5 ? orbit.dataDuty ?? 1 : 1);
  const perInstrument = instruments.map(({ comp, qty }) => ({ name: comp.name, gbPerDay: (comp.data_rate_mbps * dataDuty(comp) * 86400 * qty) / 1000 / compression }));
  const rawGb = instruments.reduce((a, { comp, qty }) => a + (comp.data_rate_mbps * dataDuty(comp) * 86400 * qty) / 1000, 0);
  const genGb = rawGb / compression;
  const net = genGb - downlinkGbPerDay;
  const bufferDays = net > 0 ? storageGb / net : Infinity;
  const returnFraction = genGb > 0 ? clamp(downlinkGbPerDay / genGb, 0, 1) : 1;
  const data: DataBudget = { genGbPerDay: genGb, rawGbPerDay: rawGb, compression, storageGb, downlinkGbPerDay, bufferDays,
    overflowDay: Number.isFinite(bufferDays) ? Math.max(1, Math.ceil(bufferDays)) : null, returnFraction, perInstrument };
  const storageNeeded = genGb * (geo.maxGapHours / 24) * 2;

  // ── Power ──
  const solarUnits = items.filter((i) => i.comp.category === 'power' && i.comp.specs.source === 'solar');
  const rtgUnits = items.filter((i) => i.comp.category === 'power' && i.comp.specs.source === 'rtg');
  const cosFactor = (c: SpacecraftComponent) => c.specs.cosFactor ?? (c.id === 'pwr_body' ? 0.35 : c.id === 'pwr_cubewing' ? 0.75 : 0.95);
  const r = orbit.distanceFromSunAU;
  const flux = 1 / (r * r);
  const doseRate = doseRateKradPerYear(orbit, h);
  const radDegMult = clamp(1 + doseRate / 20, 1, 2.5);
  const solarBol = solarUnits.reduce((a, { comp, qty }) => a + comp.specs.generationW! * qty * cosFactor(comp) * flux * (r > 3 ? comp.specs.liltFactor ?? 0.65 : 1), 0);
  const solarDeg = solarUnits.length ? solarUnits.reduce((a, i) => a + i.comp.specs.degradationPerYear! * i.qty, 0) / sumQty(solarUnits, () => true) : 0.02;
  const solarEol = solarBol * Math.pow(1 - solarDeg, orbit.cruiseYears) * Math.pow(1 - solarDeg * radDegMult, years);
  const rtgBol = rtgUnits.reduce((a, { comp, qty }) => a + comp.specs.generationW! * qty, 0);
  const rtgDeg = rtgUnits.length ? rtgUnits[0].comp.specs.degradationPerYear! : 0;
  const rtgEol = rtgBol * Math.pow(1 - rtgDeg, totalYears);
  const rtgWaste = rtgUnits.reduce((a, { comp, qty }) => a + (comp.specs.wasteHeatW ?? 0) * qty, 0);
  const heaterW = Math.max(0, orbit.heaterWPerM2 * (bus.specs.surfaceAreaM2 ?? 1) * (hasMLI ? 0.6 : 1) - 0.1 * rtgWaste);

  // Propulsion duty (electric thrusters fire part-time for station-keeping)
  const contactFrac = clamp(geo.contactMinPerDay / 1440, 0, 1);
  let alwaysW = bus.power_watts, instrAvgSun = 0, instrAvgEcl = 0, instrPeak = 0, commsAvg = 0, commsPeak = 0;
  for (const { comp, qty } of items) {
    if (BASIC_ALWAYS_ON.has(comp.category)) {
      // wheels beyond 3 are cold spares drawing 25%
      if (comp.specs.adcsType === 'wheel') alwaysW += comp.power_watts * (Math.min(qty, 3) + Math.max(0, qty - 3) * 0.25);
      else if (comp.specs.isObc) alwaysW += comp.power_watts * (1 + (qty - 1) * 0.1);   // redundant computer is a cold spare
      else alwaysW += comp.power_watts * qty;
    } else if (comp.category === 'propulsion') {
      if (comp.specs.chemical) alwaysW += comp.power_watts * 0.5; // line & tank heaters
    } else if (comp.category === 'instrument') {
      const d = effDuty(comp);
      instrAvgSun += comp.power_watts * qty * (comp.specs.needsDaylight ? Math.min(1, d / Math.max(0.3, 1 - geo.eclipseFrac)) : d);
      if (!comp.specs.needsDaylight) instrAvgEcl += comp.power_watts * qty * d;
      instrPeak += comp.power_watts * qty;
    } else if (comp.category === 'comms') {
      const unit = comp.power_watts;
      commsAvg += unit * 0.15 + (best && best.comp.id === comp.id ? unit * 0.85 * contactFrac : 0);
      commsPeak = Math.max(commsPeak, unit);
    }
  }
  const electric = items.filter((i) => i.comp.category === 'propulsion' && i.comp.specs.chemical === false);
  const chemical = items.filter((i) => i.comp.category === 'propulsion' && i.comp.specs.chemical);

  // ── Δv budget (needed for EP duty and mass) ──
  const dvBudget: { label: string; dv: number }[] = [];
  const array = solarUnits.reduce((a, i) => a + (i.comp.specs.arrayAreaM2 ?? 0) * i.qty, 0);
  const dragArea = (bus.specs.dragAreaM2 ?? 1) + array * 0.3;
  const wetGuess = dryWithCont * 1.1;
  const B = (2.2 * dragArea) / wetGuess;
  const hasProp = chemical.length + electric.length > 0;
  let insertion = orbit.insertionDvMs;
  if (insertion > 0 && !chemical.length && electric.length && !orbit.insertionNeedsChemical) insertion *= orbit.lowThrustFactor ?? 1.8; // low-thrust spiral penalty
  const INS_LABEL: Partial<Record<string, string>> = { JUPITER: 'Jupiter orbit insertion + tour', LUNAR: 'Lunar orbit insertion', L2: 'Mid-course + L2 halo insertion', MARS: 'Mars orbit insertion', ASTEROID: 'Cruise to Vesta + capture' };
  if (insertion > 0) dvBudget.push({ label: INS_LABEL[orbit.family] ?? 'Halo orbit insertion', dv: insertion });
  let annualDv = 0;
  if (orbit.family === 'LEO' || orbit.family === 'SSO') {
    annualDv += dragAccel(h, B) * SEC_PER_YEAR * 1.4; // solar-cycle average
  } else if (orbit.family === 'LUNAR') {
    annualDv += orbit.stationKeepingDvPerYear * Math.pow(100 / h, 1.3);
  } else annualDv += orbit.stationKeepingDvPerYear;
  const needsThrusterDumps = h > 2000 || orbit.central !== 'earth';
  const hasMtq = items.some((i) => i.comp.specs.adcsType === 'magnetorquer') || pt.hasIntegrated;
  if (pt.wheels >= 3 && (needsThrusterDumps || !hasMtq)) annualDv += 2;
  if (annualDv > 0.01) dvBudget.push({ label: orbit.family === 'LEO' || orbit.family === 'SSO' ? 'Drag make-up & momentum dumps' : 'Station-keeping & momentum dumps', dv: annualDv * years });
  let disposal = 0;
  if (orbit.family === 'LEO' || orbit.family === 'SSO') {
    const natural = decayLifetimeYears(h, B);
    if (natural > years + 5) {
      const ra = RE + h, rp = RE + 250;
      const va = Math.sqrt(MU_E / ra);
      disposal = 1000 * va * (1 - Math.sqrt((2 * rp) / (ra + rp)));
    }
  } else if (orbit.family === 'GEO') disposal = 11;
  else if (orbit.family === 'JUPITER') disposal = 20;
  else if (orbit.family === 'L1' || orbit.family === 'L2') disposal = 2;
  else if (orbit.family === 'MARS') disposal = 15; // planetary protection: raise to a long-lived orbit
  if (disposal > 0) dvBudget.push({ label: 'End-of-life disposal', dv: disposal });
  // Space-junk rule: an Earth satellite must re-enter within 25 years of the mission's end.
  const junkYears = (orbit.family === 'LEO' || orbit.family === 'SSO') && !hasProp ? decayLifetimeYears(h, B) - years : 0;
  const junk = junkYears > 25;
  const dvNoMargin = dvBudget.reduce((a, d) => a + d.dv, 0);
  const dvTotal = dvNoMargin * 1.1;
  if (dvTotal > 0) dvBudget.push({ label: '10% Δv margin', dv: dvNoMargin * 0.1 });

  // Propellant split: chemical for insertion if present, the rest on the most efficient system.
  const propCap = items.filter((i) => i.comp.category === 'propulsion').reduce((a, i) => a + (i.comp.specs.maxPropellantKg ?? 0) * i.qty, 0);
  const bestChem = chemical.length ? chemical.reduce((a, b) => (b.comp.specs.ispS! > a.comp.specs.ispS! ? b : a)) : null;
  const bestAll = hasProp ? [...chemical, ...electric].reduce((a, b) => (b.comp.specs.ispS! > a.comp.specs.ispS! ? b : a)) : null;
  let propellantKg = 0, dvCapability = 0;
  if (bestAll) {
    const insertDv = insertion * 1.1;
    const restDv = Math.max(0, dvTotal - insertDv);
    const insertIsp = bestChem ? bestChem.comp.specs.ispS! : bestAll.comp.specs.ispS!;
    // Burn order: insertion first (heavier), then the rest. Work backwards from dry mass.
    const pRest = propellantFor(restDv, dryWithCont, bestAll.comp.specs.ispS!);
    const pIns = propellantFor(insertDv, dryWithCont + pRest, insertIsp);
    propellantKg = pRest + pIns;
    const effIsp = propellantKg > 0 ? (insertIsp * pIns + bestAll.comp.specs.ispS! * pRest) / propellantKg : bestAll.comp.specs.ispS!;
    dvCapability = dvFrom(Math.min(propCap, propellantKg * 1.15), dryWithCont, effIsp);
  }
  // Tanks are filled up to a 15% reserve if they have room (for dodges, leaks and an extended mission).
  const loadedProp = Math.min(propellantKg * 1.15, propCap);
  if (insertion > 0 && !hasProp) blockers.push(`${orbit.name} requires ${fmt(insertion, 0)} m/s of spacecraft Δv for orbit insertion, but there is no propulsion system.`);
  if (insertion > 0 && orbit.insertionNeedsChemical && !chemical.length && hasProp) blockers.push(`${orbit.name} insertion is a fast, high-thrust burn — electric propulsion is too weak. Add a chemical system.`);
  if (hasProp && propCap <= 0) blockers.push('Your engine has no propellant tank. Add a fuel tank.');
  else if (hasProp && propellantKg > propCap * 1.0001) {
    const insertNeed = insertion * 1.1;
    if (dvCapability < insertNeed) blockers.push(`Propellant tanks hold ${fmt(propCap, 0)} kg but the Δv budget needs ${fmt(propellantKg, 0)} kg — not even enough for orbit insertion.`);
    else warnings.push(`Tanks hold ${fmt(propCap, 0)} kg of the ${fmt(propellantKg, 0)} kg needed: station-keeping will run dry early.`);
  } else if (hasProp && propellantKg > 0 && propCap < propellantKg * 1.15) warnings.push('Tanks are full with no fuel reserve: a leak or a dodge could end the mission early.');
  let epDuty = 0;
  if (electric.length && annualDv > 0) {
    const e = electric[0].comp;
    epDuty = clamp((annualDv * (dryWithCont + loadedProp)) / (e.specs.thrustN! * SEC_PER_YEAR), 0, 1);
    alwaysW += e.power_watts * epDuty;
  }

  const heaterSunFrac = clamp(1 - orbit.hotFluxWPerM2 / 100, 0.3, 1);
  const loadSun = alwaysW + instrAvgSun + commsAvg + heaterW * heaterSunFrac;
  const loadEcl = alwaysW + instrAvgEcl + commsAvg + heaterW;
  const peak = alwaysW + instrPeak + commsPeak + heaterW;
  const f = geo.eclipseFrac;
  const Td = (1 - f) * geo.periodMin, Te = f * geo.periodMin;
  const rtgUsable = rtgEol;
  const Pe = Math.max(0, loadEcl - rtgUsable), Pd = Math.max(0, loadSun - rtgUsable);
  const reqArray = Td > 0 && Te > 0 ? (Pe * Te / X_E + Pd * Td / X_D) / Td : Pd / X_D;
  const supply = solarEol + rtgEol;
  const demand = reqArray + Math.min(rtgEol, Math.max(loadSun, loadEcl));
  const powerMargin = demand > 0 ? (supply - demand) / demand : 1;
  // Batteries
  const batts = items.filter((i) => i.comp.category === 'battery');
  const batteryWh = batts.reduce((a, i) => a + i.comp.specs.capacityWh! * i.qty, 0);
  const n80 = batteryWh > 0 ? batts.reduce((a, i) => a + i.comp.specs.capacityWh! * i.qty * i.comp.specs.cycleLife80!, 0) / batteryWh : 3000;
  const totalCycles = Math.max(1, geo.cyclesPerYear * years);
  const dodAllowed = clamp(0.8 * Math.sqrt(n80 / totalCycles), 0.1, 0.8);
  const eclipseWh = Pe * (Te / 60);
  const safeModeWh = (bus.power_watts + 20) * 1.5;
  const batteryNeeded = Math.max(eclipseWh / (dodAllowed * BATTERY_EFF), safeModeWh / 0.8);
  const dodActual = batteryWh > 0 ? eclipseWh / (batteryWh * BATTERY_EFF) : Infinity;
  const power: PowerBudget = {
    source: [solarUnits.length ? 'Solar' : '', rtgUnits.length ? 'RTG' : ''].filter(Boolean).join(' + ') || 'None',
    bolW: solarBol + rtgBol, eolW: supply, solarFluxFactor: flux, periodMin: geo.periodMin, eclipseFraction: f, eclipseMin: Te,
    loadSunW: loadSun, loadEclipseW: loadEcl, peakW: peak, heaterW, requiredArrayW: reqArray, marginFrac: powerMargin,
    batteryWh, batteryNeededWh: batteryNeeded, dodAllowed, dodActual, cyclesPerYear: geo.cyclesPerYear, rtgW: rtgEol,
  };
  if (!solarUnits.length && !rtgUnits.length) blockers.push('No power generation: add solar arrays or an RTG.');
  if (!batts.length) blockers.push('No battery: every spacecraft needs one for launch, deployment and safe mode.');
  if (electric.length && orbit.insertionDvMs > 0 && !chemical.length) {
    const spiralW = bus.power_watts + electric[0].comp.power_watts + 30;
    const cruiseFlux = r > 1.5 ? 1 / Math.pow((1 + r) / 2, 2) : flux;
    const cruiseSupply = (flux > 0 ? solarBol * (cruiseFlux / flux) : 0) + rtgBol;
    if (cruiseSupply < spiralW) blockers.push(`The electric engine needs ~${fmt(spiralW, 0)} W during cruise but the arrays give only ${fmt(cruiseSupply, 0)} W${r > 1.5 ? ` at ~${fmt((1 + r) / 2, 1)} AU` : ''}. Add bigger solar arrays.`);
  }

  // ── Thermal ──
  const rejection = (bus.specs.heatRejectionW ?? 100) * (hasMLI ? 1.3 : 1) + items.reduce((a, i) => a + (i.comp.specs.addedRejectionW ?? 0) * i.qty, 0);
  const heatLoad = 0.9 * (loadSun + 0.3 * (instrPeak - instrAvgSun)) + orbit.hotFluxWPerM2 * (bus.specs.surfaceAreaM2 ?? 1) * 0.3 + rtgWaste * 0.05;
  const thermalMargin = (rejection - heatLoad) / heatLoad;
  const thermal = { rejectionW: rejection, heatLoadW: heatLoad, marginFrac: thermalMargin, heaterW, status: (thermalMargin < 0 ? 'crit' : thermalMargin < 0.15 ? 'warn' : 'ok') as Status };
  if (thermalMargin < 0) explanations.push({ pillar: 'power', severity: 'crit', text: `Thermal: the spacecraft must reject ${fmt(heatLoad, 0)} W in the hot case but radiators handle ${fmt(rejection, 0)} W — electronics would overheat. Add a deployable radiator or MLI kit.` });

  // ── Mass ──
  const wetKg = dryWithCont + loadedProp;
  const dispenserKg = N > 1 ? (busClass === 'cube' ? 0.12 * wetKg * N : busClass === 'small' ? Math.ceil(N / 6) * 140 : 0.05 * wetKg * N) : busClass === 'cube' ? 0.12 * wetKg : 0;
  const fleetKg = wetKg * N;
  const launchMass = fleetKg + dispenserKg;
  let capacity = lv.max_payload_kg_by_orbit[orbit.launchCapacityKey] ?? 0;
  if (capacity > 0 && CAPACITY_REF_ALT[orbit.launchCapacityKey] !== undefined) {
    capacity *= clamp(1 - 0.00028 * (h - CAPACITY_REF_ALT[orbit.launchCapacityKey]), 0.3, 1.15);
  }
  const ride = lv.costPerKg !== undefined;
  let launches = capacity > 0 ? Math.max(1, Math.ceil(launchMass / capacity)) : 0;
  if (N === 1 && launchMass > capacity) launches = 1;
  const volumePerSc = (bus.specs.stowedVolumeM3 ?? 1) * 1.2 + instruments.reduce((a, i) => a + (i.comp.mass_kg > 100 ? 2 : 0), 0);
  const volume = volumePerSc * N;
  const fairingTotal = lv.fairing_volume * Math.max(1, launches);
  if (capacity <= 0) blockers.push(`${lv.name} cannot deliver payload to ${orbit.name}.`);
  else if (N === 1 && launchMass > capacity) blockers.push(`Launch mass ${fmt(launchMass, 0)} kg exceeds ${lv.name} capacity of ${fmt(capacity, 0)} kg to ${orbit.name}.`);
  else if (launches > 4) blockers.push(`The fleet needs ${launches} launches of ${lv.name} — more than 4 is not a credible campaign. Choose a bigger rocket or fewer spacecraft.`);
  if (volumePerSc > lv.fairing_volume * 1.0001) blockers.push(`A ${bus.name} (${fmt(volumePerSc, 1)} m³ stowed) does not fit in the ${lv.name} fairing (${fmt(lv.fairing_volume, 1)} m³).`);
  else if (volume > fairingTotal) blockers.push(`The fleet's stowed volume (${fmt(volume, 1)} m³) exceeds the fairing volume across ${launches} launch(es).`);
  const busPayloadCap = bus.specs.payloadCapacityKg ?? 100;
  if (componentsKg > busPayloadCap) blockers.push(`Components weigh ${fmt(componentsKg, 1)} kg but the ${bus.name} structure is rated for ${fmt(busPayloadCap, 1)} kg.`);
  const mass: MassBudget = {
    busKg: bus.mass_kg, componentsKg, dryKg, contingencyKg, propellantKg: loadedProp, propellantCapacityKg: propCap, propellantNeededKg: propellantKg, wetKg, fleetKg, dispenserKg,
    launchMassKg: launchMass, lvCapacityKg: capacity, launchesNeeded: launches, busPayloadUsedKg: componentsKg, busPayloadCapKg: busPayloadCap,
    dvBudget, dvTotal, dvCapability, volumeM3: volume, fairingM3: fairingTotal,
  };

  // ── Schedule ──
  const leads = [bus, ...items.map((i) => i.comp)].map((c) => (c.specs.leadMonths ?? 6) + (mods.extraLeadMonths[c.id] ?? 0));
  const maxLead = Math.max(...leads);
  const distinct = items.length;
  const fleetProd = N > 1 ? (busClass === 'cube' ? 0.3 : 0.8) * (N - 1) : 0;
  const devBase = maxLead + 4 + 0.35 * distinct + (bus.specs.testMonths ?? 6) + fleetProd;
  const marketLaunch = ride ? Math.max(lv.minChargeKg ?? 0, launchMass) * (lv.costPerKg ?? 0) * (orbit.launchCapacityKey === 'TLI' ? 8 : 1) : lv.cost_millions * Math.max(1, launches);
  // Payload chain: optics + detector cooling
  const chain = chainEval(items, orbit, design.orbit.ltan);
  warnings.push(...chain.warnings);
  const devMonths = devBase;
  const readyMonth = Math.max(devMonths, lv.leadMonths) + mods.launchDelayMonths;
  let launchMonth = readyMonth;
  if (orbit.launchWindowMonths > 0) {
    const offset = (hashSeed(design.scenarioSeed) % orbit.launchWindowMonths);
    const k = Math.ceil((readyMonth - offset) / orbit.launchWindowMonths);
    launchMonth = offset + Math.max(0, k) * orbit.launchWindowMonths;
  }
  const deadline = obj.deadlineMonths + mods.deadlineShiftMonths;

  // ── Lifetime limiters ──
  const limits: { label: string; years: number }[] = [];
  const designLife = (bus.specs.designLifeYears ?? 5) * 1.3;
  limits.push({ label: `Bus design life (${bus.specs.designLifeYears} yr + 30% extension)`, years: designLife });
  let decayYears = Infinity;
  if (orbit.family === 'LEO' || orbit.family === 'SSO') {
    const natural = decayLifetimeYears(h, B);
    if (hasProp && annualDv > 0) {
      const sk = Math.max(0, dvCapability - insertion * 1.1 - disposal);
      const skYears = sk / annualDv;
      decayYears = skYears + (sk > 0 ? natural : 0);
      decayYears = Math.max(decayYears, natural);
    } else decayYears = natural;
    limits.push({ label: `Orbit decay at ${fmt(h, 0)} km${hasProp ? ' (with drag make-up)' : ''}`, years: decayYears });
  }
  let propellantYears = Infinity;
  if (annualDv > 0 && orbit.family !== 'LEO' && orbit.family !== 'SSO') {
    if (!hasProp) {
      propellantYears = orbit.family === 'L1' || orbit.family === 'L2' ? 0.5 : orbit.family === 'LUNAR' ? 0.3 * (h / 50) : orbit.family === 'JUPITER' ? 0.2 : Infinity;
      if (Number.isFinite(propellantYears)) limits.push({ label: 'No propulsion: orbit unstable without station-keeping', years: propellantYears });
    } else {
      const avail = Math.max(0, dvCapability - insertion * 1.1 - disposal);
      propellantYears = avail / annualDv;
      limits.push({ label: 'Propellant for station-keeping', years: propellantYears });
    }
  }
  const obcs = items.filter((i) => i.comp.specs.isObc);
  const shield = bus.specs.shieldFactor ?? 1;
  const cruiseDose = orbit.cruiseYears * 1.5;
  const bestObcTid = obcs.length ? Math.max(...obcs.map((i) => i.comp.specs.tidKrad ?? 30)) : 0;
  const radiationYears = obcs.length ? Math.max(0, (bestObcTid * shield - cruiseDose) / doseRate) : 0;
  limits.push({ label: `Radiation: flight computer ${fmt(bestObcTid, 0)} krad ÷ ${fmt(doseRate / shield, 2)} krad/yr`, years: radiationYears });
  let powerYears = Infinity;
  if (solarBol > 0 && demand > 0) {
    const solarNeeded = Math.max(0, demand - rtgEol);
    const solarAtArrival = solarBol * Math.pow(1 - solarDeg * radDegMult, orbit.cruiseYears);
    powerYears = solarNeeded <= 0 ? Infinity : solarAtArrival < solarNeeded ? 0 : Math.log(solarNeeded / solarAtArrival) / Math.log(1 - solarDeg * radDegMult);
    if (powerYears < 0.02 && powerMargin > -0.02) powerYears = 0.02;
    if (Number.isFinite(powerYears)) limits.push({ label: 'Solar array degradation below load', years: Math.max(0, powerYears) });
  }
  if (batteryWh > 0 && geo.cyclesPerYear > 0 && dodActual > 0 && Number.isFinite(dodActual)) {
    const cycleLife = n80 * Math.pow(0.8 / Math.min(1, dodActual), 2);
    limits.push({ label: `Battery cycle life at ${fmt(dodActual * 100, 0)}% depth of discharge`, years: cycleLife / geo.cyclesPerYear });
  }
  const lim = limits.reduce((a, b) => (b.years < a.years ? b : a), { label: 'none', years: Infinity });
  const lifetimeYears = Math.max(0, lim.years);
  const time: TimeBudget = {
    devMonths, lvLeadMonths: lv.leadMonths, readyMonth, launchMonth, deadlineMonth: deadline, cruiseYears: orbit.cruiseYears, plannedOpsYears: years,
    lifetimeYears, limiter: lim.label, limits, decayYears, radiationYears, propellantYears, designLifeYears: designLife, powerYears,
  };

  // ── Science ──
  const science = estimateScience(design, items, geo, h, returnFraction, pt.deg, Math.min(lifetimeYears, years), chain.mult);

  // ── Cost ──
  const lcExp = busClass === 'cube' ? 0.766 : 0.848;
  const hwFirst = [{ comp: bus, qty: 1 }, ...items].reduce((a, i) => a + i.comp.cost_millions * i.qty * (mods.costOverrun[i.comp.id] ?? 1), 0);
  const hwFleet = hwFirst * Math.pow(N, lcExp);
  const aitFactor = { cube: 0.2, small: 0.25, mid: 0.3, large: 0.35 }[busClass];
  const ait = aitFactor * hwFleet;
  const pmse = 0.15 * (hwFleet + ait);
  const development = hwFleet + ait + pmse;
  const reserves = design.reservePct * development;
  const launchCost = marketLaunch;
  const opsPerYear = (bus.specs.opsCostPerYear ?? 2) * Math.pow(N, 0.5);
  const contactHours = geo.contactMinPerDay / 60 / Math.max(gn.weatherAvailability, 0.01);
  const groundPerYear = gn.baseCostPerYear + gn.costPerHour * contactHours * 365;
  const operations = opsPerYear * (years + 0.4 * orbit.cruiseYears);
  const ground = groundPerYear * (years + 0.25 * orbit.cruiseYears);
  const lateMonths = Math.max(0, launchMonth - deadline);
  const scheduleSlip = 0.015 * development * lateMonths;
  const total = development + reserves + launchCost + operations + ground + scheduleSlip;
  const cap = obj.budgetCap * diff.budgetMult * mods.budgetCapMult;
  const cost: CostBudget = {
    hardware: hwFirst, hardwareFleet: hwFleet, ait, pmse, development, reserves, launch: launchCost, operations, ground, scheduleSlip, total, cap,
    lines: [
      { label: N > 1 ? `Flight hardware (${N} units, learning curve)` : 'Flight hardware', value: hwFleet },
      { label: 'Assembly, integration & test', value: ait },
      { label: 'Program management & systems engineering', value: pmse },
      { label: `Cost reserves (${fmt(design.reservePct * 100, 0)}%)`, value: reserves },
      { label: launches > 1 ? `Launch (${launches}× ${lv.name})` : `Launch (${lv.name})`, value: launchCost },
      { label: `Mission operations (${fmt(years, 1)} yr${orbit.cruiseYears ? ` + ${orbit.cruiseYears} yr cruise` : ''})`, value: operations },
      { label: `Ground network (${gn.name})`, value: ground },
      ...(scheduleSlip > 0 ? [{ label: `Schedule slip: ${fmt(lateMonths, 0)} months late`, value: scheduleSlip }] : []),
    ],
  };
  if (diff.enforceCaps && total > cap) blockers.push(`Lifecycle cost $${fmt(total, 0)}M exceeds the $${fmt(cap, 0)}M grant cap. NASA will not confirm the mission.`);
  if (design.reservePct + 1e-9 < diff.minReservePct) blockers.push(`${diff.name} rules require at least ${fmt(diff.minReservePct * 100, 0)}% cost reserves (you hold ${fmt(design.reservePct * 100, 0)}%).`);
  if (lateMonths > 0) warnings.push(`Launch at month ${fmt(launchMonth, 0)} misses the month-${fmt(deadline, 0)} deadline by ${fmt(lateMonths, 0)} months.`);

  // ── Difficulty-specific strict margins ──
  if (diff.id === 'director') {
    if (powerMargin < diff.powerMarginReq) blockers.push(`Hard rules: power margin must be ≥${diff.powerMarginReq * 100}% (yours: ${fmt(powerMargin * 100, 0)}%).`);
    if (thermalMargin < 0) blockers.push('Hard rules: thermal margin must be positive.');
    if (capacity > 0 && N === 1 && (capacity - launchMass) / capacity < 0.05) blockers.push('Hard rules: keep at least 5% launch-mass margin.');
  }
  if (science.missingRequired.length) warnings.push(`Objective needs at least one of: ${science.missingRequired.map((g) => g.join(' / ')).join('; ')}.`);
  if (pt.wheels >= 3 && needsThrusterDumps && !hasProp) warnings.push('Reaction wheels will saturate: beyond low Earth orbit only thrusters can dump momentum.');
  if (pt.wheels >= 3 && !needsThrusterDumps && !hasMtq && !hasProp) warnings.push('Reaction wheels will saturate with no magnetorquers or thrusters to dump momentum.');
  if (pt.wheels > 0 && pt.wheels < 3 && !pt.hasIntegrated) warnings.push(`${pt.wheels} reaction wheel(s) cannot control 3 axes — you need at least 3.`);

  // ── Reliability (analytic) ──
  const reliability = estimateReliability(design, items, bus, totalYears, cruiseDose + doseRate * years, shield, solarEol + rtgEol, demand, N, obj.fleetMinFraction, launches, lv.reliability, pointingReqs.some((p) => p.deg <= 0.05), insertion > 0 || annualDv > 0);

  // ── Pillars ──
  const crit = new Set(obj.criticalPillars);
  const mk = (key: ResourceKey, label: string, unit: string, used: number, cap2: number, status: Status, summary: string, why: string[]): PillarState => ({
    key, label, unit, used, capacity: cap2, utilization: cap2 > 0 ? used / cap2 : used > 0 ? Infinity : 0, margin: cap2 > 0 ? (cap2 - used) / cap2 : -1,
    status, bottleneck: false, critical: crit.has(key), summary, why,
  });
  const massWhy: string[] = [];
  const massCapTotal = capacity * Math.max(1, launches);
  const massMargin = massCapTotal > 0 ? (massCapTotal - launchMass) / massCapTotal : -1;
  let massStatus: Status = massMargin < 0 || componentsKg > busPayloadCap ? 'crit' : massMargin < Math.max(0.05, diff.massContingency * 0.4) ? 'warn' : 'ok';
  if (capacity <= 0) { massStatus = 'crit'; massWhy.push(`${lv.name} has no capability to ${orbit.name}.`); }
  if (massMargin < 0 && capacity > 0) massWhy.push(`Launch mass ${fmt(launchMass, 0)} kg = ${N > 1 ? `${N} × ` : ''}(${fmt(dryKg, 0)} kg dry + ${fmt(contingencyKg, 0)} kg contingency + ${fmt(loadedProp, 0)} kg propellant)${dispenserKg ? ` + ${fmt(dispenserKg, 0)} kg dispenser` : ''}, but ${lv.name} lifts only ${fmt(capacity, 0)} kg to ${orbit.name}${orbit.altitudeRangeKm ? ` at ${fmt(h, 0)} km` : ''}.`);
  if (loadedProp > 0.25 * dryWithCont) massWhy.push(`Propellant is ${fmt((100 * loadedProp) / wetKg, 0)}% of wet mass because the mission needs ${fmt(dvTotal, 0)} m/s of Δv (Tsiolkovsky: m_p = m_dry·(e^(Δv/Isp·g₀) − 1)).`);
  if (componentsKg > busPayloadCap) massWhy.push(`Components (${fmt(componentsKg, 1)} kg) exceed the bus structural rating (${fmt(busPayloadCap, 1)} kg).`);
  if (launches > 1) massWhy.push(`The ${N}-spacecraft fleet needs ${launches} launches of ${lv.name}.`);
  const pMass = mk('mass', 'Mass', 'kg', launchMass, massCapTotal, massStatus,
    `${fmt(launchMass, 0)} / ${fmt(massCapTotal, 0)} kg${launches > 1 ? ` (${launches} launches)` : ''}`, massWhy);

  const powerWhy: string[] = [];
  let powerStatus: Status = powerMargin < 0 ? 'crit' : powerMargin < diff.powerMarginReq ? 'warn' : 'ok';
  if (dodActual > 1) { powerStatus = 'crit'; powerWhy.push(`The ${fmt(Te, 0)}-minute eclipse needs ${fmt(eclipseWh, 0)} Wh but batteries hold only ${fmt(batteryWh, 0)} Wh: the spacecraft browns out every orbit.`); }
  else if (dodActual > dodAllowed * 1.05 && geo.cyclesPerYear > 0) { if (powerStatus === 'ok') powerStatus = 'warn'; powerWhy.push(`Batteries discharge ${fmt(dodActual * 100, 0)}% per eclipse; for ${fmt(totalCycles, 0)} cycles they should stay below ${fmt(dodAllowed * 100, 0)}% — they will wear out after ~${fmt(n80 * Math.pow(0.8 / Math.min(1, dodActual), 2) / Math.max(1, geo.cyclesPerYear), 1)} years. Add capacity (need ${fmt(batteryNeeded, 0)} Wh).`); }
  if (powerMargin < diff.powerMarginReq) {
    const parts = [`End-of-life supply is ${fmt(supply, 0)} W (${power.source}${r > 1.5 ? `, sunlight only ${fmt(flux * 100, 1)}% of Earth's at ${r} AU` : ''}${solarBol > 0 ? `, after ${fmt(totalYears, 1)} yr of degradation` : ''})`];
    parts.push(f > 0 ? `but loads of ${fmt(loadSun, 0)} W (sun) / ${fmt(loadEcl, 0)} W (eclipse) with a ${fmt(f * 100, 0)}% eclipse need ${fmt(demand, 0)} W of generation (array must also recharge the battery: P = (Pₑ·Tₑ/0.65 + P_d·T_d/0.85)/T_d)` : `but loads need ${fmt(demand, 0)} W`);
    powerWhy.push(parts.join(' ') + '.');
    const hungry = items.filter((i) => i.comp.power_watts * i.qty > 0.2 * Math.max(loadSun, 1)).map((i) => `${i.comp.name} (${fmt(i.comp.power_watts * i.qty, 0)} W)`);
    if (hungry.length) powerWhy.push(`Biggest loads: ${hungry.join(', ')}.`);
  }
  if (thermalMargin < 0) { if (powerStatus === 'ok') powerStatus = 'warn'; powerWhy.push(`Thermal: ${fmt(heatLoad, 0)} W of heat vs ${fmt(rejection, 0)} W radiator capacity.`); }
  const pPower = mk('power', 'Power', 'W', demand, supply, powerStatus, `${fmt(supply, 0)} W supply vs ${fmt(demand, 0)} W needed · battery ${fmt(batteryWh, 0)} Wh`, powerWhy);

  const budgetWhy: string[] = [];
  const budgetMargin = (cap - total) / cap;
  const budgetStatus: Status = !diff.enforceCaps ? 'ok' : budgetMargin < 0 ? 'crit' : budgetMargin < 0.05 ? 'warn' : 'ok';
  if (budgetMargin < 0.05 && diff.enforceCaps) {
    const top = [...cost.lines].sort((a, b) => b.value - a.value).slice(0, 3).map((l) => `${l.label} $${fmt(l.value, 0)}M`);
    budgetWhy.push(`Lifecycle cost $${fmt(total, 0)}M vs $${fmt(cap, 0)}M cap. Biggest items: ${top.join('; ')}.`);
    if (N > 1) budgetWhy.push(`Each additional spacecraft is cheaper (90% learning curve), but ${N} units still cost ${fmt(Math.pow(N, lcExp), 1)}× the first.`);
  }
  const pBudget = mk('budget', 'Budget', '$M', total, diff.enforceCaps ? cap : Math.max(total * 1.5, 1), budgetStatus,
    diff.enforceCaps ? `$${fmt(total, 0)}M / $${fmt(cap, 0)}M` : `$${fmt(total, 0)}M (no cap)`, budgetWhy);

  const dataWhy: string[] = [];
  const dataStatus: Status = genGb === 0 ? 'ok' : storageGb < genGb * (geo.maxGapHours / 24) ? 'crit' : storageGb < storageNeeded ? 'warn' : 'ok';
  if (dataStatus !== 'ok') dataWhy.push(`Instruments make ${fmt(genGb, 1)} Gb/day (after ${compression}:1 compression). The longest gap between ground contacts is ~${fmt(geo.maxGapHours, 1)} h, so you need ~${fmt(storageNeeded, 0)} Gb of storage (2× safety) but carry ${fmt(storageGb, 0)} Gb. Add a solid-state recorder or a computer with more memory.`);
  const pData = mk('data', 'Data', 'Gb', storageNeeded, storageGb, dataStatus, `${fmt(genGb, 1)} Gb/day made · ${fmt(storageGb, 0)} Gb storage`, dataWhy);

  const commsWhy: string[] = [];
  const ratio = downlinkGbPerDay > 0 ? genGb / downlinkGbPerDay : genGb > 0 ? Infinity : 0;
  let commsStatus: Status = ratio > 1 ? 'crit' : ratio > 0.85 ? 'warn' : 'ok';
  if (!best) commsStatus = 'crit';
  if (ratio > 0.85 && best) {
    const passTxt = orbit.contactMode === 'passes'
      ? `${fmt(geo.passesPerDay, 1)} passes/day of ~${fmt(geo.passMin, 1)} min (${fmt(geo.contactMinPerDay, 0)} min/day)`
      : `${fmt(geo.contactMinPerDay / 60, 1)} h/day of contact`;
    commsWhy.push(`Your ${best.comp.name} downlinks ${fmt(rateMbps, rateMbps < 1 ? 4 : 1)} Mbps × ${passTxt} = ${fmt(downlinkGbPerDay, 2)} Gb/day — only ${fmt(Math.min(100, 100 / ratio), 0)}% of the ${fmt(genGb, 2)} Gb/day generated.${Number.isFinite(bufferDays) ? ` The ${fmt(storageGb, 0)} Gb recorder overflows by day ${fmt(Math.ceil(bufferDays), 0)} and data is lost after that.` : ''}`);
    if (best.calc.limitedBy === 'physics') commsWhy.push(`The link is physics-limited at ${fmt(geo.rangeKm, 0)} km: free-space loss is ${fmt(best.calc.pathLossDb, 1)} dB (∝ 20·log₁₀(distance)). More transmit power, a bigger dish, a higher band or a bigger ground antenna (G/T) raise the rate.`);
    else commsWhy.push(`The radio hit its modem ceiling (${fmt(best.comp.specs.maxRateMbps ?? 0, 1)} Mbps). A higher-rate radio (Ka-band / optical) or more contact time is needed.`);
  }
  if (obj.realtimeHoursReq) {
    const hrs = geo.contactMinPerDay / 60;
    if (hrs < obj.realtimeHoursReq) {
      if (commsStatus === 'ok') commsStatus = hrs < obj.realtimeHoursReq * 0.5 ? 'crit' : 'warn';
      commsWhy.push(`Real-time warnings need ~${obj.realtimeHoursReq} h/day of ground contact; you have ${fmt(hrs, 1)} h/day, so storms arriving outside contacts go unreported.`);
    }
  }
  if (pt.deg > link.beamwidthDeg / 4 && best && best.comp.specs.dishDiameterM) commsWhy.push(`The ${fmt(link.beamwidthDeg, 2)}° beam of ${best.comp.name} needs better than ${fmt(link.beamwidthDeg / 4, 2)}° pointing; you achieve ${pt.deg}° — losing ${fmt(link.pointingLossDb, 1)} dB.`);
  const pComms = mk('comms', 'Comms', 'Gb/day', genGb, downlinkGbPerDay, commsStatus,
    best ? `${fmt(rateMbps, rateMbps < 1 ? 3 : 1)} Mbps · ${fmt(downlinkGbPerDay, 1)} Gb/day down` : 'No usable link', commsWhy);

  const timeWhy: string[] = [];
  let timeStatus: Status = 'ok';
  const minLife = obj.minLifeYears;
  if (lifetimeYears < minLife) { timeStatus = 'crit'; timeWhy.push(`Predicted lifetime ${fmt(lifetimeYears, 1)} yr is below the ${minLife}-yr minimum mission. Limiting factor: ${lim.label}.`); }
  else if (lifetimeYears < years) { timeStatus = 'warn'; timeWhy.push(`Predicted lifetime ${fmt(lifetimeYears, 1)} yr is shorter than the planned ${years} yr. Limiting factor: ${lim.label}.`); }
  if (launchMonth > deadline) { if (timeStatus === 'ok') timeStatus = 'warn'; timeWhy.push(`Development takes ${fmt(devMonths, 0)} months (longest lead: ${fmt(maxLead, 0)} mo + integration & test)${orbit.launchWindowMonths ? `, then wait for the next ${orbit.targetBody} launch window (every ${orbit.launchWindowMonths} mo)` : ''}; launch at month ${fmt(launchMonth, 0)} misses the month-${deadline} deadline. Each late month costs ~1.5% of development in standing-army costs.`); }
  if (junk) { if (timeStatus === 'ok') timeStatus = 'warn'; timeWhy.push(`Space-junk rule: with no engine it would stay in orbit ~${fmt(Math.min(junkYears, 999), 0)} years after the mission (limit 25). Add an engine to deorbit, or fly lower.`); warnings.push('No way to deorbit: the satellite would become space junk for decades.'); }
  const pTime = mk('time', 'Time', 'months', launchMonth, deadline, timeStatus, `Launch M${fmt(launchMonth, 0)} / deadline M${deadline} · life ${Number.isFinite(lifetimeYears) ? fmt(lifetimeYears, 1) : '∞'} yr`, timeWhy);

  const pillars: Record<ResourceKey, PillarState> = { mass: pMass, power: pPower, budget: pBudget, data: pData, comms: pComms, time: pTime };
  for (const p of Object.values(pillars)) for (const w of p.why) explanations.push({ pillar: p.key, severity: p.status, text: w });
  if (science.missingRequired.length) explanations.push({ pillar: 'science', severity: 'crit', text: `The objective cannot be met without at least one of: ${science.missingRequired.map((g) => g.join(' / ')).join('; ')}.` });
  if (science.total < science.threshold && !science.missingRequired.length) explanations.push({ pillar: 'science', severity: 'warn', text: `Projected science ${fmt(science.total, 0)} is below the minimum-mission threshold of ${fmt(science.threshold, 0)}. ${science.coverageFactor < 0.7 ? `Revisit is ${fmt(science.revisitDays ?? 0, 1)} days vs ${obj.revisitReqDays} required — more satellites or wider swaths help.` : 'Add relevant instruments or extend the mission.'}` });

  // Bottlenecks: worst normalized utilization, critical pillars first
  const util = (p: PillarState) => (p.status === 'crit' ? 10 : 0) + (p.status === 'warn' ? 5 : 0) + Math.min(p.utilization, 4);
  const sorted = Object.values(pillars).sort((a, b) => util(b) + (b.critical ? 0.5 : 0) - (util(a) + (a.critical ? 0.5 : 0)));
  const bottlenecks = sorted.filter((p) => p.status !== 'ok' || p.utilization > 0.85).slice(0, 3).map((p) => p.key);
  for (const k of bottlenecks) pillars[k].bottleneck = true;

  const compatibility = { ok: blockers.length === 0, blockers, warnings };
  let est = reliability.estimate;
  if (blockers.length) est = 0;
  if (lifetimeYears < minLife) est *= 0.05;
  if (powerMargin < 0) est *= Math.max(0.05, 1 + 2 * powerMargin);
  if (dodActual > 1) est *= 0.1;
  if (thermalMargin < 0) est *= 0.5;
  if (science.missingRequired.length) est = 0;
  else if (science.total < science.threshold) est *= 0.25;
  else if (science.total < science.baseline * 0.75) est *= 0.6;

  return { pillars, mass, power, cost, data, link, time, science, thermal, pointing, reliability: { ...reliability }, compatibility, explanations, bottlenecks, estimatedSuccess: clamp(est, 0, 1),
    chain: { mult: chain.mult, notes: chain.notes } };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── Science model ───────────────────────────────────────────────────────────
export function instrumentGeometry(comp: SpacecraftComponent, design: MissionDesign, geo: OrbitGeometry, h: number, n: number) {
  const orbit = ORBIT_MAP[design.orbit.id];
  const obj = OBJECTIVE_MAP[design.objectiveId];
  let revisit: number | null = null, gsd: number | null = null, cov = 1, res = 1;
  const isImager = comp.specs.fovDeg !== undefined && comp.specs.gsdAt500km !== undefined;
  if (isImager && orbit.central === 'earth' && obj?.earthObserving) {
    const alt = orbit.family === 'GTO' ? 20000 : h;
    gsd = comp.specs.gsdAt500km! * (alt / 500);
    const swath = Math.min(2 * alt * Math.tan(rad(comp.specs.fovDeg! / 2)), 12000);
    if (orbit.family === 'GEO') { revisit = 0.02; cov = 0.42; }
    else if (orbit.family === 'GTO') { revisit = 2; cov = 0.3; }
    else if (comp.specs.kind === 'lidar') { revisit = 91; cov = 1; } // profiler: sampling mission, not mapping
    else revisit = 40075 / (swath * geo.orbitsPerDay * n * (comp.specs.needsDaylight ? 1 : 2));
    if (obj.revisitReqDays && comp.specs.kind !== 'lidar') cov *= Math.pow(Math.min(1, obj.revisitReqDays / revisit), 0.6);
    if (obj.resolutionReqM) res = Math.pow(Math.min(1, obj.resolutionReqM / gsd), 0.5);
  } else if (orbit.family === 'L1' && obj?.earthObserving && isImager) {
    gsd = comp.specs.gsdAt500km! * 3000; revisit = 0.1; cov = 0.5;
    if (obj.resolutionReqM) res = Math.pow(Math.min(1, obj.resolutionReqM / gsd), 0.5);
  } else if (orbit.central === 'moon') {
    res = clamp(Math.pow(60 / h, 0.35), 0.55, 1.15);
  } else if (orbit.central === 'mars') {
    res = clamp(Math.pow(300 / h, 0.35), 0.6, 1.1);
  } else if (orbit.central === 'vesta') {
    res = clamp(Math.pow(700 / h, 0.3), 0.6, 1.25);
  }
  return { revisit, gsd, cov, res };
}

function estimateScience(design: MissionDesign, items: Expanded[], geo: OrbitGeometry, h: number, returnFraction: number, pointingDeg: number, opsYears: number,
  chain: Record<string, number> = {}, scienceMult = 1): ScienceEstimate {
  const obj = OBJECTIVE_MAP[design.objectiveId] ?? OBJECTIVE_MAP['sandbox'];
  const orbit = ORBIT_MAP[design.orbit.id];
  const diff = DIFFICULTY_MAP[design.difficulty];
  const N = Math.max(1, design.fleetSize);
  const orbitFactor = obj.orbitSuitability[orbit.family] ?? 0;
  const kinds = new Set(items.filter((i) => i.comp.category === 'instrument').map((i) => i.comp.specs.kind!));
  const seen: Record<string, number> = {};
  const perInstrument: { name: string; perYear: number; relevance: number }[] = [];
  let sum = 0, covAcc = 0, resAcc = 0, wAcc = 0;
  let revisitBest: number | null = null, gsdBest: number | null = null;
  const realtime = obj.realtimeHoursReq ? Math.min(1, geo.contactMinPerDay / 60 / obj.realtimeHoursReq) : 1;
  const coverageObjective = !!obj.revisitReqDays;
  const fleetFactor = coverageObjective ? 1 + 0.12 * (N - 1) : Math.pow(N, 0.6);
  for (const { comp, qty } of items) {
    if (comp.category !== 'instrument') continue;
    const kind = comp.specs.kind!;
    const rel = obj.instrumentWeights[kind] ?? 0;
    const g = instrumentGeometry(comp, design, geo, h, N);
    const pointF = comp.specs.pointingReqDeg && pointingDeg > comp.specs.pointingReqDeg ? Math.sqrt(comp.specs.pointingReqDeg / pointingDeg) : 1;
    for (let k = 0; k < qty; k++) {
      const dup = (seen[kind] = (seen[kind] ?? 0) + 1);
      const dupF = dup === 1 ? 1 : dup === 2 ? 0.5 : 0.25;
      const v = comp.science_points * rel * orbitFactor * g.cov * g.res * pointF * dupF * realtime * (chain[comp.id] ?? 1);
      sum += v;
      perInstrument.push({ name: comp.name, perYear: v, relevance: rel });
    }
    if (g.revisit !== null) revisitBest = revisitBest === null ? g.revisit : Math.min(revisitBest, g.revisit);
    if (g.gsd !== null) gsdBest = gsdBest === null ? g.gsd : Math.min(gsdBest, g.gsd);
    covAcc += g.cov * rel; resAcc += g.res * rel; wAcc += rel;
  }
  const synergies: string[] = [];
  let syn = 1;
  for (const s of obj.synergy ?? []) if (s.kinds.every((k) => kinds.has(k))) { syn += s.bonus; synergies.push(`${s.label} (+${Math.round(s.bonus * 100)}%)`); }
  const perYear = sum * syn * fleetFactor * (0.25 + 0.75 * returnFraction) * scienceMult;
  for (const p of perInstrument) p.perYear *= syn * fleetFactor * (0.25 + 0.75 * returnFraction) * scienceMult;
  const missingRequired = obj.requiredKinds.filter((group) => !group.some((k) => kinds.has(k)));
  return {
    perYear, total: perYear * Math.max(0, opsYears), threshold: obj.scienceThreshold * diff.scienceThresholdMult, baseline: obj.scienceBaseline * diff.scienceThresholdMult,
    orbitFactor, coverageFactor: wAcc ? covAcc / wAcc : 1, resolutionFactor: wAcc ? resAcc / wAcc : 1, fleetFactor, revisitDays: revisitBest, gsdM: gsdBest,
    perInstrument, missingRequired, synergies,
  };
}

// ── Reliability model ───────────────────────────────────────────────────────
/** Instruments sit partly outside the vault: they get ~60% of the bus shielding benefit. */
export const instrumentShield = (busShield: number) => Math.max(1, busShield * 0.6);
export function binomAtLeast(n: number, k: number, p: number) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let j = k; j <= n; j++) s += choose(n, j) * Math.pow(p, j) * Math.pow(1 - p, n - j);
  return s;
}
function choose(n: number, k: number) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
export const unitReliability = (r5: number, years: number) => Math.exp((Math.log(r5) / 5) * years);

function estimateReliability(design: MissionDesign, items: Expanded[], bus: SpacecraftComponent, T: number, totalDose: number, shield: number,
  supply: number, demand: number, N: number, fleetMin: number, launches: number, lvRel: number, needsST: boolean, needsProp: boolean) {
  const sub: { label: string; r: number }[] = [];
  const radPenalty = (c: SpacecraftComponent, sh: number) => {
    const tid = c.specs.tidKrad; if (!tid) return 1;
    const dose = totalDose / sh;
    return dose > tid * 1.2 ? 0.05 : dose > tid ? 0.3 : dose > tid * 0.8 ? 0.7 : 1;
  };
  const group = (pred: (c: SpacecraftComponent) => boolean, label: string, kNeeded: (n: number) => number, sh = shield) => {
    const g = items.filter((i) => pred(i.comp));
    const n = g.reduce((a, i) => a + i.qty, 0);
    if (!n) return;
    const p = g.reduce((a, i) => a + unitReliability(i.comp.reliability, T) * radPenalty(i.comp, sh) * i.qty, 0) / n;
    sub.push({ label, r: binomAtLeast(n, kNeeded(n), p) });
  };
  sub.push({ label: 'Structure & deployment', r: (bus.specs.deploySuccess ?? 0.97) * unitReliability(bus.reliability, T) * (T > (bus.specs.designLifeYears ?? 5) ? Math.exp(-(T - (bus.specs.designLifeYears ?? 5)) * 0.15) : 1) });
  const perGen = items.filter((i) => i.comp.category === 'power').reduce((a, i) => a + i.qty, 0);
  group((c) => c.category === 'power', 'Power generation', (n) => Math.min(n, Math.max(1, Math.ceil((demand / Math.max(supply, 1)) * perGen))));
  group((c) => c.category === 'battery', 'Batteries', () => 1);
  group((c) => !!c.specs.isObc, 'Flight computer', () => 1);
  group((c) => c.category === 'comms', 'Communications', () => 1, shield);
  const wheels = items.some((i) => i.comp.specs.adcsType === 'wheel');
  if (wheels) group((c) => c.specs.adcsType === 'wheel', 'Reaction wheels (3 needed)', () => 3);
  group((c) => c.specs.adcsType === 'integrated', 'ADCS unit', () => 1);
  if (needsST) group((c) => c.specs.adcsType === 'startracker', 'Star trackers', () => 1);
  if (needsProp) group((c) => c.category === 'propulsion', 'Propulsion', () => 1);
  const obj = OBJECTIVE_MAP[design.objectiveId];
  const relevant = items.filter((i) => i.comp.category === 'instrument' && (obj.instrumentWeights[i.comp.specs.kind!] ?? 0) >= 0.5);
  if (relevant.length) {
    let none = 1;
    for (const i of relevant) for (let k = 0; k < i.qty; k++) none *= 1 - unitReliability(i.comp.reliability, T) * radPenalty(i.comp, instrumentShield(shield));
    sub.push({ label: 'Key instruments (≥1 working)', r: 1 - none });
  }
  const sc = sub.reduce((a, s) => a * s.r, 1);
  const need = Math.max(1, Math.ceil(N * fleetMin));
  const fleet = binomAtLeast(N, need, sc);
  const launch = Math.pow(lvRel, Math.max(1, launches));
  return { spacecraft: sc, fleet, launch, deploy: bus.specs.deploySuccess ?? 0.97, estimate: fleet * launch, subsystems: sub };
}

// ── Permission / negotiation helper: which roles must approve a design change ──
export interface ImpactCheck { resource: ResourceKey; before: number; after: number; beforeStatus: Status; afterStatus: Status; owner: string }

export function impactOfChange(before: ResourceState, after: ResourceState): ImpactCheck[] {
  const out: ImpactCheck[] = [];
  for (const key of Object.keys(after.pillars) as ResourceKey[]) {
    const a = before.pillars[key], b = after.pillars[key];
    const rank = { ok: 0, warn: 1, crit: 2 } as const;
    const worse = rank[b.status] > rank[a.status] || (b.status !== 'ok' && b.utilization > a.utilization + 1e-6 && rank[b.status] >= rank[a.status]);
    if (worse) out.push({ resource: key, before: a.utilization, after: b.utilization, beforeStatus: a.status, afterStatus: b.status, owner: RESOURCE_OWNER[key] });
  }
  return out;
}

export function describeRole(id: string) { return ROLE_MAP[id as keyof typeof ROLE_MAP]?.name ?? id; }

export function selectionWith(list: ComponentSelection[], id: string, qty: number): ComponentSelection[] {
  const out = list.filter((s) => s.id !== id);
  if (qty > 0) out.push({ id, qty });
  return out;
}
