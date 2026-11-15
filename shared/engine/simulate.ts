// ─────────────────────────────────────────────────────────────────────────────
// Time-stepped mission simulator.
// One step = `dt` days for every spacecraft in the fleet: radiation dose, component
// failures (exponential hazards + radiation + wear-out), power balance across
// eclipse with load shedding, battery fade, data generation → onboard queues →
// downlink, orbit decay / station-keeping propellant, random anomalies and
// operator decisions. Deterministic for a given (design, seed, decisions).
// ─────────────────────────────────────────────────────────────────────────────
import { COMPONENT_MAP } from '../data/components';
import { DIFFICULTY_MAP, GN_MAP, LV_MAP, OBJECTIVE_MAP, ORBIT_MAP } from '../data/mission';
import type {
  AnomalyChoice, DesignModifiers, MissionDesign, PendingDecision, ResourceState, SimEventRecord, SimResult, SpacecraftComponent, Status, TelemetryPoint,
} from '../types';
import {
  AU_KM, BATTERY_EFF, LINK_EFF, NO_MODS, X_D, X_E, computeLink, computeResources, decayRateKmPerDay, doseRateKradPerYear, dragAccel,
  fmt, hashSeed, instrumentGeometry, instrumentShield, orbitAltitude, orbitGeometry, propellantFor, type OrbitGeometry,
} from './physics';
import { Rng } from './rng';

interface Unit {
  comp: SpacecraftComponent;
  alive: boolean;
  lambda: number;           // base failure rate per year
  shield: number;
  health: number;           // instruments: performance 0..1
  failAtDay?: number;       // scheduled failure (from a decision)
  offUntil?: number;        // temporarily off (bake-out)
}

interface Craft {
  idx: number;
  alive: boolean;
  lostReason?: string;
  lostDay?: number;
  units: Unit[];
  dose: number;
  propellant: number;
  dryKg: number;
  altitude: number;
  batteryFade: number;      // multiplier on battery capacity
  arrayDamage: number;      // multiplier on array output
  safeUntil: number;
  powerDeathDays: number;
  noSkDays: number;
  twoWheel: boolean;
  instrMult: number;
}

interface DecisionCtx {
  pending: PendingDecision;
  apply: (choice: string) => string;     // returns log text
}

export interface SimOptions {
  seed: string;
  decisions?: string[];
  autoDecide?: boolean;
  stepDays?: number;
  telemetryPoints?: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class MissionSimulator {
  readonly design: MissionDesign;
  readonly res: ResourceState;
  readonly totalDays: number;
  readonly cruiseDays: number;
  day = 0;
  done = false;
  pending: PendingDecision | null = null;
  decisionsMade: string[] = [];

  private rng: Rng;
  private opts: Required<SimOptions>;
  private fleet: Craft[] = [];
  private geo: OrbitGeometry;
  private events: SimEventRecord[] = [];
  private telemetry: TelemetryPoint[] = [];
  private recordEvery: number;
  private bufBulk = 0; private bufPri = 0; private sciBulk = 0; private sciPri = 0;
  private science = 0; private scienceDays = 0; private dataLost = 0; private dataReturned = 0; private dataGen = 0;
  private opsCost = 0; private anomalyCost = 0; private anomalies = 0; private survived = 0;
  private firstOverflow: number | null = null; private safeModeDays = 0;
  private lastDecisionDay = -999;
  private decisionIndex = 0;
  private ctx: DecisionCtx | null = null;
  private outageUntil = -1;
  private stormUntil = -1;
  private contactMult = 1;
  private instrBudgetMult = 1;
  private softwarePatched = false;
  private reservesLeft: number;
  private endReason = '';
  private launchDelay = 0;
  private insertionDone = false;
  private lastRate = 0;
  private covCache = new Map<number, number>();
  private baseSci: { unitIndex: number; perYear: number; rateMbps: number; duty: number; pduty: number; priority: boolean }[] = [];
  private synergy = 1;

  constructor(design: MissionDesign, mods: DesignModifiers = NO_MODS, opts: SimOptions) {
    this.design = design;
    this.res = computeResources(design, mods);
    this.opts = { decisions: [], autoDecide: false, stepDays: 1, telemetryPoints: 320, ...opts };
    this.rng = new Rng(`${opts.seed}|sim|${design.scenarioSeed}`);
    const orbit = ORBIT_MAP[design.orbit.id];
    this.geo = orbitGeometry(design, GN_MAP[design.groundNetworkId]);
    this.cruiseDays = Math.round(orbit.cruiseYears * 365);
    this.totalDays = this.cruiseDays + Math.round(design.missionYears * 365);
    this.recordEvery = Math.max(1, Math.round(this.totalDays / this.opts.telemetryPoints));
    this.reservesLeft = this.res.cost.reserves;
    const h = orbitAltitude(design);
    const shield = COMPONENT_MAP[design.busId]?.specs.shieldFactor ?? 1;
    for (let i = 0; i < Math.max(1, design.fleetSize); i++) {
      const units: Unit[] = [];
      const bus = COMPONENT_MAP[design.busId];
      units.push({ comp: bus, alive: true, lambda: -Math.log(bus.reliability) / 5, shield, health: 1 });
      for (const sel of design.components) {
        const comp = COMPONENT_MAP[sel.id];
        if (!comp) continue;
        for (let q = 0; q < sel.qty; q++) {
          units.push({ comp, alive: true, lambda: -Math.log(comp.reliability) / 5, shield: comp.category === 'instrument' ? instrumentShield(shield) : shield, health: 1 });
        }
      }
      this.fleet.push({ idx: i, alive: true, units, dose: 0, propellant: this.res.mass.propellantKg, dryKg: this.res.mass.dryKg + this.res.mass.contingencyKg,
        altitude: h, batteryFade: 1, arrayDamage: 1, safeUntil: -1, powerDeathDays: 0, noSkDays: 0, twoWheel: false, instrMult: 1 });
    }
    this.prepareScience();
    this.launch();
  }

  // ── Science bookkeeping ────────────────────────────────────────────────────
  private prepareScience() {
    const obj = OBJECTIVE_MAP[this.design.objectiveId];
    const orbit = ORBIT_MAP[this.design.orbit.id];
    const orbitF = obj.orbitSuitability[orbit.family] ?? 0;
    const kinds = new Set<string>();
    const seen: Record<string, number> = {};
    const units = this.fleet[0].units;
    const h = orbitAltitude(this.design);
    const realtime = obj.realtimeHoursReq ? Math.min(1, this.geo.contactMinPerDay / 60 / obj.realtimeHoursReq) : 1;
    const daylightScale = clamp((1 - this.geo.eclipseFrac) / 0.62, 0.3, 1.4);
    units.forEach((u, idx) => {
      if (u.comp.category !== 'instrument') return;
      const kind = u.comp.specs.kind!;
      kinds.add(kind);
      const dup = (seen[kind] = (seen[kind] ?? 0) + 1);
      const dupF = dup === 1 ? 1 : dup === 2 ? 0.5 : 0.25;
      const g = instrumentGeometry(u.comp, this.design, this.geo, h, 1);
      const pointReq = u.comp.specs.pointingReqDeg;
      const pf = pointReq && this.res.pointing.achievedDeg > pointReq ? Math.sqrt(pointReq / this.res.pointing.achievedDeg) : 1;
      const rel = obj.instrumentWeights[kind] ?? 0;
      const td = obj.targetDutyFamilies?.includes(kind as never) && orbit.family === 'JUPITER' ? 0.002 : 1;
      const pduty = clamp((u.comp.specs.dutyCycle ?? 1) * (u.comp.specs.needsDaylight ? daylightScale : 1) * td, 0, 1);
      const duty = pduty * (u.comp.data_rate_mbps > 0.5 ? orbit.dataDuty ?? 1 : 1);
      // coverage handled fleet-wide; strip it here (g.cov at n=1 is recomputed per working count)
      const chainF = this.res.chain?.mult[u.comp.id] ?? 1;
      this.baseSci.push({ unitIndex: idx, perYear: u.comp.science_points * rel * orbitF * g.res * pf * dupF * realtime * chainF, rateMbps: u.comp.data_rate_mbps, duty, pduty, priority: u.comp.data_rate_mbps < 1 });
    });
    for (const s of obj.synergy ?? []) if (s.kinds.every((k) => kinds.has(k))) this.synergy += s.bonus;
  }

  private coverage(nWorking: number): number {
    if (this.covCache.has(nWorking)) return this.covCache.get(nWorking)!;
    const obj = OBJECTIVE_MAP[this.design.objectiveId];
    const h = orbitAltitude(this.design);
    let num = 0, den = 0;
    for (const s of this.baseSci) {
      const u = this.fleet[0].units[s.unitIndex];
      const g = instrumentGeometry(u.comp, this.design, this.geo, h, Math.max(1, nWorking));
      num += g.cov * s.perYear; den += s.perYear;
    }
    let c = den > 0 ? num / den : 1;
    const fleetF = obj.revisitReqDays ? 1 + 0.12 * (nWorking - 1) : Math.pow(nWorking, 0.6);
    c *= fleetF;
    this.covCache.set(nWorking, c);
    return c;
  }

  // ── Events & logging ───────────────────────────────────────────────────────
  private log(kind: string, title: string, text: string, severity: Status = 'warn', decision?: string) {
    this.events.push({ day: this.day, kind, title, text, severity, decision });
  }

  private lose(c: Craft, reason: string) {
    if (!c.alive) return;
    c.alive = false; c.lostReason = reason; c.lostDay = this.day;
    const n = this.fleet.length;
    this.log('loss', n > 1 ? `Spacecraft ${c.idx + 1} lost` : 'Spacecraft lost', reason, 'crit');
  }

  private launch() {
    const lv = LV_MAP[this.design.launchVehicleId];
    const launches = Math.max(1, this.res.mass.launchesNeeded);
    if (this.rng.chance(0.25)) {
      this.launchDelay = this.rng.int(1, 12);
      this.log('launch_scrub', 'Launch scrubbed', `Weather and a ground-system issue delayed launch by ${this.launchDelay} days. Teams standing by cost money.`, 'ok');
      this.opsCost += (this.res.cost.development * 0.0005) * this.launchDelay;
    }
    const perLaunch = Math.ceil(this.fleet.length / launches);
    for (let l = 0; l < launches; l++) {
      if (!this.rng.chance(lv.reliability)) {
        for (let i = l * perLaunch; i < Math.min(this.fleet.length, (l + 1) * perLaunch); i++) this.lose(this.fleet[i], `${lv.name} launch failure.`);
      }
    }
    for (const c of this.fleet) {
      if (!c.alive) continue;
      const bus = COMPONENT_MAP[this.design.busId];
      if (!this.rng.chance(clamp(bus.specs.deploySuccess ?? 0.97, 0.05, 0.995))) this.lose(c, 'Failed during deployment (no signal after separation).');
    }
    const alive = this.fleet.filter((c) => c.alive).length;
    if (alive) this.log('launch', 'Launch & deployment', `${lv.name} delivered ${alive}/${this.fleet.length} spacecraft. Systems check complete.`, 'ok');
    if (!alive) { this.finish(this.fleet.length === 1 ? this.fleet[0].lostReason ?? 'Lost at launch.' : 'Every spacecraft was lost at launch or deployment.'); return; }
  }

  private finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.endReason = reason;
    this.record(true);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  /** Advance up to `maxDays`. Stops early when a decision is needed or the mission ends. */
  step(maxDays = 1) {
    let n = 0;
    while (!this.done && !this.pending && n < maxDays) {
      this.tick();
      n += this.opts.stepDays;
    }
  }

  runToEnd() { while (!this.done) { this.step(1e6); if (this.pending) this.decide(this.pending.choices.find((c) => c.id === this.pending!.recommended)!.id); } }

  decide(choiceId: string) {
    if (!this.ctx || !this.pending) return;
    const ok = this.pending.choices.some((c) => c.id === choiceId) ? choiceId : this.pending.recommended;
    const text = this.ctx.apply(ok);
    const label = this.pending.choices.find((c) => c.id === ok)!.label;
    this.log(this.pending.kind, `Decision: ${label}`, text, 'ok', ok);
    this.decisionsMade.push(ok);
    this.pending = null;
    this.ctx = null;
  }

  private requestDecision(kind: string, title: string, text: string, choices: AnomalyChoice[], recommended: string, apply: (c: string) => string) {
    this.anomalies++;
    const pending: PendingDecision = { index: this.decisionIndex++, day: this.day, kind, title, text, choices, recommended };
    this.log(kind, title, text, 'warn');
    this.lastDecisionDay = this.day;
    const pre = this.opts.decisions[pending.index];
    this.ctx = { pending, apply };
    this.pending = pending;
    if (pre !== undefined) this.decide(pre);
    else if (this.opts.autoDecide) this.decide(recommended);
  }

  // ── One time step ──────────────────────────────────────────────────────────
  private tick() {
    const dt = this.opts.stepDays;
    const design = this.design;
    const res = this.res;
    const orbit = ORBIT_MAP[design.orbit.id];
    const obj = OBJECTIVE_MAP[design.objectiveId];
    const diff = DIFFICULTY_MAP[design.difficulty];
    const gn = GN_MAP[design.groundNetworkId];
    this.day += dt;
    const day = this.day;
    const tYears = day / 365;
    const inCruise = day <= this.cruiseDays;
    const scienceT = Math.max(0, (day - this.cruiseDays) / 365);
    const busLife = COMPONENT_MAP[design.busId].specs.designLifeYears ?? 5;

    // Orbit insertion at end of cruise (or immediately for short transfers)
    if (!this.insertionDone && (day >= this.cruiseDays || this.cruiseDays === 0)) {
      this.insertionDone = true;
      if (orbit.insertionDvMs > 0) {
        for (const c of this.fleet) {
          if (!c.alive) continue;
          const prop = c.units.filter((u) => u.alive && u.comp.category === 'propulsion' && !!u.comp.specs.ispS && (u.comp.specs.chemical || !orbit.insertionNeedsChemical));
          if (!prop.length) { this.lose(c, `Missed ${orbit.name} insertion: propulsion had failed.`); continue; }
          if (!this.rng.chance(0.99)) { this.lose(c, 'Orbit insertion burn anomaly — the spacecraft flew past its target.'); continue; }
          const ins = Math.min(c.propellant, propellantFor(orbit.insertionDvMs * (prop.some((p) => p.comp.specs.chemical) ? 1 : orbit.lowThrustFactor ?? 1.8), c.dryKg + Math.max(0, c.propellant - propellantFor(orbit.insertionDvMs, c.dryKg, prop[0].comp.specs.ispS!)), prop[0].comp.specs.ispS!));
          c.propellant -= ins;
        }
        const ok = this.fleet.filter((c) => c.alive).length;
        if (ok) this.log('insertion', 'Orbit insertion', `${ok} spacecraft captured into ${orbit.name}. Science operations begin.`, 'ok');
      }
    }

    const alive = this.fleet.filter((c) => c.alive);
    if (!alive.length) { this.finish(this.fleet.every((c) => c.lostDay === this.fleet[0].lostDay) ? this.fleet[0].lostReason ?? 'All spacecraft lost.' : 'All spacecraft lost.'); return; }

    // Environment
    const sunAU = inCruise && this.cruiseDays > 0 ? 1 + (orbit.distanceFromSunAU - 1) * (day / this.cruiseDays) : orbit.distanceFromSunAU;
    const flux = 1 / (sunAU * sunAU);
    const doseRate = inCruise && this.cruiseDays > 0 ? 1.5 : doseRateKradPerYear(orbit, orbitAltitude(design));
    const solarActivity = 0.5 + 0.5 * Math.sin((2 * Math.PI * (tYears + (hashSeed(design.scenarioSeed) % 11))) / 11);
    let rangeKm = this.geo.rangeKm;
    const SYNODIC: Partial<Record<string, number>> = { JUPITER: 398.9, MARS: 779.9, ASTEROID: 504 };
    if (SYNODIC[orbit.family]) {
      const theta = (2 * Math.PI * day) / SYNODIC[orbit.family]!;
      const r1 = 1, r2 = orbit.distanceFromSunAU;
      rangeKm = inCruise ? Math.max(0.5, sunAU - 1 + 0.5) * AU_KM : Math.sqrt(r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(theta)) * AU_KM;
    } else if (orbit.family === 'LUNAR') rangeKm = 384400 + 25000 * Math.sin((2 * Math.PI * day) / 27.3);
    else if (inCruise && this.cruiseDays > 0) rangeKm = Math.max(this.geo.rangeKm * 0.3, this.geo.rangeKm * (day / this.cruiseDays));

    const densityMult = (0.6 + 1.6 * solarActivity) * (day < this.stormUntil ? 4 : 1);
    let workingForCoverage = 0;
    let genGbTotal = 0, genPri = 0, genBulk = 0, downCapacityGb = 0, incPri = 0, incBulk = 0;
    let powerGenSum = 0, powerLoadSum = 0, socSum = 0, healthSum = 0, healthN = 0, rateSum = 0;
    const realtimeObjective = !!obj.realtimeHoursReq;

    for (const c of alive) {
      // ── Radiation & failures ──
      c.dose += (doseRate * dt) / 365;
      const ageY = tYears;
      for (const u of c.units) {
        if (!u.alive) continue;
        if (u.failAtDay !== undefined && day >= u.failAtDay) { this.failUnit(c, u, 'as feared after the earlier anomaly'); continue; }
        let lam = u.lambda * (inCruise && u.comp.category === 'instrument' ? 0.3 : 1);
        const tid = u.comp.specs.tidKrad;
        if (tid) {
          const D = c.dose / u.shield;
          if (D > tid) lam += 0.8 + 6 * (D / tid - 1);
          else if (D > 0.8 * tid) lam *= 3;
        }
        if (u.comp.specs.adcsType === 'wheel' && ageY > 4) lam *= 1 + (ageY - 4) * 0.5;
        if (ageY > busLife) lam *= 1 + ((ageY - busLife) / busLife) * 2;
        if (this.rng.next() < 1 - Math.exp(-lam * dt / 365)) this.failUnit(c, u, '');
      }
      if (!c.alive) continue;

      // ── Subsystem state ──
      const U = c.units.filter((u) => u.alive);
      const has = (pred: (u: Unit) => boolean) => U.some(pred);
      if (!has((u) => !!u.comp.specs.isObc)) { this.lose(c, 'All flight computers failed — the spacecraft can no longer be commanded.'); continue; }
      if (!has((u) => u.comp.category === 'bus')) { this.lose(c, 'Structural/bus failure.'); continue; }
      const comms = U.filter((u) => u.comp.category === 'comms');
      if (!comms.length) { this.lose(c, 'All radios failed — contact lost.'); continue; }
      const wheels = U.filter((u) => u.comp.specs.adcsType === 'wheel').length;
      const integrated = has((u) => u.comp.specs.adcsType === 'integrated');
      const st = U.filter((u) => u.comp.specs.adcsType === 'startracker');
      const hadWheels = res.pointing.achievedDeg <= 0.1 && c.units.some((u) => u.comp.specs.adcsType === 'wheel');
      if (hadWheels && wheels < 3 && !c.twoWheel) {
        c.twoWheel = true;
        this.log('adcs', 'Two-wheel mode', `Only ${wheels} reaction wheel(s) left. Engineers improvised thruster-assisted pointing (like Kepler's K2 mission): pointing degrades and propellant use rises.`, 'warn');
      }
      const propUnits = U.filter((u) => u.comp.category === 'propulsion' && !!u.comp.specs.ispS);
      const prop = propUnits.length > 0 && c.propellant > 0.01;
      let pointing = 5;
      if (integrated) pointing = 0.5;
      if (wheels >= 3) pointing = 0.1;
      else if (c.twoWheel) pointing = prop ? 0.3 : 2;
      if (st.length && (wheels >= 3 || integrated)) pointing = Math.max(Math.min(...st.map((u) => u.comp.specs.pointingDeg ?? 0.05)), wheels >= 3 ? 0.01 : 0.05);
      const needsDumps = orbit.central !== 'earth' || orbit.family === 'GEO' || orbit.family === 'GTO';
      const hasMtq = has((u) => u.comp.specs.adcsType === 'magnetorquer') || integrated;
      if (wheels >= 3 && (needsDumps || !hasMtq) && !prop) pointing = Math.max(pointing, 2); // saturated wheels

      // ── Station-keeping & orbit ──
      const ispUnit = propUnits.length ? propUnits.reduce((a, b) => ((b.comp.specs.ispS ?? 0) > (a.comp.specs.ispS ?? 0) ? b : a)) : null;
      const wet = c.dryKg + c.propellant;
      if (!inCruise) {
        if (orbit.family === 'LEO' || orbit.family === 'SSO') {
          const dragArea = (COMPONENT_MAP[design.busId].specs.dragAreaM2 ?? 1) + U.filter((u) => u.comp.specs.arrayAreaM2).reduce((a, u) => a + (u.comp.specs.arrayAreaM2 ?? 0) * 0.3, 0);
          const B = (2.2 * dragArea) / wet;
          if (prop && ispUnit) {
            const dv = dragAccel(c.altitude, B, densityMult) * dt * 86400 * 1.0;
            const mp = propellantFor(dv, c.dryKg + Math.max(0, c.propellant), ispUnit.comp.specs.ispS!);
            c.propellant = Math.max(0, c.propellant - mp);
          } else {
            c.altitude -= decayRateKmPerDay(c.altitude, B, densityMult) * dt;
            if (c.altitude < 200) { this.lose(c, `Orbit decayed and the spacecraft re-entered the atmosphere (drag at ${fmt(orbitAltitude(design), 0)} km${propUnits.length ? ' after propellant ran out' : ' with no propulsion'}).`); continue; }
          }
        } else {
          let skDv = orbit.stationKeepingDvPerYear;
          if (orbit.family === 'LUNAR') skDv *= Math.pow(100 / orbitAltitude(design), 1.3);
          if (wheels >= 3 && needsDumps) skDv += 2;
          if (c.twoWheel) skDv += 3;
          if (prop && ispUnit) {
            const mp = propellantFor((skDv * dt) / 365, c.dryKg + c.propellant, ispUnit.comp.specs.ispS!);
            c.propellant = Math.max(0, c.propellant - mp);
            c.noSkDays = 0;
          } else if (orbit.family === 'L1' || orbit.family === 'LUNAR' || orbit.family === 'JUPITER') {
            c.noSkDays += dt;
            const limit = orbit.family === 'LUNAR' ? 365 * 0.3 * (orbitAltitude(design) / 50) : orbit.family === 'L1' ? 180 : 60;
            if (c.noSkDays > limit) {
              this.lose(c, orbit.family === 'LUNAR' ? 'Without station-keeping, lunar mascons pulled the orbit down until the spacecraft impacted the Moon.'
                : orbit.family === 'L1' ? 'Without station-keeping the spacecraft drifted off the unstable L1 halo orbit.' : 'Without propulsion the Europa flyby tour could not be maintained.');
              continue;
            }
          }
        }
      }

      // ── Power ──
      const solar = U.filter((u) => u.comp.category === 'power' && u.comp.specs.source === 'solar');
      const rtg = U.filter((u) => u.comp.category === 'power' && u.comp.specs.source === 'rtg');
      const cosF = (u: Unit) => u.comp.specs.cosFactor ?? (u.comp.id === 'pwr_body' ? 0.35 : u.comp.id === 'pwr_cubewing' ? 0.75 : 0.95);
      const radDeg = clamp(1 + doseRate / 20, 1, 2.5);
      let solarW = 0;
      for (const u of solar) solarW += u.comp.specs.generationW! * cosF(u) * flux * (sunAU > 3 ? u.comp.specs.liltFactor ?? 0.65 : 1) * Math.pow(1 - u.comp.specs.degradationPerYear! * (inCruise ? 1 : radDeg), tYears);
      solarW *= c.arrayDamage;
      let rtgW = 0;
      for (const u of rtg) rtgW += u.comp.specs.generationW! * Math.pow(1 - u.comp.specs.degradationPerYear!, tYears);
      const safe = day < c.safeUntil;
      let always = 0, wheelsOn = 0, obcOn = 0;
      for (const u of U) {
        const k = u.comp.category;
        if (u.comp.specs.adcsType === 'wheel') always += u.comp.power_watts * (wheelsOn++ < 3 ? 1 : 0.25);   // 4th+ wheel is a cold spare
        else if (u.comp.specs.isObc) always += u.comp.power_watts * (obcOn++ < 1 ? 1 : 0.1);              // redundant computer idles
        else if (k === 'bus' || k === 'computer' || k === 'adcs' || k === 'thermal') always += u.comp.power_watts;
        else if (k === 'propulsion' && u.comp.specs.chemical) always += u.comp.power_watts * 0.5;
      }
      const heater = res.power.heaterW;
      const contactFrac = clamp((this.geo.contactMinPerDay * this.contactMult) / 1440, 0, 1);
      const bestComm = comms.reduce((a, b) => (b.comp.power_watts > a.comp.power_watts ? b : a));
      const commsW = bestComm.comp.power_watts * (0.15 + 0.85 * contactFrac);
      let instrSun = 0, instrEcl = 0;
      for (const s of this.baseSci) {
        const u = c.units[s.unitIndex];
        if (!u.alive || (u.offUntil ?? 0) > day) continue;
        const p = u.comp.power_watts * s.pduty;
        instrSun += u.comp.specs.needsDaylight ? Math.min(u.comp.power_watts, p / Math.max(0.3, 1 - this.geo.eclipseFrac)) : p;
        if (!u.comp.specs.needsDaylight) instrEcl += p;
      }
      const hotF = clamp(1 - orbit.hotFluxWPerM2 / 100, 0.3, 1);
      const f = inCruise ? 0 : this.geo.eclipseFrac;
      const Td = (1 - f) * Math.max(this.geo.periodMin, 1), Te = f * Math.max(this.geo.periodMin, 1);
      const reqFor = (x: number) => {
        const Pd = Math.max(0, always + commsW + heater * hotF + instrSun * x - rtgW);
        const Pe = Math.max(0, always + commsW + heater + instrEcl * x - rtgW);
        return { req: Te > 0 ? (Pe * Te / X_E + Pd * Td / X_D) / Td : Pd / X_D, Pe };
      };
      const r0 = reqFor(0), r1 = reqFor(1);
      let x = safe || inCruise ? 0 : r1.req <= solarW + 1e-9 ? 1 : r1.req - r0.req > 0 ? clamp((solarW - r0.req) / (r1.req - r0.req), 0, 1) : 0;
      const batteryWh = U.filter((u) => u.comp.category === 'battery').reduce((a, u) => a + u.comp.specs.capacityWh!, 0) * c.batteryFade;
      let eclWh = reqFor(x).Pe * (Te / 60);
      if (Te > 0 && eclWh > batteryWh * BATTERY_EFF * 0.95 && x > 0) {
        const e0 = r0.Pe * (Te / 60), e1 = reqFor(1).Pe * (Te / 60);
        x = Math.min(x, e1 > e0 ? clamp((batteryWh * BATTERY_EFF * 0.95 - e0) / (e1 - e0), 0, 1) : 0);
        eclWh = reqFor(x).Pe * (Te / 60);
      }
      const survivalReq = r0.req;
      const brownout = Te > 0 && r0.Pe * (Te / 60) > batteryWh * BATTERY_EFF;
      if (solarW + 1e-6 < survivalReq * 0.9 || brownout) {
        c.powerDeathDays += dt;
        if (c.powerDeathDays > 12) { this.lose(c, brownout ? `Batteries (${fmt(batteryWh, 0)} Wh) could no longer carry the bus through the ${fmt(Te, 0)}-min eclipse — repeated brownouts killed the spacecraft.` : `Power generation (${fmt(solarW + rtgW, 0)} W) fell below what the bus needs to survive (${fmt(survivalReq, 0)} W).`); continue; }
        x = 0;
      } else c.powerDeathDays = 0;
      // Battery fade from cycling depth
      if (Te > 0 && batteryWh > 0) {
        const dod = clamp(eclWh / (batteryWh * BATTERY_EFF), 0.01, 1.2);
        const batts = U.filter((u) => u.comp.category === 'battery');
        const n80 = batts.length ? batts.reduce((a, u) => a + u.comp.specs.cycleLife80!, 0) / batts.length : 3000;
        const life = n80 * Math.pow(0.8 / dod, 2);
        const cycles = (this.geo.cyclesPerYear * dt) / 365;
        c.batteryFade = Math.max(0.2, c.batteryFade - 0.2 * (cycles / life) - 0.01 * (dt / 365));
        socSum += clamp(1 - dod, 0, 1);
      } else socSum += 1;
      const instrumentLoadOn = x * (instrSun);
      powerGenSum += solarW + rtgW;
      powerLoadSum += always + commsW + heater * hotF + instrumentLoadOn;
      if (safe) this.safeModeDays += dt / alive.length;

      // ── Data & science generation ──
      if (!inCruise) {
        const compression = Math.max(1, ...U.filter((u) => u.comp.specs.compression).map((u) => u.comp.specs.compression!));

        for (const s of this.baseSci) {
          const u = c.units[s.unitIndex];
          if (!u.alive || (u.offUntil ?? 0) > day) continue;
          const pointReq = u.comp.specs.pointingReqDeg;
          const pf = pointReq && pointing > Math.max(pointReq, res.pointing.achievedDeg) ? Math.sqrt(Math.max(pointReq, res.pointing.achievedDeg) / pointing) : 1;
          const eff = x * u.health * c.instrMult * this.instrBudgetMult;
          const gb = (s.rateMbps * s.duty * 86.4 * dt * eff) / compression;
          const value = (s.perYear * dt) / 365 * eff * pf;

          if (s.priority) { genPri += gb; incPri += value; } else { genBulk += gb; incBulk += value; }
          genGbTotal += gb;
          healthSum += u.health; healthN++;
        }
        workingForCoverage++;
        // Link: best alive radio at today's range and pointing
        let best = 0;
        for (const u of comms) {
          const l = computeLink(u.comp, gn, rangeKm, pointing, diff.linkMarginDb);
          if (l && l.rateMbps > best) best = l.rateMbps;
        }
        const weather = gn.weatherAvailability < 1 ? (this.rng.chance(gn.weatherAvailability) ? 1 / gn.weatherAvailability : 0) : 1;
        const outage = day < this.outageUntil ? 0 : 1;
        const contactMin = safe ? Math.min(this.geo.contactMinPerDay, 60) : this.geo.contactMinPerDay * this.contactMult;
        downCapacityGb += (best * contactMin * 60 * LINK_EFF * dt * weather * outage) / 1000;
        rateSum += best;
      }
    }

    // ── Fleet-level queues: data → downlink → science credited on the ground ──
    if (!inCruise && workingForCoverage > 0) {
      const scale = (this.coverage(workingForCoverage) / workingForCoverage) * this.synergy;
      this.sciPri += incPri * scale;
      this.sciBulk += incBulk * scale;
      const storage = this.storageGb(alive);
      this.bufPri += genPri; this.bufBulk += genBulk;
      this.dataGen += genGbTotal;
      let cap = downCapacityGb;
      const realtimePenalty = realtimeObjective && day < this.outageUntil;
      const sendPri = Math.min(this.bufPri, cap); cap -= sendPri;
      const sendBulk = Math.min(this.bufBulk, cap);
      let credited = 0;
      if (this.bufPri > 0) { const fr = sendPri / this.bufPri; credited += this.sciPri * fr; this.sciPri *= 1 - fr; this.bufPri -= sendPri; }
      if (this.bufBulk > 0) { const fr = sendBulk / this.bufBulk; credited += this.sciBulk * fr; this.sciBulk *= 1 - fr; this.bufBulk -= sendBulk; }
      if (realtimePenalty) credited *= 0.3;
      this.science += credited;
      this.dataReturned += sendPri + sendBulk;
      const over = this.bufPri + this.bufBulk - storage;
      if (over > 0) {
        const frac = over / Math.max(1e-9, this.bufBulk);
        const lost = Math.min(this.bufBulk, over);
        this.sciBulk *= 1 - Math.min(1, frac);
        this.bufBulk -= lost;
        this.dataLost += lost;
        if (this.firstOverflow === null) {
          this.firstOverflow = day;
          this.log('overflow', 'Onboard memory full', `Day ${day}: instruments generate ${fmt(genGbTotal / dt, 1)} Gb/day but only ${fmt(downCapacityGb / dt, 1)} Gb/day reaches the ground; the ${fmt(storage, 0)} Gb recorder is full and new data is being overwritten.`, 'warn');
        }
      }
      this.scienceDays += dt;
      this.lastRate = rateSum / Math.max(1, workingForCoverage);
    }

    // ── Costs ──
    const opsPerDay = (res.cost.operations + res.cost.ground) / Math.max(1, design.missionYears + 0.4 * orbit.cruiseYears) / 365;
    this.opsCost += opsPerDay * dt * (inCruise ? 0.4 : 1);

    // ── Random events ──
    this.rollEvents(dt, inCruise, solarActivity, scienceT);

    if (day % this.recordEvery < dt) this.record(false, powerGenSum / alive.length, powerLoadSum / alive.length, socSum / alive.length, healthN ? healthSum / healthN : 1, genGbTotal / dt, downCapacityGb / dt);
    if (day >= this.totalDays) this.finish(`Planned ${design.missionYears}-year mission completed.`);
  }

  private storageGb(alive: Craft[]) {
    let s = 0;
    for (const c of alive) for (const u of c.units) if (u.alive && u.comp.specs.storageGb) s += u.comp.specs.storageGb;
    return s;
  }

  private failUnit(c: Craft, u: Unit, why: string) {
    u.alive = false;
    const cat = u.comp.category;
    const sev: Status = cat === 'instrument' || cat === 'battery' || cat === 'thermal' ? 'warn' : 'warn';
    const who = this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : '';
    const radiation = u.comp.specs.tidKrad && c.dose / u.shield > u.comp.specs.tidKrad * 0.8;
    this.log('failure', `${u.comp.name} failed${who}`, radiation ? `Accumulated dose ${fmt(c.dose / u.shield, 0)} krad exceeded its ${u.comp.specs.tidKrad} krad tolerance.` : why ? `Failed ${why}.` : 'Random part failure (wear, manufacturing defect or single-event effect).', sev);
  }

  private rollEvents(dt: number, inCruise: boolean, activity: number, scienceT: number) {
    const diff = DIFFICULTY_MAP[this.design.difficulty];
    const orbit = ORBIT_MAP[this.design.orbit.id];
    const r = (perYear: number) => this.rng.next() < 1 - Math.exp(-(perYear * diff.anomalyRate * dt) / 365);
    const alive = this.fleet.filter((c) => c.alive);
    if (!alive.length) return;
    const nEff = Math.min(alive.length, 4);
    const canDecide = this.day - this.lastDecisionDay > 45 && !this.done;
    const earthLow = orbit.family === 'LEO' || orbit.family === 'SSO';
    const pickCraft = () => this.rng.pick(alive);

    // Non-decision events
    if (r(earthLow ? 0.12 * nEff : 0.03 * nEff)) {
      const c = pickCraft(); const loss = this.rng.range(0.05, 0.15);
      c.arrayDamage *= 1 - loss; this.anomalies++; this.survived++;
      this.log('debris', 'Micrometeoroid strike', `A debris/micrometeoroid hit damaged a solar array string${this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : ''}: −${fmt(loss * 100, 0)}% array power.`, 'warn');
    }
    if (r(0.04 * nEff)) {
      const c = pickCraft(); c.batteryFade *= 0.8; this.anomalies++; this.survived++;
      this.log('battery', 'Battery cell failure', `A battery cell string failed${this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : ''}: −20% capacity. Deeper discharges from now on.`, 'warn');
    }
    if (orbit.central === 'earth' && orbit.family !== 'GEO' && r(0.7)) {
      this.stormUntil = this.day + 5; this.anomalies++; this.survived++;
      this.log('storm', 'Geomagnetic storm', earthLow ? 'A storm heated the upper atmosphere: drag ×4 for 5 days, orbit decays faster.' : 'A geomagnetic storm raised radiation levels for a few days.', 'ok');
    }
    if (!canDecide || inCruise) return;

    // Decision events (at most one per 45 days)
    if (r(1.2 * (0.4 + 1.2 * activity))) {
      const kick = this.rng.range(3, 20) * (1 - orbit.magnetosphereShield);
      const weak = alive.some((c) => c.units.some((u) => u.alive && u.comp.specs.isObc && (u.comp.specs.tidKrad ?? 0) < 100));
      this.requestDecision('flare', 'Solar flare & particle storm', `An X-class flare is sending energetic protons your way (+${fmt(kick, 1)} krad unshielded). Single-event upsets may crash computers.`,
        [{ id: 'safe', label: 'Safe the spacecraft for 2 days', detail: 'Instruments off, computers in protected mode. Lose 2 days of science, no upset risk.' },
         { id: 'continue', label: 'Keep observing', detail: weak ? 'Commercial/rad-tolerant computers have a real chance of a reset or permanent latch-up.' : 'Rad-hard computers will most likely ride it out.' }],
        weak ? 'safe' : 'continue',
        (choice) => {
          for (const c of alive) c.dose += kick;
          if (choice === 'safe') { for (const c of alive) c.safeUntil = Math.max(c.safeUntil, this.day + 2); this.survived++; return 'Spacecraft safed; the storm passed without upsets.'; }
          const msgs: string[] = [];
          for (const c of alive) {
            const obc = c.units.find((u) => u.alive && u.comp.specs.isObc);
            if (!obc) continue;
            const tid = obc.comp.specs.tidKrad ?? 30;
            const pReset = tid < 100 ? 0.35 : 0.05, pLatch = tid < 100 ? 0.08 : 0.005;
            if (this.rng.chance(pLatch)) { this.failUnit(c, obc, 'from a single-event latch-up during the storm'); msgs.push(`computer latch-up${this.fleet.length > 1 ? ` on #${c.idx + 1}` : ''}`); }
            else if (this.rng.chance(pReset)) { c.safeUntil = this.day + 3; msgs.push(`computer reset${this.fleet.length > 1 ? ` on #${c.idx + 1}` : ''} (3 days safe mode)`); }
          }
          if (!msgs.length) this.survived++;
          return msgs.length ? `Observations continued, but: ${msgs.join(', ')}.` : 'Observations continued through the storm with no upsets.';
        });
      return;
    }
    const wheelCraft = alive.filter((c) => c.units.filter((u) => u.alive && u.comp.specs.adcsType === 'wheel').length >= 3);
    if (wheelCraft.length && r(0.07 * Math.min(wheelCraft.length, 4) * 3)) {
      const c = this.rng.pick(wheelCraft);
      const ws = c.units.filter((u) => u.alive && u.comp.specs.adcsType === 'wheel');
      const bad = this.rng.pick(ws);
      const spare = ws.length >= 4;
      this.requestDecision('wheel', 'Reaction-wheel friction anomaly', `Wheel ${ws.indexOf(bad) + 1}${this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : ''} shows rising bearing friction and current draw. ${spare ? 'A spare wheel is available.' : 'There is no spare wheel.'}`,
        [...(spare ? [{ id: 'spare', label: 'Switch to the spare wheel', detail: 'Retire the failing wheel now. Pointing unaffected; you lose your redundancy.' }] : []),
         { id: 'relube', label: 'Heat bearings & lower wheel speed', detail: '~60% chance the lubricant redistributes and the wheel recovers.' },
         { id: 'ignore', label: 'Keep flying as-is', detail: 'Saves effort now; the wheel will probably seize within weeks.' }],
        spare ? 'spare' : 'relube',
        (choice) => {
          if (choice === 'spare') { bad.alive = false; this.survived++; return 'Spare wheel spun up; attitude control nominal.'; }
          if (choice === 'relube') { if (this.rng.chance(0.6)) { this.survived++; return 'Friction returned to normal after a heating cycle.'; } bad.failAtDay = this.day + 30; return 'Friction keeps rising — the wheel is expected to fail within a month.'; }
          bad.failAtDay = this.day + (this.rng.chance(0.75) ? 10 : 400); return 'Flying as-is. Friction is still trending up.';
        });
      return;
    }
    const propCraft = alive.filter((c) => c.units.some((u) => u.alive && u.comp.category === 'propulsion' && !!u.comp.specs.ispS) && c.propellant > 0.05);
    if (earthLow && r(0.6 * nEff)) {
      const c = pickCraft();
      const canMove = propCraft.includes(c);
      if (!canMove) {
        this.anomalies++;
        const hit = this.rng.chance(0.01);
        this.log('conjunction', 'Conjunction alert', `A tracked debris object will pass within 200 m${this.fleet.length > 1 ? ` of spacecraft ${c.idx + 1}` : ''}. No propulsion — nothing to do but wait.${hit ? ' It hit.' : ' It missed.'}`, hit ? 'crit' : 'warn');
        if (hit) this.lose(c, 'Destroyed in a collision with orbital debris (no propulsion to dodge).'); else this.survived++;
        return;
      }
      this.requestDecision('conjunction', 'Conjunction alert', `Space Force tracking predicts a 1-in-100 chance of collision with debris${this.fleet.length > 1 ? ` for spacecraft ${c.idx + 1}` : ''} in 36 hours.`,
        [{ id: 'maneuver', label: 'Perform an avoidance maneuver', detail: 'Uses a little propellant and interrupts observations for half a day.' },
         { id: 'accept', label: 'Accept the risk', detail: '1% chance of losing the spacecraft.' }],
        'maneuver',
        (choice) => {
          if (choice === 'maneuver') { c.propellant = Math.max(0, c.propellant - propellantFor(0.3, c.dryKg, 220)); c.safeUntil = Math.max(c.safeUntil, this.day + 0.5); this.survived++; return 'Maneuver executed; miss distance now 3 km.'; }
          if (this.rng.chance(0.01)) { this.lose(c, 'Destroyed in a collision with orbital debris (risk accepted).'); return 'Impact. The spacecraft broke apart.'; }
          this.survived++; return 'The object passed 180 m away. Lucky.';
        });
      return;
    }
    if (r(0.35)) {
      const dur = this.rng.int(3, 8);
      this.requestDecision('ground', 'Ground station outage', `A hardware fault at the main ${GN_MAP[this.design.groundNetworkId].name} site will knock out contacts for ~${dur} days.`,
        [{ id: 'buy', label: 'Rent backup antenna time ($0.4M)', detail: 'Contacts continue through partner stations.' },
         { id: 'wait', label: 'Wait it out', detail: 'No downlink for the outage; onboard storage keeps filling.' }],
        this.res.data.genGbPerDay * dur > this.res.data.storageGb * 0.5 || !!OBJECTIVE_MAP[this.design.objectiveId].realtimeHoursReq ? 'buy' : 'wait',
        (choice) => {
          if (choice === 'buy') { this.anomalyCost += 0.4; this.survived++; return 'Backup antennas booked; no data lost.'; }
          this.outageUntil = this.day + dur; this.survived++; return `No contact for ${dur} days.`;
        });
      return;
    }
    if (scienceT > 1 && r(0.12)) {
      const need = 0.1 * (this.res.cost.operations + this.res.cost.ground) * (1 - scienceT / Math.max(1, this.design.missionYears));
      const canPay = this.reservesLeft >= need;
      this.requestDecision('budget', 'Operations budget cut (−10%)', `Headquarters cut the remaining operations budget by 10% (≈$${fmt(need, 1)}M).`,
        [{ id: 'cut_contact', label: 'Cut ground contact time 25%', detail: 'Less downlink from now on.' },
         { id: 'cut_science', label: 'Reduce instrument operations 20%', detail: 'Less data and science, same downlink.' },
         ...(canPay ? [{ id: 'reserves', label: `Cover it from reserves ($${fmt(this.reservesLeft, 0)}M left)`, detail: 'Spend cost reserves held for exactly this.' }] : [])],
        canPay ? 'reserves' : 'cut_science',
        (choice) => {
          if (choice === 'reserves') { this.reservesLeft -= need; this.anomalyCost += need; this.survived++; return `Covered from reserves ($${fmt(this.reservesLeft, 0)}M remaining).`; }
          if (choice === 'cut_contact') { this.contactMult *= 0.75; this.survived++; return 'Ground contact reduced to 75%.'; }
          this.instrBudgetMult *= 0.8; this.survived++; return 'Instrument operations reduced to 80%.';
        });
      return;
    }
    if (!this.softwarePatched && r(0.35 * Math.min(nEff, 2))) {
      const c = pickCraft();
      this.requestDecision('software', 'Flight software fault → safe mode', `A memory-management bug${this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : ''} tripped the fault-protection system. The spacecraft is in safe mode.`,
        [{ id: 'patch', label: 'Develop & upload a patch ($0.3M)', detail: '3 days to recover; the bug is gone fleet-wide.' },
         { id: 'reboot', label: 'Reboot and resume', detail: '1 day to recover; the bug may come back.' }],
        'patch',
        (choice) => {
          if (choice === 'patch') { c.safeUntil = this.day + 3; this.softwarePatched = true; this.anomalyCost += 0.3; this.survived++; return 'Patch uploaded; nominal operations resumed.'; }
          c.safeUntil = this.day + 1; this.survived++; return 'Rebooted. Back to science.';
        });
      return;
    }
    const instrCraft = alive.filter((c) => c.units.some((u) => u.alive && u.comp.category === 'instrument' && u.health > 0.5));
    if (instrCraft.length && r(0.06 * this.baseSci.length * Math.min(instrCraft.length, 3))) {
      const c = this.rng.pick(instrCraft);
      const u = this.rng.pick(c.units.filter((x) => x.alive && x.comp.category === 'instrument' && x.health > 0.5));
      u.health *= 0.75;
      this.requestDecision('instrument', `${u.comp.name} degradation`, `Detector response dropped 25% — likely contamination freezing onto cold optics${this.fleet.length > 1 ? ` (spacecraft ${c.idx + 1})` : ''}.`,
        [{ id: 'bakeout', label: 'Run a 5-day bake-out', detail: 'Instrument off while heaters drive off contaminants (~70% success).' },
         { id: 'accept', label: 'Accept reduced performance', detail: 'Keep observing at 75%.' }],
        'bakeout',
        (choice) => {
          if (choice === 'bakeout') { u.offUntil = this.day + 5; if (this.rng.chance(0.7)) { u.health = Math.min(1, u.health / 0.75 * 0.97); this.survived++; return 'Bake-out restored ~97% of performance.'; } return 'Bake-out did not help; performance stays at 75%.'; }
          this.survived++; return 'Continuing at 75% performance.';
        });
      return;
    }
    if (propCraft.length && r(0.02 * Math.min(propCraft.length, 4))) {
      const c = this.rng.pick(propCraft);
      this.requestDecision('leak', 'Thruster valve leak', `Tank pressure${this.fleet.length > 1 ? ` on spacecraft ${c.idx + 1}` : ''} is dropping: a thruster valve is not sealing.`,
        [{ id: 'isolate', label: 'Isolate the leaking branch', detail: 'Close latch valves: lose ~10% of propellant, keep the rest.' },
         { id: 'monitor', label: 'Monitor and continue', detail: 'Avoids reconfiguration risk; the leak may get worse.' }],
        'isolate',
        (choice) => {
          if (choice === 'isolate') { c.propellant *= 0.9; this.survived++; return 'Branch isolated; leak stopped.'; }
          const loss = this.rng.range(0.1, 0.5); c.propellant *= 1 - loss; return `The leak continued for weeks: −${fmt(loss * 100, 0)}% propellant.`;
        });
    }
  }

  private record(final: boolean, gen = 0, load = 0, soc = 1, health = 1, genGb = 0, downGb = 0) {
    const alive = this.fleet.filter((c) => c.alive);
    const last = this.telemetry[this.telemetry.length - 1];
    if (final && last && last.day === this.day) return;
    this.telemetry.push({
      day: this.day,
      powerGenW: final && last ? last.powerGenW : gen,
      powerLoadW: final && last ? last.powerLoadW : load,
      batterySoc: final && last ? last.batterySoc : soc,
      bufferGb: this.bufBulk + this.bufPri,
      storageGb: this.storageGb(alive),
      downlinkGb: final && last ? last.downlinkGb : downGb,
      generatedGb: final && last ? last.generatedGb : genGb,
      scienceCum: this.science,
      costCum: this.res.cost.development + this.res.cost.reserves - this.reservesLeft + this.res.cost.launch + this.opsCost + this.anomalyCost,
      propellantKg: alive.length ? alive.reduce((a, c) => a + c.propellant, 0) / alive.length : 0,
      massKg: alive.length ? alive.reduce((a, c) => a + c.dryKg + c.propellant, 0) / alive.length : 0,
      altitudeKm: alive.length ? alive[0].altitude : 0,
      doseKrad: alive.length ? alive[0].dose / (COMPONENT_MAP[this.design.busId].specs.shieldFactor ?? 1) : 0,
      working: alive.length,
      rateMbps: this.lastRate,
      health: final && last ? last.health : health,
    });
  }

  telemetryNow(): TelemetryPoint[] { return this.telemetry; }
  eventsNow(): SimEventRecord[] { return this.events; }
  scienceNow() { return this.science; }

  result(): SimResult {
    const obj = OBJECTIVE_MAP[this.design.objectiveId];
    const sci = this.res.science;
    const opsYears = this.scienceDays / 365;
    const kindsOk = sci.missingRequired.length === 0;
    let outcome: SimResult['outcome'] = 'failure';
    if (kindsOk && opsYears + 1e-6 >= obj.minLifeYears && this.science >= sci.baseline * 0.75) outcome = 'success';
    else if (kindsOk && this.science >= sci.threshold) outcome = 'partial';
    const surviving = this.fleet.filter((c) => c.alive).length;
    return {
      outcome, endReason: this.endReason || (this.done ? 'Mission ended.' : 'In progress'), daysSimulated: this.day, scienceDays: this.scienceDays,
      science: this.science, dataLostGb: this.dataLost, dataReturnedGb: this.dataReturned, opsCost: this.opsCost, anomalyCost: this.anomalyCost,
      anomalies: this.anomalies, anomaliesSurvived: this.survived, survivingSpacecraft: surviving, telemetry: this.telemetry, events: this.events,
      firstOverflowDay: this.firstOverflow, safeModeDays: this.safeModeDays, lifetimeYears: opsYears,
    };
  }

}

export interface MonteCarloResult { runs: number; success: number; partial: number; failure: number; meanScience: number; meanLifeYears: number; lossReasons: Record<string, number> }

export function runMonteCarlo(design: MissionDesign, mods: DesignModifiers = NO_MODS, runs = 100, seed = 'mc'): MonteCarloResult {
  let success = 0, partial = 0, failure = 0, sci = 0, life = 0;
  const lossReasons: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const sim = new MissionSimulator(design, mods, { seed: `${seed}#${i}`, autoDecide: true, stepDays: 5, telemetryPoints: 10 });
    sim.runToEnd();
    const r = sim.result();
    if (r.outcome === 'success') success++; else if (r.outcome === 'partial') partial++; else failure++;
    sci += r.science; life += r.lifetimeYears;
    if (r.outcome !== 'success') { const k = r.endReason.split(':')[0].slice(0, 80); lossReasons[k] = (lossReasons[k] ?? 0) + 1; }
  }
  return { runs, success: success / runs, partial: partial / runs, failure: failure / runs, meanScience: sci / runs, meanLifeYears: life / runs, lossReasons };
}

