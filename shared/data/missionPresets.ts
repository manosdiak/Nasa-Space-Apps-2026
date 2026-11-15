// Easy & Medium "preset" choices for the Space Mission building.
// Easy: exactly 3 choices (Low / Medium / High) for Engine, Fuel Tank, Power,
// Science Instrument, Communications and Orbit. Medium: 9 subsystems with 3–4
// options and a one-line "why". Hard & Sandbox use the full parts catalog.
import type { ComponentSelection, OrbitChoice, RoleId } from '../types';

export type SlotId = 'engine' | 'fuel' | 'power' | 'instrument' | 'comms' | 'orbit' | 'attitude' | 'thermal' | 'rocket';

export interface PresetOption {
  id: string;
  label: string;
  /** 1 = low cost / low capability … 3 (or 4) = high cost / high capability */
  tier: 1 | 2 | 3 | 4;
  blurb: string;
  components?: ComponentSelection[];
  orbit?: OrbitChoice;
  launchVehicleId?: string;
  groundNetworkId?: string;
  contactHoursPerDay?: number;
}
export interface PresetSlot { id: SlotId; label: string; icon: string; role: RoleId; why: string; options: PresetOption[] }
export interface MissionPresetSet {
  /** Buses tried in order: the first one that can carry the chosen parts is used. */
  busIds: string[];
  /** Always-installed parts (computer, wiring, etc.). */
  base: ComponentSelection[];
  defaultOrbit: OrbitChoice;
  groundNetworkId: string;
  contactHoursPerDay: number;
  /** Rockets tried cheapest-first when there is no Rocket slot. */
  autoRockets: string[];
  slots: PresetSlot[];
}

export const SLOT_META: Record<SlotId, { label: string; icon: string; role: RoleId }> = {
  engine: { label: 'Engine', icon: '🔥', role: 'systems' },
  fuel: { label: 'Fuel Tank', icon: '⛽', role: 'systems' },
  power: { label: 'Power', icon: '🔋', role: 'systems' },
  instrument: { label: 'Science', icon: '🔬', role: 'science' },
  comms: { label: 'Comms', icon: '📡', role: 'ops' },
  orbit: { label: 'Orbit', icon: '🪐', role: 'director' },
  attitude: { label: 'Pointing', icon: '🎯', role: 'systems' },
  thermal: { label: 'Thermal', icon: '🌡️', role: 'systems' },
  rocket: { label: 'Rocket', icon: '🚀', role: 'ops' },
};

const slot = (id: SlotId, why: string, options: PresetOption[]): PresetSlot => ({ id, ...SLOT_META[id], why, options });
const c = (id: string, qty = 1): ComponentSelection => ({ id, qty });

// ── EASY ─────────────────────────────────────────────────────────────────────
export const EASY_PRESETS: Record<string, MissionPresetSet> = {
  lro: {
    busIds: ['bus_mid'], base: [c('obc_rad750'), c('ssr_4t'), c('adcs_rw', 4), c('adcs_st'), c('th_mli')],
    defaultOrbit: { id: 'llo', altitudeKm: 100, ltan: 'day' }, groundNetworkId: 'gs_comm', contactHoursPerDay: 10,
    autoRockets: ['lv_electron', 'lv_f9', 'lv_vulcan', 'lv_atlas', 'lv_fh'],
    slots: [
      slot('engine', 'You must brake to be captured by the Moon.', [
        { id: 'mono', label: 'Small thrusters', tier: 1, blurb: 'Cheap and light, but burns more fuel.', components: [c('prop_hydrazine')] },
        { id: 'biprop', label: 'Main engine', tier: 2, blurb: 'Efficient engine: about 30% less fuel.', components: [c('prop_biprop')] },
        { id: 'both', label: 'Main engine + backup', tier: 3, blurb: 'Two engines: if one breaks, the other saves you.', components: [c('prop_biprop'), c('prop_hydrazine')] },
      ]),
      slot('fuel', 'Fuel for braking into orbit and staying there.', [
        { id: 'small', label: 'Small tank', tier: 1, blurb: 'Holds 350 kg. Light, but may run dry.', components: [c('tank_m')] },
        { id: 'large', label: 'Large tank', tier: 2, blurb: 'Holds 1,000 kg. Enough for most designs.', components: [c('tank_l')] },
        { id: 'twin', label: 'Two large tanks', tier: 3, blurb: 'Holds 2,000 kg. Heavy, but never runs dry.', components: [c('tank_l', 2)] },
      ]),
      slot('power', 'Solar panels in sunlight, batteries in the Moon\'s shadow.', [
        { id: 'small', label: 'Small panels', tier: 1, blurb: '1 kW of panels, 1 battery.', components: [c('pwr_tj500', 2), c('bat_1k')] },
        { id: 'wing', label: 'Solar wing', tier: 2, blurb: '2 kW wing, 2 batteries.', components: [c('pwr_tj2k'), c('bat_1k', 2)] },
        { id: 'big', label: 'Two big wings', tier: 3, blurb: '4 kW, 3 batteries. Power to spare.', components: [c('pwr_tj2k', 2), c('bat_1k', 3)] },
      ]),
      slot('instrument', 'What your orbiter actually measures.', [
        { id: 'wide', label: 'Wide camera', tier: 1, blurb: 'Sees big areas, but blurry.', components: [c('ins_wac')] },
        { id: 'nac', label: 'Zoom camera', tier: 2, blurb: 'Sharp crater photos (LROC-style).', components: [c('ins_nac')] },
        { id: 'nac_lidar', label: 'Zoom camera + laser', tier: 3, blurb: 'Photos plus 3D crater depths (LOLA-style).', components: [c('ins_nac'), c('ins_lidar')] },
      ]),
      slot('comms', 'Photos are useless until they reach Earth.', [
        { id: 'omni', label: 'Basic radio', tier: 1, blurb: 'Simple antenna. Slow: 2 Mbps.', components: [c('com_s')] },
        { id: 'dish', label: 'Dish antenna', tier: 2, blurb: '0.8 m dish: 10× faster.', components: [c('com_mga')] },
        { id: 'ka', label: 'Ka-band dish + backup', tier: 3, blurb: '100 Mbps, plus a spare radio.', components: [c('com_kamga'), c('com_s')] },
      ]),
      slot('orbit', 'How high above the Moon you fly.', [
        { id: 'high', label: 'High orbit (200 km)', tier: 1, blurb: 'Stable and fuel-cheap, but blurrier maps.', orbit: { id: 'llo', altitudeKm: 200, ltan: 'day' } },
        { id: 'mid', label: 'Medium orbit (100 km)', tier: 2, blurb: 'A good balance of detail and fuel.', orbit: { id: 'llo', altitudeKm: 100, ltan: 'day' } },
        { id: 'low', label: 'Low orbit (30 km)', tier: 3, blurb: 'Sharpest maps; lumpy gravity eats fuel.', orbit: { id: 'llo', altitudeKm: 30, ltan: 'day' } },
      ]),
    ],
  },
  storm: {
    busIds: ['bus_espa', 'bus_mid'], base: [c('obc_radtol'), c('adcs_rw', 4), c('adcs_mtq'), c('th_mli')],
    defaultOrbit: { id: 'sso', altitudeKm: 600, ltan: 'day' }, groundNetworkId: 'gs_comm', contactHoursPerDay: 4,
    autoRockets: ['lv_ride', 'lv_electron', 'lv_alpha', 'lv_f9'],
    slots: [
      slot('engine', 'Fights air drag and steers you down at the end (space-junk rule).', [
        { id: 'none', label: 'No engine', tier: 1, blurb: 'Free — but you drift and can\'t clean up after.', components: [] },
        { id: 'mono', label: 'Small thrusters', tier: 2, blurb: 'Keeps your orbit up and deorbits you at the end.', components: [c('prop_hydrazine')] },
        { id: 'hall', label: 'Electric thruster', tier: 3, blurb: '7× more fuel-efficient, but power-hungry.', components: [c('prop_hall')] },
      ]),
      slot('fuel', 'An engine needs a tank. Extra fuel is extra weight.', [
        { id: 'small', label: 'Small tank', tier: 1, blurb: 'Holds 80 kg.', components: [c('tank_s')] },
        { id: 'two', label: 'Two small tanks', tier: 2, blurb: 'Holds 160 kg.', components: [c('tank_s', 2)] },
        { id: 'medium', label: 'Medium tank', tier: 3, blurb: 'Holds 350 kg. Way more than needed?', components: [c('tank_m')] },
      ]),
      slot('power', 'Your satellite spends ~35% of each orbit in Earth\'s shadow.', [
        { id: 'small', label: 'Small panel', tier: 1, blurb: '500 W panel, 1 battery.', components: [c('pwr_tj500'), c('bat_1k')] },
        { id: 'two', label: 'Two panels', tier: 2, blurb: '1 kW, 1 battery.', components: [c('pwr_tj500', 2), c('bat_1k')] },
        { id: 'wing', label: 'Big solar wing', tier: 3, blurb: '2 kW, 2 batteries.', components: [c('pwr_tj2k'), c('bat_1k', 2)] },
      ]),
      slot('instrument', 'How you see storms.', [
        { id: 'mwr', label: 'Mini storm sounder', tier: 1, blurb: 'Tiny microwave sensor that sees inside clouds.', components: [c('ins_mwr'), c('opt_patch')] },
        { id: 'tir', label: 'Thermal camera', tier: 2, blurb: 'Measures cloud-top and ocean temperature.', components: [c('ins_tir')] },
        { id: 'both', label: 'Thermal camera + sounder', tier: 3, blurb: 'Inside and on top of every storm.', components: [c('ins_tir'), c('ins_mwr'), c('opt_patch')] },
      ]),
      slot('comms', 'Weather data must reach forecasters fast.', [
        { id: 's', label: 'Basic radio', tier: 1, blurb: 'S-band, 2 Mbps.', components: [c('com_s')] },
        { id: 'x', label: 'X-band downlink', tier: 2, blurb: 'Hundreds of Mbps.', components: [c('com_x')] },
        { id: 'xs', label: 'X-band + backup', tier: 3, blurb: 'Fast link plus a spare radio.', components: [c('com_x'), c('com_s')] },
      ]),
      slot('orbit', 'Where you watch from.', [
        { id: 'leo', label: 'Low tilted orbit', tier: 1, blurb: '450 km. Sharp, but misses the poles and drag is strong.', orbit: { id: 'leo', altitudeKm: 450, ltan: 'day' } },
        { id: 'sso', label: 'Polar orbit 600 km', tier: 2, blurb: 'Sees the whole Earth every day.', orbit: { id: 'sso', altitudeKm: 600, ltan: 'day' } },
        { id: 'sso_hi', label: 'Polar orbit 850 km', tier: 3, blurb: 'Wider view per pass, but stays up for a century.', orbit: { id: 'sso', altitudeKm: 850, ltan: 'day' } },
      ]),
    ],
  },
};

// ── MEDIUM ───────────────────────────────────────────────────────────────────
export const MEDIUM_PRESETS: Record<string, MissionPresetSet> = {
  lim: {
    busIds: ['bus_deepsmall', 'bus_mid'], base: [c('obc_rad750')],
    defaultOrbit: { id: 'llo', altitudeKm: 50, ltan: 'day' }, groundNetworkId: 'gs_comm', contactHoursPerDay: 8, autoRockets: [],
    slots: [
      slot('engine', 'Isp = fuel efficiency. Higher Isp means less propellant for the same Δv (speed change).', [
        { id: 'mono', label: 'Hydrazine (Isp 225 s)', tier: 1, blurb: 'Simple, strong push. Needs the most fuel.', components: [c('prop_hydrazine')] },
        { id: 'hall', label: 'Xenon Hall thruster (Isp 1,600 s)', tier: 2, blurb: '7× less fuel, but needs ~1.4 kW and a slow spiral.', components: [c('prop_hall')] },
        { id: 'hybrid', label: 'Hydrazine + Hall', tier: 3, blurb: 'Chemical for capture, electric for station-keeping.', components: [c('prop_hydrazine'), c('prop_hall')] },
      ]),
      slot('fuel', 'Tsiolkovsky: fuel needed grows exponentially with Δv ÷ Isp.', [
        { id: 's', label: '80 kg tank', tier: 1, blurb: 'Light. Only enough with an efficient engine.', components: [c('tank_s')] },
        { id: 'm', label: '350 kg tank', tier: 2, blurb: 'Standard.', components: [c('tank_m')] },
        { id: 'mm', label: 'Two 350 kg tanks', tier: 3, blurb: 'Room for a big reserve.', components: [c('tank_m', 2)] },
      ]),
      slot('power', 'Arrays must also recharge batteries for each lunar night-side pass.', [
        { id: 'a', label: '1 kW panels + 1 battery', tier: 1, blurb: 'Enough for chemical engines only.', components: [c('pwr_tj500', 2), c('bat_1k')] },
        { id: 'b', label: '2 kW wing + 2 batteries', tier: 2, blurb: 'Can run a Hall thruster.', components: [c('pwr_tj2k'), c('bat_1k', 2)] },
        { id: 'c', label: '4 kW wings + 3 batteries', tier: 3, blurb: 'Lots of power, lots of mass.', components: [c('pwr_tj2k', 2), c('bat_1k', 3)] },
      ]),
      slot('instrument', 'Hydrogen in ice absorbs neutrons; lidar sees into dark craters.', [
        { id: 'n', label: 'Neutron spectrometer', tier: 1, blurb: 'Finds hydrogen. Coarse but essential.', components: [c('ins_neutron')] },
        { id: 'ni', label: 'Neutron + IR spectrometer', tier: 2, blurb: 'Adds surface frost (sunlit only).', components: [c('ins_neutron'), c('ins_irspec')] },
        { id: 'nl', label: 'Neutron + lidar', tier: 3, blurb: 'Hydrogen + crater brightness: +20% science.', components: [c('ins_neutron'), c('ins_lidar')] },
        { id: 'all', label: 'Neutron + lidar + IR + thermal', tier: 4, blurb: 'Everything. Heavy and power-hungry.', components: [c('ins_neutron'), c('ins_lidar'), c('ins_irspec'), c('ins_tir')] },
      ]),
      slot('comms', 'Signal strength falls with distance²: the Moon is 1,000× farther than LEO.', [
        { id: 's', label: 'Omni radio + commercial dishes', tier: 1, blurb: 'Cheap, ~kbps from the Moon.', components: [c('com_s')], groundNetworkId: 'gs_comm', contactHoursPerDay: 8 },
        { id: 'mga', label: '0.8 m dish + commercial dishes', tier: 2, blurb: 'Good balance.', components: [c('com_mga')], groundNetworkId: 'gs_comm', contactHoursPerDay: 8 },
        { id: 'dsn', label: '0.8 m dish + NASA Deep Space Network', tier: 3, blurb: 'Huge 34 m dishes: fastest, priciest.', components: [c('com_mga')], groundNetworkId: 'gs_dsn34', contactHoursPerDay: 8 },
      ]),
      slot('attitude', 'Lidars and dishes need precise pointing. Wheels wear out — a 4th is a spare.', [
        { id: '3w', label: '3 reaction wheels', tier: 1, blurb: 'Just enough. One failure = trouble.', components: [c('adcs_rw', 3)] },
        { id: '4w', label: '4 wheels + star tracker', tier: 2, blurb: 'Spare wheel, 0.01° pointing.', components: [c('adcs_rw', 4), c('adcs_st')] },
        { id: '4w2', label: '4 wheels + 2 star trackers', tier: 3, blurb: 'Fully redundant.', components: [c('adcs_rw', 4), c('adcs_st', 2)] },
      ]),
      slot('thermal', 'Every watt becomes heat. Blankets keep cold out; radiators dump heat.', [
        { id: 'paint', label: 'Paint only', tier: 1, blurb: 'Free, but heaters burn extra power.', components: [] },
        { id: 'mli', label: 'Insulation blankets', tier: 2, blurb: 'Standard MLI.', components: [c('th_mli')] },
        { id: 'rad', label: 'Blankets + radiator', tier: 3, blurb: 'For hot instruments and sunny poles.', components: [c('th_mli'), c('th_rad')] },
      ]),
      slot('orbit', 'Lower orbits sharpen the ice map, but lumpy lunar gravity costs more fuel.', [
        { id: 'h', label: '100 km', tier: 1, blurb: 'Fuel-cheap, blurrier.', orbit: { id: 'llo', altitudeKm: 100, ltan: 'day' } },
        { id: 'm', label: '50 km', tier: 2, blurb: 'Balanced.', orbit: { id: 'llo', altitudeKm: 50, ltan: 'day' } },
        { id: 'l', label: '30 km', tier: 3, blurb: 'Sharpest, thirstiest.', orbit: { id: 'llo', altitudeKm: 30, ltan: 'day' } },
      ]),
      slot('rocket', 'Rockets sell energy: going to the Moon cuts payload ~5× vs low orbit.', [
        { id: 'electron', label: 'Electron', tier: 1, blurb: '$7.5M, only ~30 kg to the Moon.', launchVehicleId: 'lv_electron' },
        { id: 'f9', label: 'Falcon 9', tier: 2, blurb: '$70M, 2.8 t to the Moon.', launchVehicleId: 'lv_f9' },
        { id: 'atlas', label: 'Atlas V', tier: 3, blurb: '$160M, 7 t, ultra-reliable.', launchVehicleId: 'lv_atlas' },
      ]),
    ],
  },
  ast: {
    busIds: ['bus_mid'], base: [c('obc_rad750')],
    defaultOrbit: { id: 'vesta', altitudeKm: 700, ltan: 'day' }, groundNetworkId: 'gs_dsn34', contactHoursPerDay: 8, autoRockets: [],
    slots: [
      slot('engine', 'Reaching Vesta takes ~5 km/s of Δv. Isp decides if that is possible.', [
        { id: 'biprop', label: 'Chemical biprop (Isp 320 s)', tier: 1, blurb: 'Strong but thirsty: needs ~4× your mass in fuel.', components: [c('prop_biprop')] },
        { id: 'hall', label: 'Hall thruster (Isp 1,600 s)', tier: 2, blurb: 'Electric, needs ~1.5 kW in cruise.', components: [c('prop_hall')] },
        { id: 'ion', label: 'Ion engine (Isp 3,100 s)', tier: 3, blurb: 'Dawn\'s engine: tiny fuel, needs ~2.5 kW.', components: [c('prop_ion')] },
        { id: 'ion2', label: 'Two ion engines', tier: 4, blurb: 'A spare engine for a 3-year cruise.', components: [c('prop_ion', 2)] },
      ]),
      slot('fuel', 'Fuel needed = dry mass × (e^(Δv / (Isp·g)) − 1).', [
        { id: 'm', label: '350 kg tank', tier: 1, blurb: 'Enough only with an ion engine.', components: [c('tank_m')] },
        { id: 'l', label: '1,000 kg tank', tier: 2, blurb: 'Standard.', components: [c('tank_l')] },
        { id: 'll', label: 'Two 1,000 kg tanks', tier: 3, blurb: 'Huge reserve, huge mass.', components: [c('tank_l', 2)] },
      ]),
      slot('power', 'Sunlight drops with distance²: at 2.4 AU you get 1/6 of Earth\'s.', [
        { id: 'a', label: '4 kW rigid wings', tier: 1, blurb: 'Only ~700 W at Vesta.', components: [c('pwr_tj2k', 2), c('bat_1k', 2)] },
        { id: 'b', label: '8 kW roll-out array', tier: 2, blurb: '~1.4 kW at Vesta (Dawn-class).', components: [c('pwr_rosa'), c('bat_1k', 2)] },
        { id: 'c', label: '8 kW array + 2 kW wing', tier: 3, blurb: 'Extra margin for heaters and radio.', components: [c('pwr_rosa'), c('pwr_tj2k'), c('bat_1k', 2)] },
        { id: 'd', label: 'Two 8 kW arrays', tier: 4, blurb: 'Massive power, massive cost.', components: [c('pwr_rosa', 2), c('bat_1k', 3)] },
      ]),
      slot('instrument', 'Shapes from cameras, minerals from spectra, elements from neutrons.', [
        { id: 'cam', label: 'Framing camera', tier: 1, blurb: 'Maps craters only.', components: [c('ins_nac')] },
        { id: 'ci', label: 'Camera + IR spectrometer', tier: 2, blurb: 'Shapes + minerals: +15%.', components: [c('ins_nac'), c('ins_irspec')] },
        { id: 'cn', label: 'Camera + neutron/gamma', tier: 3, blurb: 'Shapes + elements.', components: [c('ins_nac'), c('ins_neutron')] },
        { id: 'all', label: 'Camera + IR + neutron', tier: 4, blurb: 'The full Dawn payload.', components: [c('ins_nac'), c('ins_irspec'), c('ins_neutron')] },
      ]),
      slot('comms', 'At 3+ AU, data rate depends on dish size: double the dish, 4× the rate.', [
        { id: 'mga', label: '0.8 m dish + DSN 34 m', tier: 1, blurb: 'Light, but a trickle of data.', components: [c('com_mga')], groundNetworkId: 'gs_dsn34', contactHoursPerDay: 8 },
        { id: 'hga', label: '3 m dish + DSN 34 m', tier: 2, blurb: 'Standard deep-space link.', components: [c('com_hga')], groundNetworkId: 'gs_dsn34', contactHoursPerDay: 8 },
        { id: 'hga70', label: '3 m dish + DSN 70 m', tier: 3, blurb: 'Giant dishes, 8 h/day max.', components: [c('com_hga')], groundNetworkId: 'gs_dsn70', contactHoursPerDay: 8 },
      ]),
      slot('attitude', 'A 3 m dish needs ~0.1° pointing. Dawn lost two wheels in flight!', [
        { id: '3w', label: '3 big wheels', tier: 1, blurb: 'No spare.', components: [c('adcs_rwl', 3)] },
        { id: '4w', label: '4 wheels + star tracker', tier: 2, blurb: 'One spare.', components: [c('adcs_rwl', 4), c('adcs_st')] },
        { id: '4w2', label: '4 wheels + 2 star trackers', tier: 3, blurb: 'Fully redundant.', components: [c('adcs_rwl', 4), c('adcs_st', 2)] },
      ]),
      slot('thermal', 'Far from the Sun it is cold: no blankets = big heater bills.', [
        { id: 'paint', label: 'Paint only', tier: 1, blurb: 'Heaters eat your scarce power.', components: [] },
        { id: 'mli', label: 'Insulation blankets', tier: 2, blurb: 'Standard MLI.', components: [c('th_mli')] },
        { id: 'rad', label: 'Blankets + radiator', tier: 3, blurb: 'Extra heat rejection.', components: [c('th_mli'), c('th_rad')] },
      ]),
      slot('orbit', 'Lower = sharper pictures (resolution ∝ 1/altitude).', [
        { id: 'survey', label: 'Survey 2,700 km', tier: 1, blurb: 'Whole-asteroid views.', orbit: { id: 'vesta', altitudeKm: 2700, ltan: 'day' } },
        { id: 'hamo', label: 'Mapping 700 km', tier: 2, blurb: 'Dawn\'s main mapping orbit.', orbit: { id: 'vesta', altitudeKm: 700, ltan: 'day' } },
        { id: 'lamo', label: 'Low 210 km', tier: 3, blurb: 'Best detail and neutron counts.', orbit: { id: 'vesta', altitudeKm: 210, ltan: 'day' } },
      ]),
      slot('rocket', 'Escape velocity + a head start: C3 ≈ 11 km²/s² cuts capacity a lot.', [
        { id: 'f9', label: 'Falcon 9', tier: 1, blurb: '$70M, ~1.7 t on this path.', launchVehicleId: 'lv_f9' },
        { id: 'atlas', label: 'Atlas V', tier: 2, blurb: '$160M, ~4.3 t.', launchVehicleId: 'lv_atlas' },
        { id: 'fh', label: 'Falcon Heavy', tier: 3, blurb: '$150M, ~12 t.', launchVehicleId: 'lv_fh' },
      ]),
    ],
  },
};

export function presetsFor(objectiveId: string, difficulty: string): { set: MissionPresetSet; mode: 'easy' | 'medium' } | null {
  if (difficulty === 'cadet' && EASY_PRESETS[objectiveId]) return { set: EASY_PRESETS[objectiveId], mode: 'easy' };
  if (difficulty === 'engineer' && MEDIUM_PRESETS[objectiveId]) return { set: MEDIUM_PRESETS[objectiveId], mode: 'medium' };
  return null;
}
