// Real NASA missions (Academy history cards + "closest real mission" matcher),
// short official links, and the band/optics facts used by the payload chain.
import type { Discipline, Wavelength } from '../types';

export interface ResourceLink { id: string; title: string; url: string; org: string; summary: string }

export const NASA_LINKS: ResourceLink[] = [
  { id: 'gmat', title: 'General Mission Analysis Tool (GMAT)', url: 'https://software.nasa.gov/software/GSC-19468-1', org: 'NASA GSFC',
    summary: 'NASA\'s free trajectory tool. Our orbit math (periods, eclipses, Δv) follows the same physics.' },
  { id: 'missionviz', title: 'NASA Mission Viz', url: 'https://nasa.github.io/mission-viz/', org: 'NASA',
    summary: '3D mission trajectory viewer — inspiration for the replay in Mission Control.' },
  { id: 'webb-game', title: 'Webb "Build It Yourself" game', url: 'https://science.nasa.gov/mission/webb/game-build-it-yourself/', org: 'NASA Science',
    summary: 'Pick mirrors, instruments and orbits for a telescope.' },
  { id: 'seh', title: 'NASA Systems Engineering Handbook', url: 'https://www.nasa.gov/reference/systems-engineering-handbook/', org: 'NASA',
    summary: 'How NASA balances mass, power, cost and risk on real missions.' },
  { id: 'ssi', title: 'NASA Small Spacecraft Institute', url: 'https://www.nasa.gov/smallsat-institute', org: 'NASA',
    summary: 'Real numbers for small spacecraft parts.' },
  { id: 'eyes', title: 'NASA\'s Eyes on the Solar System', url: 'https://eyes.nasa.gov/apps/solar-system/', org: 'NASA JPL',
    summary: 'See where real spacecraft are right now.' },
];

export const DISCIPLINES: Record<Discipline, { name: string; icon: string; color: string }> = {
  earth: { name: 'Earth Science', icon: '🌍', color: '#4ade80' },
  helio: { name: 'Heliophysics', icon: '☀️', color: '#fbbf24' },
  planetary: { name: 'Planetary Science', icon: '🪐', color: '#f97316' },
  astro: { name: 'Astrophysics', icon: '🌌', color: '#a78bfa' },
};

export const WAVELENGTHS: Record<Wavelength, { name: string; color: string; sees: string }> = {
  radio: { name: 'Radio / Microwave', color: '#f87171', sees: 'Sees through clouds and ice.' },
  ir: { name: 'Infrared', color: '#fb923c', sees: 'Heat, minerals and water.' },
  visible: { name: 'Visible', color: '#facc15', sees: 'What your eyes see: shapes and colours.' },
  uv: { name: 'Ultraviolet', color: '#a78bfa', sees: 'Hot gas, flares, ozone.' },
  xray: { name: 'X-ray', color: '#60a5fa', sees: 'Million-degree gas and flares.' },
  gamma: { name: 'Gamma / neutron', color: '#e879f9', sees: 'Elements and hidden hydrogen (ice).' },
  insitu: { name: 'Fields & particles', color: '#94a3b8', sees: 'Magnetism and gas, measured on the spot.' },
};

export const OPTICS_INFO: Record<string, { name: string; for: Wavelength[] }> = {
  cnt_mirror: { name: 'Nanotube mirror', for: ['visible', 'ir', 'uv'] },
  segmented_mirror: { name: 'Segmented mirror', for: ['ir', 'visible'] },
  monolith_mirror: { name: 'Monolithic mirror', for: ['ir', 'visible', 'uv'] },
  grazing_xray: { name: 'Grazing X-ray optics', for: ['xray'] },
  patch_array: { name: 'Patch antenna array', for: ['radio'] },
};

export type FleetOrbit = 'LEO' | 'SSO' | 'GEO' | 'L1' | 'L2' | 'LUNAR' | 'MARS' | 'ASTEROID' | 'JUPITER' | 'HELIO';
export interface FleetMission {
  id: string; name: string; icon: string; year: string; status: 'flown' | 'operating' | 'development';
  discipline: Discipline; orbit: FleetOrbit; massClass: 'cube' | 'small' | 'mid' | 'large' | 'flagship'; bands: Wavelength[];
  fleet: number; propulsion: 'none' | 'chemical' | 'electric'; power: 'solar' | 'rtg';
  /** One-line fun fact for the Academy history card. */
  fact: string;
  /** Short lore shown when your design matches it. */
  lore: string;
}

export const FLEET_MISSIONS: FleetMission[] = [
  { id: 'lro', name: 'Lunar Reconnaissance Orbiter', icon: '🌕', year: '2009', status: 'operating', discipline: 'planetary', orbit: 'LUNAR', massClass: 'mid', bands: ['visible', 'ir', 'gamma', 'uv'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Photographed the Apollo landing sites — you can see the astronauts\' footpaths.', lore: 'Cameras and a laser altimeter have mapped the whole Moon in 3D since 2009.' },
  { id: 'lcross', name: 'LCROSS', icon: '💥', year: '2009', status: 'flown', discipline: 'planetary', orbit: 'LUNAR', massClass: 'small', bands: ['visible', 'ir'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Crashed a rocket stage into a dark crater and found water in the splash.', lore: 'Slammed its spent upper stage into Cabeus crater and tasted the plume for water.' },
  { id: 'trailblazer', name: 'Lunar Trailblazer', icon: '🔦', year: '2025', status: 'flown', discipline: 'planetary', orbit: 'LUNAR', massClass: 'small', bands: ['ir'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'A 200 kg smallsat built to map lunar water; contact was lost soon after launch.', lore: 'A small IR mapper for lunar water — a reminder that small missions carry real risk.' },
  { id: 'goes', name: 'GOES-R weather satellites', icon: '🌀', year: '2016', status: 'operating', discipline: 'earth', orbit: 'GEO', massClass: 'large', bands: ['visible', 'ir'], fleet: 4, propulsion: 'chemical', power: 'solar',
    fact: 'Takes a picture of a hurricane every 30 seconds from 36,000 km up.', lore: 'Geostationary weather eyes that watch storms grow minute by minute.' },
  { id: 'jpss', name: 'JPSS / NOAA-21', icon: '🌡️', year: '2022', status: 'operating', discipline: 'earth', orbit: 'SSO', massClass: 'large', bands: ['visible', 'ir', 'radio'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Its data feed most of the world\'s 3–7 day weather forecasts.', lore: 'A polar weather satellite with microwave and infrared sounders that profile the atmosphere.' },
  { id: 'tropics', name: 'TROPICS', icon: '🛰️', year: '2023', status: 'operating', discipline: 'earth', orbit: 'LEO', massClass: 'cube', bands: ['radio'], fleet: 4, propulsion: 'none', power: 'solar',
    fact: 'Shoebox CubeSats that peek inside hurricanes about once an hour.', lore: 'Tiny microwave sounders flying as a team to revisit storms quickly.' },
  { id: 'gpm', name: 'GPM Core Observatory', icon: '🌧️', year: '2014', status: 'operating', discipline: 'earth', orbit: 'LEO', massClass: 'large', bands: ['radio'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Measures rain and snow everywhere on Earth every 3 hours (with partners).', lore: 'A rain radar plus a microwave imager — the reference for global precipitation.' },
  { id: 'dawn', name: 'Dawn', icon: '☄️', year: '2007', status: 'flown', discipline: 'planetary', orbit: 'ASTEROID', massClass: 'mid', bands: ['visible', 'ir', 'gamma'], fleet: 1, propulsion: 'electric', power: 'solar',
    fact: 'First spacecraft to orbit two different worlds: Vesta and Ceres.', lore: 'Ion engines and big solar wings carried it to Vesta and Ceres.' },
  { id: 'psyche', name: 'Psyche', icon: '🪨', year: '2023', status: 'operating', discipline: 'planetary', orbit: 'ASTEROID', massClass: 'large', bands: ['gamma', 'visible'], fleet: 1, propulsion: 'electric', power: 'solar',
    fact: 'Heading to a metal asteroid that may be the core of a baby planet.', lore: 'Hall thrusters push it to a metal-rich asteroid.' },
  { id: 'mro', name: 'Mars Reconnaissance Orbiter', icon: '🔴', year: '2005', status: 'operating', discipline: 'planetary', orbit: 'MARS', massClass: 'large', bands: ['visible', 'ir', 'radio'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Has sent home more data than all other Mars missions combined.', lore: 'A telescope camera, a mineral spectrometer and a radar on a 2-tonne orbiter.' },
  { id: 'maven', name: 'MAVEN', icon: '🌬️', year: '2013', status: 'operating', discipline: 'planetary', orbit: 'MARS', massClass: 'mid', bands: ['uv', 'insitu'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Showed how the Sun stripped away most of Mars\' air.', lore: 'Samples the thin upper atmosphere of Mars to learn where its air went.' },
  { id: 'odyssey', name: 'Mars Odyssey', icon: '❄️', year: '2001', status: 'operating', discipline: 'planetary', orbit: 'MARS', massClass: 'mid', bands: ['ir', 'gamma'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Found buried water ice across Mars — and is the longest-serving Mars spacecraft.', lore: 'A gamma/neutron detector mapped hydrogen (ice) under the Martian soil.' },
  { id: 'clipper', name: 'Europa Clipper', icon: '🪐', year: '2024', status: 'operating', discipline: 'planetary', orbit: 'JUPITER', massClass: 'flagship', bands: ['radio', 'insitu', 'ir', 'visible'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Its solar wings span 30 m — longer than a basketball court.', lore: 'Huge solar arrays and a radiation vault carry radar and a magnetometer past Europa.' },
  { id: 'juno', name: 'Juno', icon: '🌀', year: '2011', status: 'operating', discipline: 'planetary', orbit: 'JUPITER', massClass: 'large', bands: ['radio', 'ir', 'insitu'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'First solar-powered spacecraft at Jupiter; its electronics live in a titanium vault.', lore: 'Dives over Jupiter\'s poles inside a titanium radiation vault.' },
  { id: 'galileo', name: 'Galileo', icon: '⚛️', year: '1989', status: 'flown', discipline: 'planetary', orbit: 'JUPITER', massClass: 'flagship', bands: ['visible', 'ir', 'insitu'], fleet: 1, propulsion: 'chemical', power: 'rtg',
    fact: 'Its magnetometer gave the first clue to Europa\'s hidden ocean.', lore: 'RTG-powered orbiter whose magnetometer hinted at Europa\'s salty ocean.' },
  { id: 'voyager', name: 'Voyager 1 & 2', icon: '✨', year: '1977', status: 'operating', discipline: 'helio', orbit: 'HELIO', massClass: 'mid', bands: ['visible', 'insitu', 'radio'], fleet: 2, propulsion: 'chemical', power: 'rtg',
    fact: 'Still talking to Earth from interstellar space with a 23-watt radio.', lore: 'RTG-powered explorers now beyond the Sun\'s bubble.' },
  { id: 'jwst', name: 'James Webb Space Telescope', icon: '🌌', year: '2021', status: 'operating', discipline: 'astro', orbit: 'L2', massClass: 'flagship', bands: ['ir'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Its sunshield is the size of a tennis court and keeps the mirror at −233 °C.', lore: 'A 6.5 m folding mirror kept ice-cold behind a giant sunshield at L2.' },
  { id: 'dscovr', name: 'DSCOVR', icon: '☀️', year: '2015', status: 'operating', discipline: 'helio', orbit: 'L1', massClass: 'mid', bands: ['insitu', 'visible'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Gives about one hour of warning before a solar storm hits Earth.', lore: 'Sits at L1 sampling the solar wind for space-weather warnings.' },
  { id: 'landsat', name: 'Landsat 9', icon: '🗺️', year: '2021', status: 'operating', discipline: 'earth', orbit: 'SSO', massClass: 'large', bands: ['visible', 'ir'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Part of a 50-year record of Earth\'s land from space.', lore: 'Images every spot on Earth every 16 days in visible and thermal light.' },
  { id: 'icesat2', name: 'ICESat-2', icon: '🧊', year: '2018', status: 'operating', discipline: 'earth', orbit: 'LEO', massClass: 'mid', bands: ['visible'], fleet: 1, propulsion: 'chemical', power: 'solar',
    fact: 'Fires 10,000 laser pulses a second to measure ice height to a centimetre.', lore: 'A laser altimeter tracking ice sheets and sea ice.' },
];
