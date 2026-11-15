// Interactive Spacecraft Visualizer: the spacecraft is composed from the actual
// selected components as crisp pixel-art SVG, updating live as parts are added.
import { useState, type ReactElement } from 'react';
import { COMPONENT_MAP } from '../../../shared/data/components';
import type { MissionDesign, SpacecraftComponent } from '../../../shared/types';

const KIND_COLOR: Record<string, string> = {
  optical_ms: '#58b8f8', thermal_ir: '#f86848', hyperspectral: '#c878f8', sar: '#e8e8f0', lidar: '#48f878', neutron: '#f8d848', ir_spec: '#f8a848',
  magnetometer: '#a8a8b8', plasma: '#48d8d8', particles: '#d84888', coronagraph: '#f8f8a8', euv: '#a848f8', ice_radar: '#88a8f8', mass_spec: '#88f8a8', nac: '#5888f8', fire_ir: '#f84828',
};

interface Part { id: string; comp: SpacecraftComponent; el: ReactElement }

export function SpacecraftVisualizer({ design, cutaway: cut0 = false, height = 320, onPick }: { design: MissionDesign; cutaway?: boolean; height?: number; onPick?: (id: string) => void }) {
  const [cutaway, setCutaway] = useState(cut0);
  const [hover, setHover] = useState<string | null>(null);
  const bus = COMPONENT_MAP[design.busId];
  const cls = bus?.specs.busClass ?? 'small';
  const items = design.components.map((s) => ({ comp: COMPONENT_MAP[s.id], qty: s.qty })).filter((x) => x.comp);
  const W = 240, H = 180, cx = 120, cy = 86;
  const dims = { cube: design.busId === 'bus_cube6' ? [14, 24] : [20, 24], small: [32, 30], mid: [44, 38], large: [60, 50] }[cls] as [number, number];
  const [bw, bh] = dims;
  const bx = cx - bw / 2, by = cy - bh / 2;
  const mli = items.some((i) => i.comp.id === 'th_mli');
  const parts: Part[] = [];
  const add = (comp: SpacecraftComponent, el: ReactElement, key?: string) => parts.push({ id: key ?? comp.id, comp, el });

  // Solar generation
  let wingSlot = 0;
  for (const { comp, qty } of items.filter((i) => i.comp.category === 'power')) {
    for (let q = 0; q < qty; q++) {
      if (comp.specs.source === 'rtg') {
        const ox = bx - 14 - q * 10, oy = by + bh + 2;
        add(comp, <g key={`${comp.id}${q}`}><rect x={ox + 6} y={oy - 4} width={bx - ox - 6} height={2} fill="#8a8a92" /><rect x={ox} y={oy - 8} width={8} height={14} fill="#5a5a62" stroke="#1e2430" />
          {[0, 1, 2, 3].map((f) => <rect key={f} x={ox - 2} y={oy - 6 + f * 3} width={12} height={1} fill="#3a3a42" />)}<rect x={ox + 2} y={oy - 10} width={4} height={2} fill="#f86838" /></g>, `${comp.id}${q}`);
        continue;
      }
      if (comp.id === 'pwr_body') {
        add(comp, <g key="body"><rect x={bx + 2} y={by + 2} width={bw - 4} height={bh - 4} fill="#1f3a8a" />{Array.from({ length: Math.floor((bw - 4) / 4) }).map((_, i) => <rect key={i} x={bx + 3 + i * 4} y={by + 2} width={1} height={bh - 4} fill="#3a5ad0" />)}</g>);
        continue;
      }
      // Paired wings (CubeSat deployables, deep-space wing pair) draw on both sides at once
      const sides = comp.id === 'pwr_cubewing' || comp.id === 'pwr_deepwing' ? [-1, 1] : [wingSlot % 2 === 0 ? -1 : 1];
      const tier = Math.floor(wingSlot / 2);
      wingSlot += sides.length;
      const span = Math.min(92, (comp.id === 'pwr_cubewing' ? 10 : 14) + Math.sqrt((comp.specs.generationW ?? 100) / sides.length) * 0.62);
      const hgt = comp.id === 'pwr_cubewing' ? 12 : comp.id === 'pwr_deepwing' ? 30 : comp.id === 'pwr_rosa' ? 16 : Math.min(26, 10 + Math.sqrt(comp.specs.generationW ?? 100) * 0.25);
      const yoff = cy - hgt / 2 + (tier ? (tier % 2 ? -hgt - 3 : hgt + 3) : 0);
      const cells = Math.max(2, Math.floor(span / 7));
      add(comp, <g key={`w${wingSlot}`}>{sides.map((side) => {
        const x0 = side < 0 ? bx - 4 - span : bx + bw + 4;
        return <g key={side}>
          <rect x={side < 0 ? x0 + span : bx + bw} y={cy - 1} width={4} height={2} fill="#9a9aa2" />
          <rect x={x0} y={yoff} width={span} height={hgt} fill={comp.id === 'pwr_rosa' ? '#2a3a7a' : '#1f3a8a'} stroke="#0b1020" />
          {Array.from({ length: cells }).map((_, i) => <rect key={i} x={x0 + 1 + (i * (span - 2)) / cells} y={yoff + 1} width={1} height={hgt - 2} fill="#4a6ad8" />)}
          <rect x={x0} y={yoff + hgt / 2} width={span} height={1} fill="#4a6ad8" />
        </g>;
      })}</g>, `${comp.id}-${wingSlot}`);
    }
  }
  // Bus body
  const body = (
    <g key="bus">
      <rect x={bx} y={by} width={bw} height={bh} fill={mli ? '#d8a830' : '#a8acb8'} stroke="#0b1020" strokeWidth="1.5" />
      {mli && Array.from({ length: Math.floor(bh / 5) }).map((_, i) => <rect key={i} x={bx + 1} y={by + 2 + i * 5} width={bw - 2} height={1} fill="#b88a20" />)}
      {!mli && <rect x={bx + 1} y={by + 1} width={bw - 2} height={2} fill="#c8ccd8" />}
      {cls === 'large' && <rect x={bx + bw * 0.3} y={by + bh * 0.3} width={bw * 0.4} height={bh * 0.4} fill="#6a6e7a" stroke="#0b1020" />}
    </g>
  );
  // Cutaway internals
  const internals: ReactElement[] = [];
  if (cutaway) {
    let ix = bx + 3, iy = by + 3;
    const slot = (w: number, h: number) => { if (ix + w > bx + bw - 2) { ix = bx + 3; iy += h + 2; } const p = [ix, iy] as const; ix += w + 2; return p; };
    for (const { comp, qty } of items) {
      for (let q = 0; q < qty; q++) {
        if (comp.specs.adcsType === 'wheel') { const [x, y] = slot(5, 5); internals.push(<g key={`rw${q}${comp.id}`}><circle cx={x + 2.5} cy={y + 2.5} r={2.5} fill="#5a5e6a" stroke="#0b1020" strokeWidth=".5" /><title>{comp.name}</title></g>); }
        else if (comp.category === 'battery') { const [x, y] = slot(6, 4); internals.push(<g key={`b${q}${comp.id}`}><rect x={x} y={y} width={6} height={4} fill="#3a9a4a" stroke="#0b1020" strokeWidth=".5" /><title>{comp.name}</title></g>); }
        else if (comp.category === 'computer') { const [x, y] = slot(6, 4); internals.push(<g key={`c${q}${comp.id}`}><rect x={x} y={y} width={6} height={4} fill="#2a3a6a" stroke="#0b1020" strokeWidth=".5" /><rect x={x + 1} y={y + 1} width={1} height={1} fill="#48f878" /><title>{comp.name}</title></g>); }
        else if (comp.category === 'propulsion') { const [x, y] = slot(7, 7); internals.push(<g key={`t${q}${comp.id}`}><circle cx={x + 3.5} cy={y + 3.5} r={3.5} fill={comp.specs.chemical ? '#c8c8d0' : '#88a8f8'} stroke="#0b1020" strokeWidth=".5" /><title>{comp.name} tank</title></g>); }
      }
    }
  }
  // Comms
  let topX = cx - bw / 2 + 3;
  for (const { comp, qty } of items.filter((i) => i.comp.category === 'comms')) {
    for (let q = 0; q < qty; q++) {
      const s = comp.specs;
      if (s.dishDiameterM) {
        const r = Math.min(30, 6 + s.dishDiameterM * 8);
        add(comp, <g key={`d${comp.id}${q}`}><rect x={cx - 1} y={by - 8} width={2} height={8} fill="#8a8a92" /><ellipse cx={cx} cy={by - 8 - r * 0.35} rx={r} ry={r * 0.35} fill="#e8e8f0" stroke="#0b1020" /><ellipse cx={cx} cy={by - 8 - r * 0.38} rx={r * 0.85} ry={r * 0.22} fill="#c8c8d0" /><rect x={cx - 1} y={by - 8 - r * 0.9} width={2} height={r * 0.55} fill="#8a8a92" /></g>, `${comp.id}${q}`);
      } else if (s.band === 'optical') {
        add(comp, <g key={`o${comp.id}${q}`}><rect x={bx + bw - 10} y={by - 10} width={8} height={10} fill="#3a3e4a" stroke="#0b1020" /><circle cx={bx + bw - 6} cy={by - 10} r={3} fill="#48d8f8" /></g>, `${comp.id}${q}`);
      } else if (s.band === 'UHF') {
        add(comp, <g key={`u${q}`}><line x1={bx + 2} y1={by} x2={bx - 10} y2={by - 14} stroke="#e8e8f0" /><line x1={bx + bw - 2} y1={by} x2={bx + bw + 10} y2={by - 14} stroke="#e8e8f0" /></g>, `${comp.id}${q}`);
      } else if (comp.id === 'com_iris') {
        add(comp, <g key={`ir${q}`}><rect x={bx - 22} y={by - 22} width={20} height={14} fill="#c8a848" stroke="#0b1020" />{[0, 1, 2].map((i) => <rect key={i} x={bx - 20 + i * 6} y={by - 20} width={4} height={10} fill="#a8882a" />)}<line x1={bx - 2} y1={by - 8} x2={bx} y2={by} stroke="#8a8a92" /></g>, `${comp.id}${q}`);
      } else {
        const x = topX; topX += 7;
        add(comp, <g key={`p${comp.id}${q}`}><rect x={x} y={by - 3} width={5} height={3} fill={s.band === 'Ka' ? '#f8a848' : s.band === 'X' ? '#e8e8f0' : '#c8c8d0'} stroke="#0b1020" strokeWidth=".5" />{s.band === 'Ka' && <polygon points={`${x},${by - 3} ${x + 5},${by - 3} ${x + 6},${by - 8} ${x - 1},${by - 8}`} fill="#d8d8e0" stroke="#0b1020" strokeWidth=".5" />}</g>, `${comp.id}${q}`);
      }
    }
  }
  // ADCS externals
  let stY = by + 4;
  for (const { comp, qty } of items.filter((i) => i.comp.specs.adcsType === 'startracker')) {
    for (let q = 0; q < qty; q++) { add(comp, <g key={`st${comp.id}${q}`}><rect x={bx + bw} y={stY} width={6} height={4} fill="#3a3e4a" stroke="#0b1020" strokeWidth=".5" /><rect x={bx + bw + 5} y={stY + 1} width={2} height={2} fill="#1a1a1a" /></g>, `${comp.id}${q}`); stY += 6; }
  }
  if (items.some((i) => i.comp.specs.adcsType === 'integrated')) add(COMPONENT_MAP.adcs_cube, <rect key="adcs" x={bx + 2} y={by + bh - 7} width={bw - 4} height={4} fill="#5a5e6a" />);
  // Propulsion nozzles
  for (const { comp } of items.filter((i) => i.comp.category === 'propulsion' && !i.comp.specs.tankOnly)) {
    const big = comp.id === 'prop_biprop';
    const ep = comp.specs.chemical === false;
    add(comp, <g key={`n${comp.id}`}><polygon points={`${cx - (big ? 4 : 2)},${by + bh} ${cx + (big ? 4 : 2)},${by + bh} ${cx + (big ? 7 : 4)},${by + bh + (big ? 9 : 5)} ${cx - (big ? 7 : 4)},${by + bh + (big ? 9 : 5)}`} fill={ep ? '#5a6a9a' : '#6a6a72'} stroke="#0b1020" strokeWidth=".5" />
      {ep && <rect x={cx - 3} y={by + bh + 6} width={6} height={3} fill="#88a8f8" opacity="0.8" />}
      {[-1, 1].map((sgn) => <rect key={sgn} x={sgn < 0 ? bx - 2 : bx + bw} y={by + bh - 4} width={2} height={3} fill="#6a6a72" />)}</g>);
  }
  // Instruments on nadir face & booms
  let nx = bx + 2;
  for (const { comp, qty } of items.filter((i) => i.comp.category === 'instrument')) {
    for (let q = 0; q < qty; q++) {
      const kind = comp.specs.kind!;
      const col = KIND_COLOR[kind] ?? '#c8c8d0';
      if (kind === 'magnetometer') { add(comp, <g key={`m${comp.id}${q}`}><line x1={bx + bw} y1={by + bh - 4} x2={bx + bw + 40} y2={by + bh + 18} stroke="#a8a8b8" /><rect x={bx + bw + 38} y={by + bh + 16} width={5} height={5} fill={col} stroke="#0b1020" /></g>, `${comp.id}${q}`); continue; }
      if (kind === 'ice_radar') { add(comp, <g key={`r${q}`}><line x1={bx - 30} y1={by + bh + 4} x2={bx + bw + 30} y2={by + bh + 4} stroke={col} strokeWidth="1.5" /><rect x={cx - 3} y={by + bh} width={6} height={5} fill={col} /></g>, `${comp.id}${q}`); continue; }
      if (comp.id === 'ins_sarl') { add(comp, <g key="sarl"><line x1={bx} y1={by + bh} x2={bx - 18} y2={by + bh + 22} stroke="#a8a8b8" /><ellipse cx={bx - 26} cy={by + bh + 30} rx={26} ry={8} fill="#e8e8f0" stroke="#0b1020" /><ellipse cx={bx - 26} cy={by + bh + 30} rx={22} ry={5} fill="#d0d0d8" /></g>, `${comp.id}${q}`); continue; }
      if (comp.id === 'ins_sarx') { add(comp, <g key="sarx"><rect x={bx - 6} y={by + bh + 1} width={bw + 12} height={5} fill="#e8e8f0" stroke="#0b1020" />{Array.from({ length: 6 }).map((_, i) => <rect key={i} x={bx - 4 + i * ((bw + 8) / 6)} y={by + bh + 2} width={2} height={3} fill="#b8b8c8" />)}</g>, `${comp.id}${q}`); continue; }
      const w = Math.max(4, Math.min(12, 3 + Math.sqrt(comp.mass_kg) * 1.2));
      const x = nx; nx += w + 2;
      if (nx > bx + bw + 6) nx = bx + 2;
      add(comp, <g key={`i${comp.id}${q}`}><rect x={x} y={by + bh} width={w} height={w * 0.8} fill={col} stroke="#0b1020" strokeWidth=".7" /><rect x={x + w / 2 - 1} y={by + bh + w * 0.8} width={2} height={2} fill="#1a1a1a" /></g>, `${comp.id}${q}`);
    }
  }
  const radiators = items.filter((i) => i.comp.id === 'th_rad' || i.comp.id === 'th_lhp');
  radiators.forEach(({ comp, qty }) => { for (let q = 0; q < qty; q++) add(comp, <rect key={`rad${comp.id}${q}`} x={bx + 2 + q * 5} y={by - 2} width={4} height={2} fill="#f8f8f8" stroke="#0b1020" strokeWidth=".5" />, `${comp.id}${q}`); });

  const hovered = hover ? parts.find((p) => p.id === hover)?.comp : null;
  // Zoom the camera to the spacecraft's extent so small buses fill the view
  const spans = items.filter((i) => i.comp.category === 'power' && i.comp.specs.source === 'solar' && i.comp.id !== 'pwr_body').map((i) => { const two = i.comp.id === 'pwr_cubewing' || i.comp.id === 'pwr_deepwing'; return Math.min(92, (i.comp.id === 'pwr_cubewing' ? 10 : 14) + Math.sqrt((i.comp.specs.generationW ?? 100) / (two ? 2 : 1)) * 0.62); });
  const hasBig = items.some((i) => ['ins_sarl', 'ins_icerad'].includes(i.comp.id) || (i.comp.specs.dishDiameterM ?? 0) > 2);
  const ext = Math.max(bw / 2 + 4 + (spans.length ? Math.max(...spans) : 0), bh / 2 + 34, hasBig ? 70 : 0) + 12;
  const vbW = Math.max(110, Math.min(W, ext * 2));
  const vbH = vbW * 0.62;
  const vb = `${cx - vbW / 2} ${cy - vbH / 2 - 4} ${vbW} ${vbH}`;
  return (
    <div className="relative">
      <svg viewBox={vb} className="w-full pixel" style={{ height, background: 'radial-gradient(#101a3a, #050814)' }}>
        {Array.from({ length: 40 }).map((_, i) => <rect key={i} x={(i * 53) % W} y={(i * 97) % H} width={1} height={1} fill="#8a9ad8" opacity={0.5} />)}
        {design.fleetSize > 1 && [1, 2].slice(0, Math.min(2, design.fleetSize - 1)).map((k) => <rect key={k} x={bx + k * 10} y={by - k * 8} width={bw} height={bh} fill="none" stroke="#4a5a9a" strokeDasharray="2 2" />)}
        {parts.filter((p) => p.comp.category === 'power' && p.comp.specs.source !== 'rtg' && p.comp.id !== 'pwr_body').map((p) => <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p.comp.id)} style={{ cursor: 'pointer' }} opacity={hover && hover !== p.id ? 0.55 : 1}>{p.el}</g>)}
        <g onMouseEnter={() => setHover('bus')} onMouseLeave={() => setHover(null)}>{body}</g>
        {parts.filter((p) => !(p.comp.category === 'power' && p.comp.specs.source !== 'rtg' && p.comp.id !== 'pwr_body')).map((p) => <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(p.comp.id)} style={{ cursor: 'pointer' }} opacity={hover && hover !== p.id ? 0.55 : 1}>{p.el}</g>)}
        {internals}
        {design.fleetSize > 1 && <text x={cx + vbW / 2 - 4} y={cy - vbH / 2 + 6} textAnchor="end" fontFamily="'Press Start 2P'" fontSize={vbW / 40} fill="#f2c14e">× {design.fleetSize} SPACECRAFT</text>}
      </svg>
      <div className="flex items-center justify-between mt-1 text-[16px]">
        <span className="text-muted min-h-[1.2em]">{hovered ? <><b className="text-cream">{hovered.name}</b> · {hovered.mass_kg} kg · {hovered.power_watts} W · ${hovered.cost_millions}M</> : hover === 'bus' ? <b className="text-cream">{bus?.name}</b> : 'Hover a part to identify it.'}</span>
        <button className="px-btn sm ghost" onClick={() => setCutaway(!cutaway)}>{cutaway ? 'HIDE' : 'SHOW'} INTERNALS</button>
      </div>
    </div>
  );
}
