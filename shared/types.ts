// ─────────────────────────────────────────────────────────────────────────────
// Core data schemas shared by the client, the simulation engine and the server.
// Units are SI unless the field name says otherwise (kg, W, Wh, $M, Mbps, Gb, km).
// ─────────────────────────────────────────────────────────────────────────────
export type Wavelength = 'radio' | 'ir' | 'visible' | 'uv' | 'xray' | 'gamma' | 'insitu';
export type Discipline = 'earth' | 'helio' | 'planetary' | 'astro';
/** Player-facing difficulty level of a mission card. */
export type Level = 'easy' | 'medium' | 'hard' | 'sandbox';

export type Tier = 'simple' | 'advanced';
export type Difficulty = 'cadet' | 'engineer' | 'director' | 'sandbox';
export type RoleId = 'director' | 'systems' | 'science' | 'ops';
export type ResourceKey = 'mass' | 'power' | 'budget' | 'data' | 'comms' | 'time';
export type Status = 'ok' | 'warn' | 'crit';
export type BusClass = 'cube' | 'small' | 'mid' | 'large';
export type Band = 'UHF' | 'S' | 'X' | 'Ka' | 'optical';

export type ComponentCategory =
  | 'bus' | 'power' | 'battery' | 'computer' | 'adcs' | 'propulsion' | 'comms' | 'thermal' | 'optics' | 'instrument';

export type InstrumentKind =
  | 'optical_ms' | 'thermal_ir' | 'hyperspectral' | 'sar' | 'lidar' | 'neutron' | 'ir_spec'
  | 'magnetometer' | 'plasma' | 'particles' | 'coronagraph' | 'euv' | 'ice_radar' | 'mass_spec' | 'nac' | 'fire_ir'
  | 'polarimeter' | 'nir_survey' | 'xray_spec' | 'xray_imager' | 'submm' | 'mwr' | 'gamma_burst';

/** Category-specific engineering parameters. Only the block matching the category is populated. */
export interface ComponentSpecs {
  // bus
  busClass?: BusClass;
  payloadCapacityKg?: number;      // structural mass the bus can carry
  designLifeYears?: number;
  shieldFactor?: number;           // dose divisor vs. 2.5 mm Al reference (vault = 25)
  heatRejectionW?: number;         // body-radiator capacity
  surfaceAreaM2?: number;          // external area (heaters, drag, absorbed flux)
  dragAreaM2?: number;             // mean cross-section for drag
  stowedVolumeM3?: number;         // envelope inside the fairing
  deploySuccess?: number;          // probability of surviving deployment / commissioning
  opsCostPerYear?: number;         // $M/yr flight operations team
  testMonths?: number;             // environmental test campaign length
  cubeU?: number;                  // CubeSat Design Specification form factor (1, 1.5, 2, 3, 6, 12)
  // power generation
  generationW?: number;            // BOL output at 1 AU (solar) or BOL electric (RTG)
  source?: 'solar' | 'rtg';
  degradationPerYear?: number;     // fractional output loss per year
  liltFactor?: number;             // Low-Intensity-Low-Temperature efficiency beyond 3 AU (solar only)
  arrayAreaM2?: number;
  cosFactor?: number;              // mean cosine / packing factor of the array
  wasteHeatW?: number;             // RTG heat usable to offset heaters
  // battery
  capacityWh?: number;
  cycleLife80?: number;            // cycles to end-of-life at 80% depth-of-discharge
  // computer / storage
  storageGb?: number;
  compression?: number;            // onboard data reduction factor (≥1)
  isObc?: boolean;
  // ADCS
  pointingDeg?: number;            // achievable pointing accuracy (3σ, deg)
  adcsType?: 'integrated' | 'wheel' | 'startracker' | 'magnetorquer';
  maxSpacecraftKg?: number;        // momentum capacity limit for wheels
  // propulsion
  ispS?: number;
  maxPropellantKg?: number;
  thrustN?: number;
  chemical?: boolean;
  tankOnly?: boolean;              // propellant tank (no engine): adds capacity only
  // comms
  band?: Band;
  txPowerW?: number;               // RF output
  antennaGainDbi?: number;         // fixed-gain antennas (patch/omni/reflectarray)
  dishDiameterM?: number;          // parabolic dish (gain computed from aperture)
  maxRateMbps?: number;            // modem / transponder ceiling
  opticalRefRateMbps?: number;     // optical: demonstrated rate at reference distance
  opticalRefDistKm?: number;
  // thermal
  addedRejectionW?: number;
  coolsToK?: number;               // cryocooler / passive cryo-radiator detector temperature
  // optics / collectors
  opticsKind?: 'cnt_mirror' | 'segmented_mirror' | 'monolith_mirror' | 'grazing_xray' | 'patch_array';
  apertureM?: number;
  opticsGain?: number;             // science multiplier on matched instruments
  deployable?: boolean;
  // instruments
  kind?: InstrumentKind;
  dutyCycle?: number;              // fraction of time operating
  needsDaylight?: boolean;
  fovDeg?: number;                 // full field of view (swath)
  gsdAt500km?: number;             // ground sample distance at 500 km altitude (m)
  pointingReqDeg?: number;
  tidKrad?: number;                // total ionizing dose tolerance
  leadMonths?: number;             // procurement / build lead time
  wavelength?: Wavelength;         // primary electromagnetic band (instruments)
  instrumentType?: string;         // spectrometer, polarimeter, SAR, radiometer, …
  needsOptics?: ('cnt_mirror' | 'segmented_mirror' | 'monolith_mirror' | 'grazing_xray' | 'patch_array')[];
  cryoK?: number;                  // detector must be colder than this (K)
}

export interface SpacecraftComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  mass_kg: number;
  power_watts: number;             // electrical draw when active
  cost_millions: number;
  data_rate_mbps: number;          // instruments: data generated; comms: 0 (see specs.maxRateMbps)
  science_points: number;
  reliability: number;             // probability of surviving a 5-year reference life
  tier: Tier;
  minBus: BusClass;                // smallest bus that can host it
  maxBus: BusClass;                // largest bus it makes sense on
  maxQty: number;
  specs: ComponentSpecs;
}

export interface ComponentSelection { id: string; qty: number; }

export type OrbitFamily = 'LEO' | 'SSO' | 'GTO' | 'GEO' | 'LUNAR' | 'L1' | 'L2' | 'MARS' | 'ASTEROID' | 'JUPITER';

export interface Orbit {
  id: string;
  name: string;
  family: OrbitFamily;
  description: string;
  central: 'earth' | 'moon' | 'mars' | 'vesta' | 'sun-earth-l1' | 'sun-earth-l2' | 'jupiter';
  defaultAltitudeKm: number;
  altitudeRangeKm?: [number, number];   // adjustable altitude (LEO/SSO/LLO)
  inclinationDeg: number;
  betaDeg: number;                      // typical sun-beta angle for eclipse sizing
  distanceFromSunAU: number;
  earthDistanceKm?: [number, number];   // for non-Earth-orbit: min/max range to Earth
  insertionDvMs: number;                // spacecraft-provided insertion Δv
  insertionNeedsChemical: boolean;
  lowThrustFactor?: number;             // Δv multiplier when insertion is flown with electric propulsion (default 1.8)
  stationKeepingDvPerYear: number;      // non-drag SK Δv (m/s/yr)
  cruiseYears: number;                  // transfer time before science starts
  radiationKradPerYear?: number;        // fixed dose rate (behind 2.5 mm Al) — otherwise altitude table
  magnetosphereShield: number;          // fraction of solar-particle dose blocked (0..1)
  heaterWPerM2: number;                 // cold-case survival heater flux
  hotFluxWPerM2: number;                // absorbed external heat in hot case
  contactMode: 'passes' | 'scheduled';
  visibilityFraction: number;           // scheduled: fraction of time Earth is in view
  launchCapacityKey: string;            // which LV capacity column applies
  c3: number;                           // characteristic energy of departure (km²/s²)
  launchWindowMonths: number;           // 0 = any time; otherwise windows repeat every N months
  dataDuty?: number;                    // deep space: instruments record only this fraction of the time (data budget, not science)
  targetBody: string;
}

export interface OrbitChoice { id: string; altitudeKm: number; ltan: 'day' | 'dawn-dusk'; }

export interface LaunchVehicle {
  id: string;
  name: string;
  description: string;
  cost_millions: number;
  costPerKg?: number;                   // rideshare pricing ($M/kg)
  minChargeKg?: number;
  reliability: number;
  fairingDiameterM: number;
  fairingHeightM: number;
  fairing_volume: number;               // usable m³
  max_payload_kg_by_orbit: Record<string, number>; // keyed by Orbit.launchCapacityKey
  leadMonths: number;
  tier: Tier;
}

export interface GroundNetwork {
  id: string;
  name: string;
  description: string;
  gtByBand: Partial<Record<Band, number>>; // receive figure of merit, dB/K
  stations: number;
  polarStations: boolean;
  maxRangeKm: number;
  minRangeKm: number;
  costPerHour: number;                  // $M per contact hour
  baseCostPerYear: number;              // $M/yr subscription
  weatherAvailability: number;          // optical only <1
  maxHoursPerDay: number;
}

export type Pillar = ResourceKey;

export interface MissionObjective {
  id: string;
  name: string;
  short: string;
  brief: string;
  science: string;                      // what the science is about (educational)
  icon: string;
  orbitSuitability: Partial<Record<OrbitFamily, number>>;
  instrumentWeights: Partial<Record<InstrumentKind, number>>;
  requiredKinds: InstrumentKind[][];    // each inner list: at least one of
  synergy?: { kinds: InstrumentKind[]; bonus: number; label: string }[];
  earthObserving: boolean;
  revisitReqDays?: number;
  resolutionReqM?: number;
  realtimeHoursReq?: number;            // hours/day of ground contact needed for real-time products
  targetDutyFamilies?: InstrumentKind[]; // instruments limited by flyby/target windows
  minLifeYears: number;                 // minimum science operations
  baselineYears: number;                // planned science operations
  scienceThreshold: number;             // minimum mission science
  scienceBaseline: number;              // full-success science
  budgetCap: number;                    // $M lifecycle at Engineer difficulty
  deadlineMonths: number;               // launch-by
  criticalPillars: ResourceKey[];
  fleetMinFraction: number;
  hints: string[];
  discipline?: Discipline;
  level: Level;                         // which card group it belongs to on the Mission Selection screen
  difficulty: Difficulty;               // rules preset applied when the mission is selected
  tagline: string;                      // one-line card text
  target: string;                       // where it goes (card chip)
  color: string;                        // card accent
}

export interface DifficultySpec {
  id: Difficulty;
  name: string;
  title: string;
  blurb: string;
  budgetMult: number;
  massContingency: number;
  minReservePct: number;
  powerMarginReq: number;
  linkMarginDb: number;
  anomalyRate: number;
  designEventRate: number;
  maxDesignEvents: number;
  allowAdvanced: boolean;
  scienceThresholdMult: number;
  scoreMult: number;
  hints: boolean;
  enforceCaps: boolean;
}

export interface PlayerRole {
  id: RoleId;
  name: string;
  short: string;
  color: string;
  owns: ResourceKey[];
  categories: (ComponentCategory | 'orbit' | 'launch' | 'ground' | 'objective' | 'signoff' | 'reserve' | 'anomaly' | 'fleet' | 'duration')[];
  description: string;
}

export interface MissionDesign {
  objectiveId: string;
  difficulty: Difficulty;
  scenarioSeed: string;
  busId: string;
  components: ComponentSelection[];
  fleetSize: number;
  orbit: OrbitChoice;
  launchVehicleId: string;
  groundNetworkId: string;
  contactHoursPerDay: number;
  reservePct: number;
  missionYears: number;
  presets?: Record<string, string>;     // Easy/Medium: slot id → chosen option id (the components are derived from these)
}

export interface DesignModifiers {
  budgetCapMult: number;
  deadlineShiftMonths: number;
  costOverrun: Record<string, number>;   // componentId → multiplier
  extraLeadMonths: Record<string, number>;
  launchDelayMonths: number;
}

export interface DesignEvent {
  id: string;
  kind: 'budget_cut' | 'plus_up' | 'launch_delay' | 'supplier_delay' | 'cost_overrun' | 'tech_breakthrough';
  title: string;
  message: string;
  atAction: number;
  targetComponent?: string;
}

// ── Computed resource state ────────────────────────────────────────────────
export interface PillarState {
  key: ResourceKey;
  label: string;
  unit: string;
  used: number;
  capacity: number;
  utilization: number;                 // used / capacity
  margin: number;                      // (capacity-used)/capacity
  status: Status;
  bottleneck: boolean;
  critical: boolean;                   // flagged as critical for the objective
  summary: string;                     // one-line plain-language status
  why: string[];                       // explanations when yellow/red
}

export interface Explanation { pillar: ResourceKey | 'science' | 'reliability' | 'launch'; severity: Status; text: string; }

export interface LinkBudget {
  band: Band | 'none';
  componentName: string;
  rangeKm: number;
  eirpDbw: number;
  gtDbK: number;
  pathLossDb: number;
  pointingLossDb: number;
  otherLossDb: number;
  cn0DbHz: number;
  requiredEbN0Db: number;
  marginDb: number;
  linkRateMbps: number;                // physics-limited rate
  rateMbps: number;                    // min(physics, modem)
  limitedBy: 'physics' | 'modem';
  contactMinPerDay: number;
  passesPerDay: number;
  passMinutes: number;
  downlinkGbPerDay: number;
  latencyS: number;
  beamwidthDeg: number;
}

export interface PowerBudget {
  source: string;
  bolW: number;
  eolW: number;
  solarFluxFactor: number;
  periodMin: number;
  eclipseFraction: number;
  eclipseMin: number;
  loadSunW: number;
  loadEclipseW: number;
  peakW: number;
  heaterW: number;
  requiredArrayW: number;              // SMAD array sizing
  marginFrac: number;
  batteryWh: number;
  batteryNeededWh: number;
  dodAllowed: number;
  dodActual: number;
  cyclesPerYear: number;
  rtgW: number;
}

export interface MassBudget {
  busKg: number;
  componentsKg: number;
  dryKg: number;
  contingencyKg: number;
  propellantKg: number;
  propellantCapacityKg: number;
  propellantNeededKg: number;          // what the Δv budget needs (before the 15% reserve)
  wetKg: number;
  fleetKg: number;
  dispenserKg: number;
  launchMassKg: number;
  lvCapacityKg: number;
  launchesNeeded: number;
  busPayloadUsedKg: number;
  busPayloadCapKg: number;
  dvBudget: { label: string; dv: number }[];
  dvTotal: number;
  dvCapability: number;
  volumeM3: number;
  fairingM3: number;
}

export interface CostBudget {
  hardware: number;
  hardwareFleet: number;
  ait: number;
  pmse: number;
  development: number;
  reserves: number;
  launch: number;
  operations: number;
  ground: number;
  scheduleSlip: number;
  total: number;
  cap: number;
  lines: { label: string; value: number }[];
}

export interface DataBudget {
  genGbPerDay: number;
  rawGbPerDay: number;
  compression: number;
  storageGb: number;
  downlinkGbPerDay: number;
  bufferDays: number;                  // days until storage fills (Infinity if draining)
  overflowDay: number | null;
  returnFraction: number;              // fraction of generated data that reaches the ground
  perInstrument: { name: string; gbPerDay: number }[];
}

export interface TimeBudget {
  devMonths: number;
  lvLeadMonths: number;
  readyMonth: number;
  launchMonth: number;
  deadlineMonth: number;
  cruiseYears: number;
  plannedOpsYears: number;
  lifetimeYears: number;               // predicted achievable operations
  limiter: string;
  limits: { label: string; years: number }[];
  decayYears: number;
  radiationYears: number;
  propellantYears: number;
  designLifeYears: number;
  powerYears: number;
}

export interface ScienceEstimate {
  perYear: number;
  total: number;
  threshold: number;
  baseline: number;
  orbitFactor: number;
  coverageFactor: number;
  resolutionFactor: number;
  fleetFactor: number;
  revisitDays: number | null;
  gsdM: number | null;
  perInstrument: { name: string; perYear: number; relevance: number }[];
  missingRequired: InstrumentKind[][];
  synergies: string[];
}

export interface Compatibility {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface ResourceState {
  pillars: Record<ResourceKey, PillarState>;
  mass: MassBudget;
  power: PowerBudget;
  cost: CostBudget;
  data: DataBudget;
  link: LinkBudget;
  time: TimeBudget;
  science: ScienceEstimate;
  thermal: { rejectionW: number; heatLoadW: number; marginFrac: number; heaterW: number; status: Status };
  pointing: { achievedDeg: number; requiredDeg: number; driver: string; ok: boolean };
  reliability: { spacecraft: number; fleet: number; launch: number; deploy: number; estimate: number; subsystems: { label: string; r: number }[] };
  compatibility: Compatibility;
  explanations: Explanation[];
  bottlenecks: ResourceKey[];
  estimatedSuccess: number;
  /** Payload chain (optics + detector cooling): science multiplier per instrument and short notes. */
  chain: { mult: Record<string, number>; notes: string[] };
}

// ── Simulation ────────────────────────────────────────────────────────────
export interface TelemetryPoint {
  day: number;
  powerGenW: number;
  powerLoadW: number;
  batterySoc: number;
  bufferGb: number;
  storageGb: number;
  downlinkGb: number;
  generatedGb: number;
  scienceCum: number;
  costCum: number;
  propellantKg: number;
  massKg: number;
  altitudeKm: number;
  doseKrad: number;
  working: number;                     // working spacecraft
  rateMbps: number;
  health: number;                      // 0..1 mean component health
}

export interface SimEventRecord {
  day: number;
  kind: string;
  title: string;
  text: string;
  severity: Status;
  decision?: string;
}

export interface AnomalyChoice { id: string; label: string; detail: string; }

export interface PendingDecision {
  index: number;
  day: number;
  kind: string;
  title: string;
  text: string;
  choices: AnomalyChoice[];
  recommended: string;
}

export interface SimResult {
  outcome: 'success' | 'partial' | 'failure';
  endReason: string;
  daysSimulated: number;
  scienceDays: number;
  science: number;
  dataLostGb: number;
  dataReturnedGb: number;
  opsCost: number;
  anomalyCost: number;
  anomalies: number;
  anomaliesSurvived: number;
  survivingSpacecraft: number;
  telemetry: TelemetryPoint[];
  events: SimEventRecord[];
  firstOverflowDay: number | null;
  safeModeDays: number;
  lifetimeYears: number;
}

export interface ScoreBreakdown {
  successProbability: number;          // 0..1
  science: number;                     // 0..1
  efficiency: number;                  // 0..1
  coordination: number;                // 0..1
  pts: { success: number; science: number; efficiency: number; coordination: number };
  difficultyMult: number;
  total: number;
  grade: string;
}

export interface TeamMetrics {
  actions: number;
  actionsByRole: Record<RoleId, number>;
  proposals: number;
  approved: number;
  rejected: number;
  resolveMsTotal: number;
  signoffAttempts: number;
  signoffFailures: number;
  chatMessages: number;
  reverts: number;
  decisions: number;
  decisionMsTotal: number;
}

export interface MissionReport {
  runId: string;
  createdAt: number;
  design: MissionDesign;
  resources: ResourceState;
  sim: SimResult;
  monteCarlo: { runs: number; success: number; partial: number; failure: number; meanScience: number };
  score: ScoreBreakdown;
  analysis: { title: string; text: string; severity: Status }[];
  team: { name: string; roles: RoleId[] }[];
  metrics: TeamMetrics;
  matches?: { id: string; name: string; similarity: number; why: string[]; lore: string; status: string }[];
  takeaways?: { icon: string; text: string; good: boolean }[];
}

export interface MissionRunSave {
  schema: 1;
  id: string;
  name: string;
  savedAt: number;
  parentId?: string;
  parentName?: string;
  design: MissionDesign;
  modifiers: DesignModifiers;
  designEvents: DesignEvent[];
  decisions: string[];
  simSeed?: string;
  report?: MissionReport;
  team: { name: string; roles: RoleId[] }[];
}

export interface LeaderboardEntry {
  id: string;
  team: string;
  players: string[];
  objectiveId: string;
  difficulty: Difficulty;
  seed: string;
  score: number;
  grade: string;
  outcome: SimResult['outcome'];
  science: number;
  cost: number;
  successProbability: number;
  at: number;
}
