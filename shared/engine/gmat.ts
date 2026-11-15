// ─────────────────────────────────────────────────────────────────────────────
// GMAT-inspired trajectory & maneuver analyzer (pure functions).
// Two-body Keplerian mechanics + patched conics, the same first-order methods
// mission designers use before running NASA's General Mission Analysis Tool:
//   period T = 2π√(a³/μ) · eclipse from the cylindrical shadow and β angle ·
//   Hohmann / plane-change Δv · C3 = v∞² · synodic launch windows ·
//   ground-pass geometry (elevation mask) · light time.
// ─────────────────────────────────────────────────────────────────────────────

export const MU_EARTH = 398600.4418;          // km³/s²
export const R_EARTH = 6378.137;              // km (equatorial)
export const J2 = 1.08263e-3;
export const MU_SUN = 1.32712440018e11;
export const AU = 1.495978707e8;              // km
export const MU_MOON = 4902.8;
export const R_MOON = 1737.4;
export const MOON_DIST = 384400;
export const C_KMS = 299792.458;
export const SIDEREAL_DAY_S = 86164.0905;
const DEG = Math.PI / 180;

export type GmatFamily = 'LEO' | 'SSO' | 'GTO' | 'GEO' | 'HEO' | 'TLI' | 'LLO' | 'NRHO' | 'L1' | 'L2' | 'INTERPLANETARY';
export type TargetBody = 'mars' | 'vesta' | 'ceres' | 'psyche' | 'jupiter';

export const TARGETS: Record<TargetBody, { name: string; aAU: number; mu: number; R: number; captureAltKm: number; electricRendezvous: boolean }> = {
  mars: { name: 'Mars', aAU: 1.5237, mu: 42828.37, R: 3389.5, captureAltKm: 400, electricRendezvous: false },
  vesta: { name: 'Vesta (Dawn)', aAU: 2.3615, mu: 17.29, R: 262.7, captureAltKm: 680, electricRendezvous: true },
  ceres: { name: 'Ceres (Dawn)', aAU: 2.7675, mu: 62.63, R: 469.7, captureAltKm: 1470, electricRendezvous: true },
  psyche: { name: '16 Psyche', aAU: 2.924, mu: 1.53, R: 113, captureAltKm: 700, electricRendezvous: true },
  jupiter: { name: 'Jupiter (Europa tour)', aAU: 5.2044, mu: 1.26686534e8, R: 69911, captureAltKm: 600000, electricRendezvous: false },
};

export interface GmatInput {
  family: GmatFamily;
  altitudeKm: number;          // circular altitude (LEO/SSO/LLO) or perigee (HEO/GTO)
  apogeeKm: number;            // HEO apogee
  inclinationDeg: number;
  betaDeg: number;             // Sun angle to the orbit plane (eclipse)
  launchLatDeg: number;        // launch-site latitude (plane change to GEO)
  target: TargetBody;
  minElevDeg: number;          // ground-station elevation mask
  dryKg: number;
  ispS: number;
}

export const GMAT_DEFAULT: GmatInput = { family: 'LEO', altitudeKm: 500, apogeeKm: 39750, inclinationDeg: 51.6, betaDeg: 20, launchLatDeg: 28.5, target: 'mars', minElevDeg: 10, dryKg: 500, ispS: 225 };

export interface Maneuver { name: string; dv: number; note: string }
export interface GmatResult {
  label: string;
  periodMin: number | null;
  eclipseFrac: number;
  eclipseMaxMin: number;
  maneuvers: Maneuver[];
  dvTotal: number;
  propellantKg: number;
  c3: number | null;
  transferDays: number | null;
  windowWaitDays: number;
  windowNote: string;
  passMinutes: number | null;
  passesPerDay: number | null;
  contactNote: string;
  rangeKm: number;
  lightTimeS: number;
  inclinationDeg: number;
  notes: string[];
}

// ── Building blocks ──────────────────────────────────────────────────────────
export const periodS = (aKm: number, mu = MU_EARTH) => 2 * Math.PI * Math.sqrt((aKm ** 3) / mu);
export const vCirc = (rKm: number, mu = MU_EARTH) => Math.sqrt(mu / rKm);
export const vEllipse = (rKm: number, aKm: number, mu = MU_EARTH) => Math.sqrt(mu * (2 / rKm - 1 / aKm));

/** Inclination that makes the node precess 360°/year (sun-synchronous). */
export function ssoInclinationDeg(altKm: number): number {
  const a = R_EARTH + altKm;
  const rho = (2 * Math.PI) / (365.2422 * 86400);
  const c = -(2 * rho * Math.pow(a, 3.5)) / (3 * J2 * R_EARTH * R_EARTH * Math.sqrt(MU_EARTH));
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/** Cylindrical-shadow eclipse fraction for a circular orbit (SMAD). */
export function eclipseFractionCircular(altKm: number, betaDeg: number, R = R_EARTH): number {
  const r = R + altKm;
  const betaStar = Math.asin(R / r);
  const b = Math.abs(betaDeg) * DEG;
  if (b >= betaStar) return 0;
  return Math.acos(Math.sqrt(altKm * altKm + 2 * R * altKm) / (r * Math.cos(b))) / Math.PI;
}

/** Longest pass over a station for a circular orbit, minutes (non-rotating Earth). */
export function maxPassMinutes(altKm: number, minElevDeg: number, R = R_EARTH, mu = MU_EARTH): number {
  const eps = minElevDeg * DEG;
  const eta = Math.asin((R * Math.cos(eps)) / (R + altKm));
  const lam = Math.PI / 2 - eps - eta;
  return (periodS(R + altKm, mu) / 60) * ((2 * lam) / (2 * Math.PI));
}

/** Plane change Δv at speed v (km/s). */
export const planeChange = (v: number, dIncDeg: number) => 2 * v * Math.sin((dIncDeg * DEG) / 2);

/** Hohmann transfer between circular orbits around the Sun (km, km/s, days). */
export function helioHohmann(r1: number, r2: number) {
  const at = (r1 + r2) / 2;
  const v1 = vCirc(r1, MU_SUN), v2 = vCirc(r2, MU_SUN);
  const vt1 = vEllipse(r1, at, MU_SUN), vt2 = vEllipse(r2, at, MU_SUN);
  const tof = Math.PI * Math.sqrt(at ** 3 / MU_SUN) / 86400;
  return { vInfDep: Math.abs(vt1 - v1), vInfArr: Math.abs(v2 - vt2), tofDays: tof };
}

export const synodicDays = (aAU1: number, aAU2: number) => {
  const T1 = 365.25 * Math.pow(aAU1, 1.5), T2 = 365.25 * Math.pow(aAU2, 1.5);
  return 1 / Math.abs(1 / T1 - 1 / T2);
};

export const propellantKg = (dvMs: number, dryKg: number, isp: number) => dryKg * (Math.exp(dvMs / (isp * 9.80665)) - 1);

// ── Main analyzer ────────────────────────────────────────────────────────────
export function analyzeTrajectory(inp: GmatInput): GmatResult {
  const notes: string[] = [];
  const m: Maneuver[] = [];
  const parkR = R_EARTH + 200;
  const vPark = vCirc(parkR);
  let periodMin: number | null = null, ecl = 0, eclMax = 0, c3: number | null = null, tof: number | null = null;
  let waitDays = 0.5, windowNote = 'Launch any day (daily windows to match the orbit plane).';
  let passMin: number | null = null, passes: number | null = null, contactNote = '';
  let range = inp.altitudeKm, inc = inp.inclinationDeg;
  let label = '';
  const h = Math.max(160, inp.altitudeKm);
  const pass = (alt: number) => {
    passMin = maxPassMinutes(alt, inp.minElevDeg) * 0.7;
    const orbitsPerDay = 1440 / (periodS(R_EARTH + alt) / 60);
    const lamFrac = (maxPassMinutes(alt, inp.minElevDeg) / (periodS(R_EARTH + alt) / 60));
    passes = Math.min(orbitsPerDay, orbitsPerDay * lamFrac * 2.2 * (inc > 75 ? 1.6 : 1));
    contactNote = `≈ ${passes.toFixed(1)} passes/day of ~${passMin.toFixed(1)} min over one mid-latitude station (${inp.minElevDeg}° mask).`;
  };

  switch (inp.family) {
    case 'LEO': case 'SSO': {
      label = inp.family === 'SSO' ? `Sun-synchronous ${h.toFixed(0)} km` : `Circular LEO ${h.toFixed(0)} km`;
      if (inp.family === 'SSO') { inc = ssoInclinationDeg(h); notes.push(`J2 nodal precession matches the Sun's 0.9856°/day at i = ${inc.toFixed(2)}°.`); }
      const a = R_EARTH + h;
      periodMin = periodS(a) / 60;
      ecl = eclipseFractionCircular(h, inp.betaDeg);
      eclMax = eclipseFractionCircular(h, 0) * periodMin;
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Includes ~1.5 km/s gravity & drag losses (provided by the rocket).' });
      if (h > 210) {
        const at = (parkR + a) / 2;
        m.push({ name: 'Hohmann burn 1 (raise apogee)', dv: 1000 * (vEllipse(parkR, at) - vPark), note: 'Usually done by the upper stage.' });
        m.push({ name: 'Hohmann burn 2 (circularize)', dv: 1000 * (vCirc(a) - vEllipse(a, at)), note: '' });
      }
      if (Math.abs(inc - inp.launchLatDeg) > 0.5 && inc < inp.launchLatDeg) m.push({ name: `Plane change ${inp.launchLatDeg}° → ${inc.toFixed(1)}°`, dv: 1000 * planeChange(vCirc(a), inp.launchLatDeg - inc), note: 'You cannot launch directly into an inclination lower than your latitude.' });
      m.push({ name: 'Deorbit to 25-yr decay perigee (disposal)', dv: h > 600 ? 1000 * (vCirc(a) - vEllipse(a, (a + R_EARTH + 300) / 2)) : 0, note: h > 600 ? 'Above ~600 km natural decay exceeds 25 years.' : 'Natural decay below ~600 km.' });
      pass(h); range = Math.sqrt((R_EARTH + h) ** 2 - (R_EARTH * Math.cos(inp.minElevDeg * DEG)) ** 2) - R_EARTH * Math.sin(inp.minElevDeg * DEG);
      break;
    }
    case 'GTO': case 'GEO': {
      const rGeo = 42164;
      const at = (parkR + rGeo) / 2;
      label = inp.family === 'GEO' ? 'Geostationary 35,786 km' : 'Geostationary transfer 200 × 35,786 km';
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Rocket.' });
      m.push({ name: 'GTO injection (perigee burn)', dv: 1000 * (vEllipse(parkR, at) - vPark), note: 'Rocket upper stage.' });
      const vApo = vEllipse(rGeo, at);
      const dvCirc = Math.sqrt(vApo ** 2 + vCirc(rGeo) ** 2 - 2 * vApo * vCirc(rGeo) * Math.cos(inp.launchLatDeg * DEG));
      if (inp.family === 'GEO') {
        m.push({ name: `Apogee burn: circularize + remove ${inp.launchLatDeg}° inclination`, dv: 1000 * dvCirc, note: 'Combined burn at apogee where the spacecraft is slowest.' });
        m.push({ name: 'Station-keeping (N-S + E-W), per year', dv: 50, note: 'Sun/Moon perturbations tilt the orbit ~0.9°/yr.' });
        m.push({ name: 'Graveyard orbit +300 km', dv: 11, note: 'IADC disposal.' });
        periodMin = 1436.1; ecl = 0.01; eclMax = 72; range = 37500; inc = 0;
        contactNote = 'Continuous contact with one station in view of the sub-satellite point.';
        windowNote = 'Daily windows; eclipse seasons only around the equinoxes (≤ 72 min/day).';
      } else {
        periodMin = periodS(at) / 60; ecl = 0.06; eclMax = 60; range = 25000; inc = inp.launchLatDeg;
        notes.push('GTO crosses the Van Allen belts twice per orbit — radiation dose ~40 krad/yr behind 2.5 mm Al.');
        contactNote = 'Long apogee dwell gives ~70% visibility; fast perigee passes.';
      }
      break;
    }
    case 'HEO': {
      const rp = R_EARTH + Math.max(200, inp.altitudeKm), ra = R_EARTH + Math.max(inp.apogeeKm, inp.altitudeKm + 1000);
      const a = (rp + ra) / 2;
      inc = 63.4;
      label = `Molniya-type HEO ${Math.round(rp - R_EARTH)} × ${Math.round(ra - R_EARTH)} km, i = 63.4°`;
      periodMin = periodS(a) / 60;
      notes.push('At the critical inclination 63.4° J2 does not rotate the apsides, so apogee stays over the northern hemisphere.');
      notes.push(`Period ${periodMin.toFixed(0)} min ≈ ${(periodMin / (SIDEREAL_DAY_S / 60)).toFixed(2)} sidereal days.`);
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Rocket.' });
      m.push({ name: 'Perigee burn to HEO', dv: 1000 * (vEllipse(parkR, (parkR + ra) / 2) - vPark), note: 'Rocket upper stage.' });
      if (rp > parkR + 10) m.push({ name: 'Raise perigee at apogee', dv: 1000 * (vEllipse(ra, a) - vEllipse(ra, (parkR + ra) / 2)), note: 'Spacecraft.' });
      m.push({ name: 'Station-keeping, per year', dv: 20, note: 'Lunisolar perturbations.' });
      ecl = 0.02; eclMax = 50; range = ra - R_EARTH;
      contactNote = '~8 h of the 12 h orbit are spent near apogee: long passes for high-latitude stations.';
      break;
    }
    case 'TLI': case 'LLO': case 'NRHO': {
      const vTli = vEllipse(parkR, (parkR + MOON_DIST) / 2) - vPark;
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Rocket.' });
      m.push({ name: 'Trans-Lunar Injection (TLI)', dv: 1000 * vTli, note: 'C3 ≈ −2 km²/s².' });
      c3 = -2; tof = 4.5; range = MOON_DIST;
      windowNote = 'Lunar windows open a few days each month; an average wait of ~1–2 weeks.';
      waitDays = 10;
      if (inp.family === 'LLO') {
        const r = R_MOON + Math.max(20, inp.altitudeKm);
        label = `Low lunar orbit ${Math.round(r - R_MOON)} km (polar)`;
        const vArr = 0.85;
        m.push({ name: 'Lunar Orbit Insertion (LOI)', dv: 1000 * (Math.sqrt(vArr ** 2 + 2 * MU_MOON / r) - vCirc(r, MU_MOON)), note: 'Capture into a circular polar orbit.' });
        m.push({ name: 'Station-keeping vs. mascons, per year', dv: 90, note: 'Lumpy lunar gravity decays low orbits.' });
        periodMin = periodS(r, MU_MOON) / 60;
        ecl = eclipseFractionCircular(r - R_MOON, inp.betaDeg, R_MOON);
        eclMax = eclipseFractionCircular(r - R_MOON, 0, R_MOON) * periodMin;
        inc = 90;
        contactNote = 'The Moon hides the spacecraft ~40% of each 2-hour orbit; DSN/commercial stations track the Moon ~8–12 h per site.';
      } else if (inp.family === 'NRHO') {
        label = 'Near-Rectilinear Halo Orbit (Gateway 9:2 NRHO)';
        m.push({ name: 'NRHO insertion (direct transfer)', dv: 450, note: 'A low-energy ballistic transfer can cut this to tens of m/s at the cost of ~3 months.' });
        m.push({ name: 'Orbit maintenance, per year', dv: 10, note: '' });
        periodMin = 6.56 * 1440; ecl = 0; eclMax = 0;
        notes.push('Nearly continuous Earth visibility and almost no eclipses — the reason Gateway uses it.');
        contactNote = 'Near-continuous Earth view; Earth rotation limits each station to ~8–12 h/day.';
      } else {
        label = 'Trans-Lunar trajectory'; contactNote = 'Deep-space tracking during the 4–5 day coast.';
      }
      break;
    }
    case 'L1': case 'L2': {
      label = inp.family === 'L1' ? 'Sun–Earth L1 halo (sunward, 1.5 Mkm)' : 'Sun–Earth L2 halo (anti-sunward, 1.5 Mkm)';
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Rocket.' });
      m.push({ name: 'Libration-point transfer injection', dv: 3200, note: 'C3 ≈ −0.7 km²/s².' });
      m.push({ name: 'Mid-course corrections + halo insertion', dv: 60, note: '' });
      m.push({ name: 'Station-keeping, per year', dv: 3, note: 'Halo orbits are unstable — small burns every few weeks.' });
      m.push({ name: 'Disposal to heliocentric orbit', dv: 2, note: '' });
      c3 = -0.7; tof = inp.family === 'L2' ? 30 : 100; periodMin = 180 * 1440; ecl = 0; range = 1.5e6;
      notes.push(inp.family === 'L2' ? 'Sun, Earth and Moon stay on one side: one sunshield keeps a telescope cold (JWST, Roman).' : 'Sees solar-wind structures ~1 h before they reach Earth (DSCOVR, ACE).');
      contactNote = 'Each DSN / commercial station sees the spacecraft ~8–12 h/day; three sites give continuous coverage.';
      break;
    }
    case 'INTERPLANETARY': {
      const t = TARGETS[inp.target];
      const hh = helioHohmann(AU, t.aAU * AU);
      const rp = parkR;
      const dep = Math.sqrt(hh.vInfDep ** 2 + 2 * MU_EARTH / rp) - vCirc(rp);
      c3 = hh.vInfDep ** 2; tof = hh.tofDays;
      label = `Hohmann transfer Earth → ${t.name}`;
      m.push({ name: 'Ascent to 200 km parking orbit', dv: 9300, note: 'Rocket.' });
      m.push({ name: `Departure burn (v∞ ${hh.vInfDep.toFixed(2)} km/s)`, dv: 1000 * dep, note: `C3 = ${c3.toFixed(1)} km²/s².` });
      if (t.electricRendezvous) {
        m.push({ name: 'Low-thrust rendezvous (electric propulsion)', dv: 1000 * hh.vInfArr * 1.15, note: 'Dawn and Psyche spiral in with ion/Hall thrusters instead of a capture burn.' });
      } else {
        const r = t.R + t.captureAltKm;
        m.push({ name: `${t.name} orbit insertion`, dv: 1000 * (Math.sqrt(hh.vInfArr ** 2 + 2 * t.mu / r) - vCirc(r, t.mu)), note: inp.target === 'jupiter' ? 'Gravity assists (VEEGA / Mars–Earth) reduce launch C3 in practice.' : 'Aerobraking can replace part of this at Mars.' });
      }
      const syn = synodicDays(1, t.aAU);
      waitDays = syn / 2;
      windowNote = `Windows repeat every synodic period (${(syn / 30.44).toFixed(1)} months); an average wait of ~${(waitDays / 30.44).toFixed(1)} months.`;
      range = (t.aAU + 1) * AU * 0.75;
      periodMin = null; ecl = 0;
      contactNote = 'DSN 34 m / 70 m only; light time sets the command loop.';
      break;
    }
  }
  const dvSpacecraft = m.filter((x) => !/Ascent|Hohmann burn 1|GTO injection|Perigee burn to HEO|Trans-Lunar Injection|transfer injection|Departure burn/.test(x.name)).reduce((s, x) => s + x.dv, 0);
  const dvTotal = m.reduce((s, x) => s + x.dv, 0);
  if (inp.family === 'LEO' || inp.family === 'SSO') {
    waitDays = 0.5;
    if (inp.family === 'SSO') windowNote = 'One instantaneous window per day (to hit the right local time of the node).';
  }
  return {
    label, periodMin, eclipseFrac: ecl, eclipseMaxMin: eclMax, maneuvers: m.map((x) => ({ ...x, dv: Math.max(0, x.dv) })), dvTotal,
    propellantKg: propellantKg(dvSpacecraft, inp.dryKg, inp.ispS), c3, transferDays: tof, windowWaitDays: waitDays, windowNote,
    passMinutes: passMin, passesPerDay: passes, contactNote, rangeKm: range, lightTimeS: range / C_KMS, inclinationDeg: inc, notes,
  };
}

/** Map a game orbit id to the planner's family + defaults. */
export function gmatFromOrbit(orbitId: string, altKm: number, ltan: 'day' | 'dawn-dusk'): Partial<GmatInput> {
  switch (orbitId) {
    case 'leo': return { family: 'LEO', altitudeKm: altKm, inclinationDeg: 51.6, betaDeg: 20 };
    case 'iss': return { family: 'LEO', altitudeKm: altKm, inclinationDeg: 51.6, betaDeg: 20 };
    case 'sso': return { family: 'SSO', altitudeKm: altKm, betaDeg: ltan === 'dawn-dusk' ? 75 : 22 };
    case 'gto': return { family: 'GTO' };
    case 'geo': return { family: 'GEO' };
    case 'llo': return { family: 'LLO', altitudeKm: altKm, betaDeg: 0 };
    case 'l1': return { family: 'L1' };
    case 'l2': return { family: 'L2' };
    case 'jupiter': return { family: 'INTERPLANETARY', target: 'jupiter' };
    default: return {};
  }
}

// ── 3D path sampling (shared by the Mission Viz viewport) ────────────────────
export type Vec3 = [number, number, number];

/** Point on a Keplerian ellipse (km), focus at origin, perifocal frame rotated by i, Ω, ω. */
export function keplerPoint(a: number, e: number, iDeg: number, raanDeg: number, argpDeg: number, nu: number): Vec3 {
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(nu));
  const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
  const i = iDeg * DEG, O = raanDeg * DEG, w = argpDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const z = (sw * si) * xp + (cw * si) * yp;
  return [x, z, -y];          // y-up scene convention
}

/** True anomaly from mean anomaly (Newton on Kepler's equation). */
export function trueAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

export function sampleEllipse(a: number, e: number, iDeg: number, raanDeg: number, argpDeg: number, n = 180): Vec3[] {
  const pts: Vec3[] = [];
  for (let k = 0; k <= n; k++) pts.push(keplerPoint(a, e, iDeg, raanDeg, argpDeg, (2 * Math.PI * k) / n));
  return pts;
}

/** Lissajous-style halo around a libration point (km offsets). */
export function sampleHalo(Ay = 700000, Az = 400000, n = 200): Vec3[] {
  const pts: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    pts.push([0.25 * Ay * Math.cos(t), Az * Math.sin(t), Ay * Math.sin(t)]);
  }
  return pts;
}
