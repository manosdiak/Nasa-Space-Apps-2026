// SPACE MISSION building — the one place to design and launch.
//  • Easy:   4-slide mini-guide + exactly 3 choices (💲 / 💲💲 / 💲💲💲) for Engine, Fuel Tank, Power,
//            Science, Comms and Orbit. The frame (bus) and rocket are picked automatically.
//  • Medium: 9 subsystems with 3–4 options, each with a one-line "why" and live numbers (Δv, fuel, watts, data).
//  • Hard / Sandbox: the full parts catalog, every orbit, rocket and ground network.
import { useMemo, useState } from 'react';
import { ALL_COMPONENTS, CATEGORY_INFO, COMPONENT_MAP, busRank } from '../../../shared/data/components';
import { DIFFICULTY_MAP, GN_MAP, GROUND_NETWORKS, LAUNCH_VEHICLES, LEVEL_INFO, OBJECTIVE_MAP, ORBITS, ORBIT_MAP } from '../../../shared/data/mission';
import { presetsFor, type MissionPresetSet, type PresetOption, type PresetSlot } from '../../../shared/data/missionPresets';
import { orbitAltitude, orbitGeometry } from '../../../shared/engine/physics';
import { presetsComplete } from '../../../shared/engine/presets';
import type { ComponentCategory, ResourceState, SpacecraftComponent } from '../../../shared/types';
import { useStore } from '../../state/store';
import { PixelWorld } from '../PixelWorld';
import { OrbitDiagram } from '../widgets/OrbitDiagram';
import { ResourceBars } from '../widgets/ResourceBars';
import { OwnerNote, PanelFrame, Section, money, n, pct } from '../widgets/common';
import { SpacecraftVisualizer } from './Visualizer';

export function SpaceMissionPanel({ tab }: { tab?: string }) {
  const room = useStore((s) => s.room)!;
  const res = useStore((s) => s.resources)!;
  const guideSeen = useStore((s) => s.guideSeen);
  const markGuideSeen = useStore((s) => s.markGuideSeen);
  const openSelect = useStore((s) => s.openSelect);
  const can = useStore((s) => s.can);
  const d = room.design;
  const obj = OBJECTIVE_MAP[d.objectiveId];
  const p = presetsFor(d.objectiveId, d.difficulty);
  const [guide, setGuide] = useState(p?.mode === 'easy' && !guideSeen[obj.id]);
  const lvl = LEVEL_INFO[obj.level];
  return (
    <PanelFrame wide icon="🛰" title={`SPACE MISSION · ${obj.name.toUpperCase()}`} subtitle={obj.tagline}
      footer={<div className="flex items-center gap-2 flex-wrap text-[16px]">
        <span className="font-pixel text-[8px] px-2 py-1 border-2 border-black" style={{ background: lvl.color, color: '#0b1020' }}>{lvl.label}</span>
        <span className="text-muted">{DIFFICULTY_MAP[d.difficulty].blurb}</span>
        <div className="flex-1" />
        {p?.mode === 'easy' && <button className="px-btn sm ghost" onClick={() => setGuide(true)}>? GUIDE</button>}
        {can('director') && room.phase !== 'sim' && <button className="px-btn sm ghost" onClick={openSelect}>🔁 CHANGE MISSION</button>}
      </div>}>
      {guide && <EasyGuide onDone={() => { setGuide(false); markGuideSeen(obj.id); }} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {p ? <PresetBuilder set={p.set} mode={p.mode} res={res} /> : <HardBuilder initial={tab === 'launch' ? 'rocket' : 'parts'} />}
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-0 self-start w-full">
          <div className="px-inset p-2">
            <div className="flex items-center gap-2">
              <PixelWorld mission={obj.id} size={40} />
              <div className="min-w-0">
                <div className="font-pixel text-[8px] text-gold truncate">{obj.target.toUpperCase()}</div>
                <div className="text-[15px] text-muted leading-tight">{obj.brief}</div>
              </div>
            </div>
            <SpacecraftVisualizer design={d} height={150} />
          </div>
          <div className="px-inset p-2"><ResourceBars res={res} sandbox={d.difficulty === 'sandbox'} detail={!p} /></div>
          <LaunchBox />
        </aside>
      </div>
    </PanelFrame>
  );
}

// ── Easy mini-guide ─────────────────────────────────────────────────────────
function EasyGuide({ onDone }: { onDone: () => void }) {
  const room = useStore((s) => s.room)!;
  const obj = OBJECTIVE_MAP[room.design.objectiveId];
  const [i, setI] = useState(0);
  const slides = [
    { icon: <PixelWorld mission={obj.id} size={96} />, title: 'Your mission', text: obj.brief },
    { icon: <span className="text-[64px]">🧩</span>, title: 'Pick 6 parts', text: 'Engine, Fuel, Power, Science, Comms and Orbit. Each has 3 choices: 💲 cheap · 💲💲 balanced · 💲💲💲 best.' },
    { icon: <span className="text-[64px]">📊</span>, title: 'Watch the bars', text: 'Green = good, yellow = tight, red = broken. Fix every red bar before launch.' },
    { icon: <span className="text-[64px]">🚀</span>, title: 'Launch!', text: 'Press LAUNCH, then watch it fly in Mission Control.' },
  ];
  const s = slides[i];
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label="Mission guide">
      <div className="px-frame w-full max-w-[460px] p-5 text-center slide-up">
        <div className="font-pixel text-[8px] text-muted">GUIDE {i + 1} / {slides.length}</div>
        <div className="my-3 flex justify-center">{s.icon}</div>
        <div className="font-pixel text-[13px] text-gold">{s.title}</div>
        <p className="text-[21px] leading-snug mt-2">{s.text}</p>
        <div className="flex justify-center gap-2 my-3">{slides.map((_, k) => <span key={k} className={`w-3 h-3 border-2 border-black ${k === i ? 'bg-gold' : 'bg-line'}`} />)}</div>
        <div className="flex gap-2 justify-center">
          <button className="px-btn ghost" onClick={onDone}>SKIP</button>
          {i > 0 && <button className="px-btn" onClick={() => setI(i - 1)}>◀ BACK</button>}
          <button className="px-btn primary" onClick={() => (i + 1 < slides.length ? setI(i + 1) : onDone())}>{i + 1 < slides.length ? 'NEXT ▶' : "LET'S BUILD!"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Easy / Medium preset builder ───────────────────────────────────────────
const TIER_COST = ['', '💲', '💲💲', '💲💲💲', '💲💲💲💲'];

function optionCost(o: PresetOption) {
  let kg = 0, $ = 0;
  for (const c of o.components ?? []) { const comp = COMPONENT_MAP[c.id]; if (comp) { kg += comp.mass_kg * c.qty; $ += comp.cost_millions * c.qty; } }
  return { kg, $ };
}

function PresetBuilder({ set, mode, res }: { set: MissionPresetSet; mode: 'easy' | 'medium'; res: ResourceState }) {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const d = room.design;
  const chosen = d.presets ?? {};
  const done = set.slots.filter((s) => chosen[s.id]).length;
  const frozen = room.phase !== 'design';
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="font-pixel text-[9px] text-gold">{mode === 'easy' ? 'PICK ONE OPTION FOR EACH PART' : 'DESIGN YOUR SPACECRAFT'}</span>
        <span className="font-pixel text-[8px] px-2 py-1 border-2 border-black" style={{ background: done === set.slots.length ? '#4ade80' : '#fbbf24', color: '#0b1020' }}>{done}/{set.slots.length} CHOSEN</span>
        <span className="text-[16px] text-muted">Auto: 🛰 {COMPONENT_MAP[d.busId]?.name}{set.slots.some((s) => s.id === 'rocket') ? '' : ` · 🚀 ${LAUNCH_VEHICLES.find((l) => l.id === d.launchVehicleId)?.name}`}</span>
      </div>
      <div className={`grid gap-3 ${mode === 'easy' ? '' : 'xl:grid-cols-2'}`}>
        {set.slots.map((slot) => (
          <SlotCard key={slot.id} slot={slot} mode={mode} chosen={chosen[slot.id]} disabled={frozen}
            onPick={(o) => design({ k: 'preset', slot: slot.id, option: o })} readout={mode === 'medium' ? slotReadout(slot.id, res, d) : null} />
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot, mode, chosen, onPick, disabled, readout }: { slot: PresetSlot; mode: 'easy' | 'medium'; chosen?: string; onPick: (id: string) => void; disabled: boolean; readout: string | null }) {
  return (
    <div className={`px-inset p-2 ${chosen ? '' : 'pulse-warn'}`}>
      <OwnerNote role={slot.role} />
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[22px] leading-none">{slot.icon}</span>
        <span className="font-pixel text-[10px] text-cream">{slot.label.toUpperCase()}</span>
        <span className="text-[16px] text-muted leading-tight">{slot.why}</span>
      </div>
      <div className={`grid gap-2 ${slot.options.length === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {slot.options.map((o) => {
          const on = chosen === o.id;
          const c = optionCost(o);
          return (
            <button key={o.id} disabled={disabled} onClick={() => onPick(o.id)} aria-pressed={on}
              className={`text-left p-2 border-2 transition-colors ${on ? 'border-gold bg-[#2a2410]' : 'border-black bg-[#0e1530] hover:bg-[#16204a]'} disabled:opacity-60`}>
              <div className="flex items-center gap-1">
                <span className="text-[14px]">{TIER_COST[o.tier]}</span>
                <span className="flex-1" />
                {on && <span className="font-pixel text-[7px] text-gold">✓</span>}
              </div>
              <div className="font-pixel text-[9px] leading-snug mt-1 text-cream">{o.label}</div>
              <div className="text-[17px] leading-tight text-muted mt-1">{o.blurb}</div>
              {mode === 'medium' && (c.kg > 0 || c.$ > 0) && <div className="text-[14px] text-accent mt-1">{n(c.kg, 0)} kg · {money(c.$)}</div>}
            </button>
          );
        })}
      </div>
      {readout && <div className="text-[16px] text-accent mt-2">▸ {readout}</div>}
    </div>
  );
}

function slotReadout(id: string, r: ResourceState, d: { orbit: { id: string } }): string | null {
  const o = ORBIT_MAP[d.orbit.id];
  switch (id) {
    case 'engine': return `Δv needed ${n(r.mass.dvTotal, 0)} m/s${r.mass.propellantNeededKg > 0 ? ` · fuel needed ${n(r.mass.propellantNeededKg, 0)} kg` : ''}`;
    case 'fuel': return r.mass.propellantNeededKg <= 0 ? 'Pick an engine to see how much fuel you need.' : `Tanks hold ${n(r.mass.propellantCapacityKg, 0)} kg · need ${n(r.mass.propellantNeededKg, 0)} kg${r.mass.propellantCapacityKg >= r.mass.propellantNeededKg * 1.15 ? ' + reserve ✓' : r.mass.propellantCapacityKg < r.mass.propellantNeededKg ? ' ✗' : ''}`;
    case 'power': return `Makes ${n(r.power.eolW, 0)} W · needs ${n(r.power.requiredArrayW + Math.min(r.power.rtgW, r.power.loadSunW), 0)} W · sunlight ${pct(r.power.solarFluxFactor)} of Earth's`;
    case 'instrument': return `Science ${n(r.science.total, 0)} / goal ${n(r.science.baseline, 0)} pts`;
    case 'comms': return `Collect ${n(r.data.genGbPerDay, 1)} Gb/day · send ${n(r.link.downlinkGbPerDay, 1)} Gb/day at ${n(r.link.rateMbps, r.link.rateMbps < 1 ? 3 : 1)} Mbps`;
    case 'attitude': return `Pointing ${r.pointing.achievedDeg}° (need ${r.pointing.requiredDeg}°)`;
    case 'thermal': return `Heat margin ${pct(r.thermal.marginFrac)} · heaters ${n(r.thermal.heaterW, 0)} W`;
    case 'orbit': return o.contactMode === 'passes' || o.family === 'LUNAR' || o.family === 'MARS' || o.family === 'ASTEROID' ? `One orbit = ${n(r.power.periodMin, 0)} min · in shadow ${pct(r.power.eclipseFraction)}` : `Radio delay ${n(r.link.latencyS, 1)} s`;
    case 'rocket': return r.mass.lvCapacityKg > 0 ? `Lifts ${n(r.mass.lvCapacityKg, 0)} kg here · you weigh ${n(r.mass.launchMassKg, 0)} kg` : 'This rocket cannot reach your target.';
    default: return null;
  }
}

// ── Hard / Sandbox: full engineering ───────────────────────────────────────
const CATS: { id: ComponentCategory; icon: string }[] = [
  { id: 'propulsion', icon: '🔥' }, { id: 'power', icon: '🔋' }, { id: 'battery', icon: '🪫' }, { id: 'instrument', icon: '🔬' }, { id: 'optics', icon: '🔭' },
  { id: 'comms', icon: '📡' }, { id: 'computer', icon: '🧠' }, { id: 'adcs', icon: '🎯' }, { id: 'thermal', icon: '🌡️' },
];

function shortSpec(c: SpacecraftComponent): string {
  const s = c.specs;
  switch (c.category) {
    case 'power': return s.source === 'rtg' ? `${s.generationW} W anywhere` : `${s.generationW} W at Earth`;
    case 'battery': return `${s.capacityWh} Wh`;
    case 'computer': return `${s.storageGb} Gb${s.tidKrad ? ` · ${s.tidKrad} krad` : ''}`;
    case 'adcs': return s.adcsType === 'wheel' ? 'reaction wheel' : s.adcsType === 'startracker' ? `→ ${s.pointingDeg}°` : s.adcsType === 'magnetorquer' ? 'dumps momentum (LEO)' : `${s.pointingDeg}°`;
    case 'propulsion': return s.tankOnly ? `holds ${s.maxPropellantKg} kg` : `Isp ${s.ispS} s · ${s.chemical ? 'chemical' : 'electric'}${s.maxPropellantKg ? ` · ${s.maxPropellantKg} kg built-in` : ''}`;
    case 'comms': return `${s.band}${s.dishDiameterM ? ` · ${s.dishDiameterM} m dish` : ''} · ≤${s.maxRateMbps! >= 1 ? n(s.maxRateMbps!, 0) : s.maxRateMbps} Mbps`;
    case 'thermal': return s.coolsToK ? `cools to ${s.coolsToK} K` : s.addedRejectionW ? `+${s.addedRejectionW} W` : 'blankets';
    case 'optics': return `${s.apertureM} m · ×${s.opticsGain}`;
    case 'instrument': return `${c.data_rate_mbps} Mbps · ${c.science_points} pts`;
    default: return '';
  }
}

function HardBuilder({ initial }: { initial: string }) {
  const [t, setT] = useState(initial);
  const tabs = [['parts', '🧩 PARTS'], ['orbit', '🪐 ORBIT'], ['rocket', '🚀 ROCKET'], ['ground', '📡 GROUND'], ['mission', '⚙ MISSION']];
  return (
    <div>
      <div className="flex gap-1 mb-3 overflow-x-auto scroll-thin">{tabs.map(([id, label]) => <button key={id} className={`tab ${t === id ? 'on' : ''}`} onClick={() => setT(id)}>{label}</button>)}</div>
      {t === 'parts' && <PartsTab />}
      {t === 'orbit' && <OrbitTab />}
      {t === 'rocket' && <RocketTab />}
      {t === 'ground' && <GroundTab />}
      {t === 'mission' && <MissionTab />}
    </div>
  );
}

function PartsTab() {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const d = room.design;
  const obj = OBJECTIVE_MAP[d.objectiveId];
  const bus = COMPONENT_MAP[d.busId];
  const cls = bus.specs.busClass!;
  const [open, setOpen] = useState<ComponentCategory | null>('propulsion');
  const qty = (id: string) => d.components.find((s) => s.id === id)?.qty ?? 0;
  const frozen = room.phase !== 'design';
  return (
    <>
      <Section title="Spacecraft frame (bus)">
        <OwnerNote role="systems" />
        <div className="grid sm:grid-cols-2 gap-2">
          {ALL_COMPONENTS.filter((c) => c.category === 'bus').map((b) => (
            <button key={b.id} disabled={frozen} onClick={() => design({ k: 'bus', busId: b.id })} title={b.description}
              className={`text-left p-2 border-2 ${b.id === d.busId ? 'border-gold bg-[#2a2410]' : 'border-black bg-[#0e1530] hover:bg-[#16204a]'}`}>
              <div className="font-pixel text-[8px] text-cream">{b.name}</div>
              <div className="text-[15px] text-muted">carries {n(b.specs.payloadCapacityKg ?? 0, 0)} kg · {b.specs.designLifeYears} yr life · shield ×{b.specs.shieldFactor} · {money(b.cost_millions)}</div>
            </button>
          ))}
        </div>
      </Section>
      {CATS.map(({ id, icon }) => {
        const list = ALL_COMPONENTS.filter((c) => c.category === id);
        const count = list.reduce((a, c) => a + qty(c.id), 0);
        return (
          <div key={id} className="mb-2">
            <button className="w-full flex items-center gap-2 px-2 py-2 border-2 border-black bg-[#141c38] hover:bg-[#1d2850] text-left" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
              <span className="text-[18px]">{icon}</span><span className="font-pixel text-[9px] text-cream flex-1">{CATEGORY_INFO[id].label.toUpperCase()}</span>
              {count > 0 && <span className="font-pixel text-[8px] text-gold">×{count}</span>}<span className="font-pixel text-[8px]">{open === id ? '▲' : '▼'}</span>
            </button>
            {open === id && (
              <div className="p-2 border-2 border-t-0 border-black bg-black/20">
                <div className="text-[16px] text-muted mb-2">{CATEGORY_INFO[id].help}</div>
                <div className="grid gap-1">
                  {list.map((c) => {
                    const q = qty(c.id);
                    const fits = busRank(cls) >= busRank(c.minBus) && busRank(cls) <= busRank(c.maxBus);
                    const rel = c.category === 'instrument' ? obj.instrumentWeights[c.specs.kind!] ?? 0 : undefined;
                    return (
                      <div key={c.id} className={`flex items-center gap-2 p-1 border-2 ${q ? 'border-gold bg-[#211d0e]' : 'border-black bg-[#0e1530]'} ${fits ? '' : 'opacity-50'}`} title={c.description}>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[17px] text-cream leading-tight">{c.name}</span>
                            {rel !== undefined && rel > 0 && <span className="font-pixel text-[6px]" style={{ color: rel >= 0.8 ? '#4ade80' : rel >= 0.4 ? '#fbbf24' : '#9aa6d0' }}>{rel >= 0.8 ? 'KEY' : rel >= 0.4 ? 'USEFUL' : 'MINOR'}</span>}
                            {!fits && <span className="font-pixel text-[6px] text-crit">{busRank(cls) < busRank(c.minBus) ? 'NEEDS BIGGER BUS' : 'TOO SMALL FOR BUS'}</span>}
                          </div>
                          <div className="text-[14px] text-muted leading-tight">{shortSpec(c)} · {c.mass_kg} kg · {c.power_watts} W · {money(c.cost_millions)}</div>
                        </div>
                        <button className="px-btn sm" disabled={!q || frozen} onClick={() => design({ k: 'component', id: c.id, qty: q - 1 })} aria-label={`Remove ${c.name}`}>−</button>
                        <span className="font-pixel text-[10px] w-5 text-center">{q}</span>
                        <button className="px-btn sm primary" disabled={q >= c.maxQty || frozen} onClick={() => design({ k: 'component', id: c.id, qty: q + 1 })} aria-label={`Add ${c.name}`}>+</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function OrbitTab() {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const d = room.design;
  const obj = OBJECTIVE_MAP[d.objectiveId];
  const o = ORBIT_MAP[d.orbit.id];
  const h = orbitAltitude(d);
  const geo = useMemo(() => orbitGeometry(d, GN_MAP[d.groundNetworkId]), [d]);
  const [alt, setAlt] = useState(h);
  const frozen = room.phase !== 'design';
  return (
    <>
      <OwnerNote role="director" />
      <OrbitDiagram design={d} height={200} />
      <div className="grid sm:grid-cols-2 gap-2 mt-3">
        {[...ORBITS].sort((p, q) => (obj.orbitSuitability[q.family] ?? 0) - (obj.orbitSuitability[p.family] ?? 0)).map((x) => {
          const fit = obj.orbitSuitability[x.family] ?? 0;
          return (
            <button key={x.id} disabled={frozen} onClick={() => { design({ k: 'orbit', orbit: { id: x.id, altitudeKm: x.defaultAltitudeKm, ltan: 'day' } }); setAlt(x.defaultAltitudeKm); }} title={x.description}
              className={`text-left p-2 border-2 ${x.id === d.orbit.id ? 'border-gold bg-[#2a2410]' : 'border-black bg-[#0e1530] hover:bg-[#16204a]'}`}>
              <div className="flex items-center gap-2"><span className="font-pixel text-[8px] text-cream flex-1">{x.name}</span>
                <span className="font-pixel text-[6px]" style={{ color: fit >= 0.8 ? '#4ade80' : fit > 0 ? '#fbbf24' : '#f87171' }}>{fit >= 0.8 ? 'GREAT FIT' : fit > 0 ? 'OK FIT' : 'WRONG TARGET'}</span></div>
              <div className="text-[15px] text-muted leading-tight">{x.description}</div>
              <div className="text-[14px] text-accent">{x.insertionDvMs ? `brake ${x.insertionDvMs} m/s · ` : ''}{x.cruiseYears ? `cruise ${x.cruiseYears} yr · ` : ''}{x.distanceFromSunAU} AU</div>
            </button>
          );
        })}
      </div>
      {o.altitudeRangeKm && (
        <Section title="Altitude" className="mt-3">
          <input type="range" className="px-range w-full" min={o.altitudeRangeKm[0]} max={o.altitudeRangeKm[1]} step={5} value={alt} disabled={frozen}
            onChange={(e) => setAlt(+e.target.value)} onMouseUp={() => design({ k: 'orbit', orbit: { ...d.orbit, altitudeKm: alt } })} onTouchEnd={() => design({ k: 'orbit', orbit: { ...d.orbit, altitudeKm: alt } })} onKeyUp={() => design({ k: 'orbit', orbit: { ...d.orbit, altitudeKm: alt } })} aria-label="Orbit altitude" />
          <div className="text-[17px]">{n(alt, 0)} km · one orbit {n(geo.periodMin, 0)} min · in shadow {pct(geo.eclipseFrac)}{o.family === 'SSO' ? '' : ''}</div>
          <div className="text-[15px] text-muted">Lower = sharper data, more drag/fuel. Higher = longer life, weaker signal.</div>
          {o.family === 'SSO' && <label className="flex items-center gap-2 text-[17px] mt-1"><input type="checkbox" disabled={frozen} checked={d.orbit.ltan === 'dawn-dusk'} onChange={(e) => design({ k: 'orbit', orbit: { ...d.orbit, ltan: e.target.checked ? 'dawn-dusk' : 'day' } })} /> Dawn-dusk orbit (almost never in shadow)</label>}
        </Section>
      )}
    </>
  );
}

function RocketTab() {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const res = useStore((s) => s.resources)!;
  const d = room.design;
  const o = ORBIT_MAP[d.orbit.id];
  const frozen = room.phase !== 'design';
  return (
    <>
      <OwnerNote role="ops" />
      <div className="text-[17px] mb-2">Your launch mass: <b>{n(res.mass.launchMassKg, 0)} kg</b> to {o.name}. Farther targets need more energy, so each rocket lifts less.</div>
      <div className="grid gap-2">
        {LAUNCH_VEHICLES.map((lv) => {
          const cap = lv.max_payload_kg_by_orbit[o.launchCapacityKey] ?? 0;
          const fits = cap > 0 && res.mass.launchMassKg <= cap;
          const cost = lv.costPerKg !== undefined ? Math.max(lv.minChargeKg ?? 0, res.mass.launchMassKg) * lv.costPerKg * (o.launchCapacityKey === 'TLI' ? 8 : 1) : lv.cost_millions;
          return (
            <button key={lv.id} disabled={frozen} onClick={() => design({ k: 'launch', lvId: lv.id })} title={lv.description}
              className={`text-left p-2 border-2 ${lv.id === d.launchVehicleId ? 'border-gold bg-[#2a2410]' : 'border-black bg-[#0e1530] hover:bg-[#16204a]'} ${cap > 0 ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2"><span className="font-pixel text-[8px] text-cream flex-1">{lv.name}</span>
                <span className="font-pixel text-[6px]" style={{ color: fits ? '#4ade80' : '#f87171' }}>{cap <= 0 ? "CAN'T REACH" : fits ? 'FITS' : 'TOO HEAVY'}</span></div>
              <div className="text-[15px] text-muted">{lv.description}</div>
              <div className="text-[15px] text-accent">lifts {n(cap, 0)} kg here · ≈{money(cost)} · {pct(lv.reliability, 1)} reliable</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function GroundTab() {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const res = useStore((s) => s.resources)!;
  const d = room.design;
  const [hrs, setHrs] = useState(d.contactHoursPerDay);
  const frozen = room.phase !== 'design';
  return (
    <>
      <OwnerNote role="ops" />
      <div className="grid gap-2">
        {GROUND_NETWORKS.map((g) => (
          <button key={g.id} disabled={frozen} onClick={() => design({ k: 'ground', gnId: g.id })}
            className={`text-left p-2 border-2 ${g.id === d.groundNetworkId ? 'border-gold bg-[#2a2410]' : 'border-black bg-[#0e1530] hover:bg-[#16204a]'}`}>
            <div className="font-pixel text-[8px] text-cream">{g.name}</div>
            <div className="text-[15px] text-muted">{g.description}</div>
            <div className="text-[14px] text-accent">bands {Object.keys(g.gtByBand).join(', ')} · {money(g.baseCostPerYear)}/yr + {money(g.costPerHour)}/h</div>
          </button>
        ))}
      </div>
      <Section title="Contact time per day" className="mt-3">
        <input type="range" className="px-range w-full" min={0.5} max={24} step={0.5} value={hrs} disabled={frozen} onChange={(e) => setHrs(+e.target.value)}
          onMouseUp={() => design({ k: 'contact', hours: hrs })} onTouchEnd={() => design({ k: 'contact', hours: hrs })} onKeyUp={() => design({ k: 'contact', hours: hrs })} aria-label="Contact hours per day" />
        <div className="text-[17px]">{hrs} h/day booked → {n(res.link.contactMinPerDay, 0)} min/day of real contact · {n(res.link.downlinkGbPerDay, 1)} Gb/day</div>
        <div className="text-[15px] text-muted">More hours = more data home, but ground time costs money.</div>
      </Section>
    </>
  );
}

function MissionTab() {
  const room = useStore((s) => s.room)!;
  const design = useStore((s) => s.design);
  const d = room.design;
  const diff = DIFFICULTY_MAP[d.difficulty];
  const frozen = room.phase !== 'design';
  return (
    <>
      <Section title="Spacecraft in the fleet">
        <div className="flex items-center gap-2"><button className="px-btn sm" disabled={frozen || d.fleetSize <= 1} onClick={() => design({ k: 'fleet', n: d.fleetSize - 1 })}>−</button>
          <span className="font-pixel text-[12px] w-8 text-center">{d.fleetSize}</span><button className="px-btn sm primary" disabled={frozen || d.fleetSize >= 24} onClick={() => design({ k: 'fleet', n: d.fleetSize + 1 })}>+</button>
          <span className="text-[16px] text-muted">More spacecraft = better coverage and spares, but more mass and cost.</span></div>
      </Section>
      <Section title="Mission length">
        <div className="flex items-center gap-2"><button className="px-btn sm" disabled={frozen} onClick={() => design({ k: 'years', years: d.missionYears - 0.5 })}>−</button>
          <span className="font-pixel text-[12px] w-14 text-center">{d.missionYears} yr</span><button className="px-btn sm primary" disabled={frozen} onClick={() => design({ k: 'years', years: d.missionYears + 0.5 })}>+</button>
          <span className="text-[16px] text-muted">Longer = more science, more fuel, more wear.</span></div>
      </Section>
      <Section title="Cost reserve">
        <div className="flex items-center gap-2"><button className="px-btn sm" disabled={frozen} onClick={() => design({ k: 'reserve', pct: d.reservePct - 0.05 })}>−</button>
          <span className="font-pixel text-[12px] w-14 text-center">{Math.round(d.reservePct * 100)}%</span><button className="px-btn sm primary" disabled={frozen} onClick={() => design({ k: 'reserve', pct: d.reservePct + 0.05 })}>+</button>
          <span className="text-[16px] text-muted">{diff.minReservePct ? `${diff.name} rules: at least ${Math.round(diff.minReservePct * 100)}%.` : 'Money set aside for surprises.'}</span></div>
      </Section>
      <Section title="Start over">
        <div className="flex gap-2 flex-wrap">
          <button className="px-btn sm danger" disabled={frozen} onClick={() => design({ k: 'clear' })}>CLEAR ALL PARTS</button>
          {d.difficulty === 'sandbox' && <button className="px-btn sm" disabled={frozen} onClick={() => design({ k: 'reference' })}>LOAD WORKING BASELINE</button>}
        </div>
      </Section>
    </>
  );
}

// ── Launch / flight status ──────────────────────────────────────────────────
function LaunchBox() {
  const room = useStore((s) => s.room)!;
  const res = useStore((s) => s.resources)!;
  const sim = useStore((s) => s.sim);
  const send = useStore((s) => s.send);
  const can = useStore((s) => s.can);
  const openPanel = useStore((s) => s.openPanel);
  const d = room.design;
  const complete = presetsComplete(d);
  const open = room.proposals.filter((p) => p.status === 'open').length;
  const blockers = [...(complete ? [] : ['Choose an option for every part.']), ...res.compatibility.blockers, ...(open ? [`${open} team proposal(s) waiting for a vote.`] : [])];
  const est = res.estimatedSuccess;
  const risk = est >= 0.75 ? ['LOW RISK', '#4ade80'] : est >= 0.4 ? ['MEDIUM RISK', '#fbbf24'] : ['HIGH RISK', '#f87171'];
  if (room.phase !== 'design') {
    const done = room.phase === 'done' || !!sim?.done;
    const frac = sim ? sim.day / Math.max(1, sim.totalDays) : 0;
    return (
      <div className="px-frame p-3 text-center">
        <div className="font-pixel text-[10px] text-ok">{done ? '🏁 MISSION COMPLETE' : '🚀 IN FLIGHT'}</div>
        {!done && sim && <>
          <div className="h-[12px] bg-black border-2 border-black my-2"><div className="h-full bg-ok" style={{ width: `${frac * 100}%` }} /></div>
          <div className="text-[16px] text-muted">Day {n(sim.day, 0)} of {n(sim.totalDays, 0)}</div>
        </>}
        <button className="px-btn primary w-full mt-2 py-3" onClick={() => openPanel('mcc', done ? 'results' : 'live')}>{done ? 'SEE RESULTS ▶' : 'WATCH LIVE ▶'}</button>
        {done && <button className="px-btn w-full mt-2" disabled={!can('director')} onClick={() => send({ t: 'resetSim' })}>🔧 TWEAK & FLY AGAIN</button>}
      </div>
    );
  }
  return (
    <div className="px-frame p-3">
      <div className="flex items-center justify-between">
        <span className="font-pixel text-[8px] text-muted">SUCCESS CHANCE</span>
        <span className="font-pixel text-[8px]" style={{ color: risk[1] }}>{risk[0]}</span>
      </div>
      <div className="h-[12px] bg-black border-2 border-black my-1"><div className="h-full" style={{ width: `${Math.max(2, est * 100)}%`, background: risk[1] }} /></div>
      <div className="text-[16px] text-muted">≈{pct(est)} · {money(res.cost.total)} · science {n(res.science.total, 0)}/{n(res.science.baseline, 0)}</div>
      {blockers.length > 0 && (
        <div className="mt-2 text-[16px] leading-tight">
          {blockers.slice(0, 3).map((b, i) => <div key={i} className="text-crit">✗ {b.split(/(?<=\.)\s/)[0]}</div>)}
          {blockers.length > 3 && <div className="text-muted">+{blockers.length - 3} more</div>}
        </div>
      )}
      <button className="px-btn primary w-full mt-3 py-4 text-[12px]" disabled={blockers.length > 0 || !can('director')} onClick={() => send({ t: 'signoff' })}
        title={!can('director') ? 'Only the Flight Director can launch' : blockers.length ? 'Fix the red items first' : 'Launch the mission'}>🚀 LAUNCH MISSION</button>
      {!can('director') && <div className="text-[15px] text-muted mt-1 text-center">Only the Flight Director can launch.</div>}
    </div>
  );
}
