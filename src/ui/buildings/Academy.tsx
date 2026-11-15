// ACADEMY — bite-sized visual cards on how space works, plus real NASA missions.
import { useEffect, useState, type ReactNode } from 'react';
import { FLEET_MISSIONS, NASA_LINKS, type FleetOrbit } from '../../../shared/data/nasaMissions';
import { PanelFrame, n, pct } from '../widgets/common';

export function AcademyPanel({ tab }: { tab?: string }) {
  const [t, setT] = useState(tab === 'missions' ? 'missions' : 'basics');
  useEffect(() => { if (tab) setT(tab === 'missions' ? 'missions' : 'basics'); }, [tab]);
  return (
    <PanelFrame wide title="NASA ACADEMY" icon="📚" subtitle="Short visual lessons and real missions."
      tabs={[{ id: 'basics', label: '🧪 HOW SPACE WORKS' }, { id: 'missions', label: '🛰 REAL NASA MISSIONS' }]} tab={t} onTab={setT}>
      {t === 'basics' ? <Basics /> : <Missions />}
    </PanelFrame>
  );
}

function Card({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="px-inset p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2"><span className="text-[34px] leading-none">{icon}</span><span className="font-pixel text-[10px] text-gold">{title}</span></div>
      <p className="text-[19px] leading-snug">{text}</p>
      {children}
    </div>
  );
}

function Slide({ label, value, min, max, step = 1, onChange, show }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show: string }) {
  return (
    <label className="block">
      <div className="flex justify-between text-[16px]"><span className="text-muted">{label}</span><span className="text-accent">{show}</span></div>
      <input type="range" className="px-range w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function Bar({ frac, color, label }: { frac: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[16px]">
      <span className="w-[132px] truncate">{label}</span>
      <div className="flex-1 h-[12px] bg-black border-2 border-black"><div className="h-full" style={{ width: `${Math.max(1, Math.min(100, frac * 100))}%`, background: color }} /></div>
    </div>
  );
}

function Basics() {
  const [dv, setDv] = useState(3);
  const [isp, setIsp] = useState(320);
  const [alt, setAlt] = useState(400);
  const [au, setAu] = useState(1.5);
  const [dist, setDist] = useState(1);
  const [copies, setCopies] = useState(1);
  const fuelFrac = 1 - 1 / Math.exp((dv * 1000) / (isp * 9.80665));
  const period = 2 * Math.PI * Math.sqrt(Math.pow(6378 + alt, 3) / 398600) / 60;
  const speed = Math.sqrt(398600 / (6378 + alt));
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      <Card icon="🚀" title="ROCKETS" text="A rocket throws gas backward to go forward. Most of a rocket is fuel.">
        <Slide label="Speed change (Δv)" value={dv} min={0.5} max={10} step={0.5} onChange={setDv} show={`${dv} km/s`} />
        <Slide label="Engine efficiency (Isp)" value={isp} min={200} max={3100} step={10} onChange={setIsp} show={`${isp} s`} />
        <Bar frac={fuelFrac} color="#f87171" label={`Fuel ${pct(fuelFrac)}`} />
        <div className="text-[15px] text-muted">Electric engines (Isp 1,600–3,100 s) need far less fuel — but push very gently.</div>
      </Card>
      <Card icon="🪐" title="ORBITS" text="An orbit is falling around a planet so fast that you keep missing it.">
        <Slide label="Altitude" value={alt} min={200} max={36000} step={100} onChange={setAlt} show={`${n(alt, 0)} km`} />
        <div className="grid grid-cols-2 gap-2 text-[18px]"><div className="px-frame p-2">⏱ {n(period, 0)} min / lap</div><div className="px-frame p-2">💨 {n(speed, 1)} km/s</div></div>
        <div className="text-[15px] text-muted">At 35,786 km one lap takes a day — the satellite hovers over one spot.</div>
      </Card>
      <Card icon="⛽" title="Δv BUDGET" text="Δv is your speed-change budget. Farther targets cost more — and you must brake to stop there.">
        {([['Moon', 0.85], ['Mars', 1.0], ['Jupiter', 1.1], ['Vesta', 5.2]] as [string, number][]).map(([l, v]) => <Bar key={l} label={`${l} ${v} km/s`} frac={v / 5.5} color="#58b8f8" />)}
        <div className="text-[15px] text-muted">km/s your spacecraft must provide after the rocket lets go.</div>
      </Card>
      <Card icon="☀️" title="SOLAR POWER" text="Sunlight weakens with distance squared: twice as far = one quarter the power.">
        <Slide label="Distance from the Sun" value={au} min={0.4} max={9.5} step={0.1} onChange={setAu} show={`${au} AU`} />
        <Bar frac={Math.min(1, 1 / (au * au))} color="#fbbf24" label={pct(1 / (au * au))} />
        <div className="text-[15px] text-muted">Earth = 1 AU · Mars 1.5 · Vesta 2.4 · Jupiter 5.2. Past Jupiter, missions use nuclear RTGs.</div>
      </Card>
      <Card icon="📡" title="RADIO LINKS" text="Double the distance and the signal is 4× weaker. Bigger dishes catch more of it.">
        <Slide label="Distance (× Moon)" value={dist} min={1} max={2000} step={1} onChange={setDist} show={`${n(dist * 384400, 0)} km`} />
        <Bar frac={1 - Math.log10(dist * dist) / Math.log10(2000 * 2000) * 0.97} color="#c878f8" label={dist === 1 ? 'full signal' : `1/${n(dist * dist, 0)}`} />
        <div className="text-[15px] text-muted">That's why deep-space missions use 3 m dishes and NASA's 34–70 m antennas.</div>
      </Card>
      <Card icon="☢️" title="RADIATION" text="Space radiation slowly damages chips. Shielding and tough rad-hard parts buy you years.">
        {([['Low orbit', 1], ['Moon', 2], ['Mars', 3], ['Jupiter', 900]] as [string, number][]).map(([l, v]) => <Bar key={l} label={`${l} ${v} krad`} frac={Math.log10(v + 1) / 3} color={v > 100 ? '#f87171' : '#4ade80'} />)}
        <div className="text-[15px] text-muted">Dose per year (log scale). Jupiter is ~300× worse than Mars!</div>
      </Card>
      <Card icon="🌡️" title="HEAT" text="There's no air in space: heat can only leave by glowing away from radiators.">
        <div className="text-[17px]">🔥 Every watt you use becomes heat. ❄️ Blankets (MLI) keep the cold out. 📐 Radiators dump extra heat.</div>
      </Card>
      <Card icon="🎲" title="RELIABILITY" text="Parts fail. A spare copy keeps the mission alive.">
        <Slide label="Copies of a 90%-reliable part" value={copies} min={1} max={4} onChange={setCopies} show={`${copies}`} />
        <Bar frac={1 - Math.pow(0.1, copies)} color="#4ade80" label={pct(1 - Math.pow(0.1, copies), 2)} />
      </Card>
      <Card icon="💰" title="COST & TIME" text="Bigger and more custom = more expensive and slower to build. Late launches cost extra money every month.">
        <div className="text-[17px]">🛰 CubeSat ~$1M · 🛰 Small sat ~$100M · 🛰 Flagship $1–5B</div>
      </Card>
    </div>
  );
}

const GROUPS: [string, FleetOrbit[]][] = [['🌍 Earth', ['LEO', 'SSO', 'GEO']], ['🌕 Moon', ['LUNAR']], ['🔴 Mars', ['MARS']], ['☄️ Asteroids', ['ASTEROID']], ['🪐 Jupiter', ['JUPITER']], ['✨ Deep space', ['L1', 'L2', 'HELIO']]];

function Missions() {
  const [g, setG] = useState(0);
  const list = FLEET_MISSIONS.filter((m) => GROUPS[g][1].includes(m.orbit));
  return (
    <>
      <div className="flex flex-wrap gap-1 mb-3">{GROUPS.map(([l], i) => <button key={l} className={`px-btn sm ${g === i ? 'gold' : 'ghost'}`} onClick={() => setG(i)}>{l}</button>)}</div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((m) => (
          <div key={m.id} className="px-inset p-3">
            <div className="flex items-center gap-2"><span className="text-[32px]">{m.icon}</span>
              <div className="min-w-0"><div className="font-pixel text-[9px] text-gold">{m.name}</div><div className="text-[15px] text-muted">{m.year} · {m.status === 'operating' ? '🟢 still working' : m.status === 'flown' ? '⚪ completed' : '🟡 in development'}</div></div>
            </div>
            <p className="text-[18px] leading-snug mt-2">{m.fact}</p>
            <div className="text-[14px] text-muted mt-1">{m.propulsion === 'electric' ? '⚡ electric engines · ' : ''}{m.power === 'rtg' ? '☢️ nuclear power · ' : '☀️ solar · '}{m.massClass} size</div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-[16px] text-muted">Real NASA tools behind this game: {NASA_LINKS.map((l, i) => <span key={l.id}>{i ? ' · ' : ''}<a className="text-accent underline" href={l.url} target="_blank" rel="noreferrer">{l.title}</a></span>)}</div>
    </>
  );
}
