// Small animated 2D orbit sketch for the current design.
import { useEffect, useState, type ReactNode } from 'react';
import { GN_MAP, ORBIT_MAP } from '../../../shared/data/mission';
import { orbitAltitude, orbitGeometry } from '../../../shared/engine/physics';
import type { MissionDesign } from '../../../shared/types';
import { n, pct } from './common';

export function OrbitDiagram({ design, height = 230 }: { design: MissionDesign; height?: number }) {
  const o = ORBIT_MAP[design.orbit.id];
  const h = orbitAltitude(design);
  const geo = orbitGeometry(design, GN_MAP[design.groundNetworkId]);
  const [t, setT] = useState(0);
  useEffect(() => { let raf = 0; const loop = (x: number) => { setT(x / 1000); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, []);
  const W = 360, H = 220, cx = 180, cy = 110;
  const sun = <g><circle cx={20} cy={cy} r={12} fill="#f8d048" /><text x={20} y={cy + 26} textAnchor="middle" fontSize="11" fill="#f8d048" fontFamily="VT323">SUN →</text></g>;
  let body: ReactNode;
  if (o.family === 'LEO' || o.family === 'SSO' || o.family === 'GEO' || o.family === 'GTO') {
    const R = 40;
    const r = o.family === 'GTO' ? 0 : R + Math.sqrt(h) * (o.family === 'GEO' ? 0.55 : 1.0) * 0.9;
    const ang = t * (o.family === 'GEO' ? 0.25 : 0.9);
    const shadowHalf = Math.asin(Math.min(1, R / Math.max(r, R + 1)));
    let sat: [number, number];
    let path: ReactNode;
    if (o.family === 'GTO') {
      const a = (R + 8 + R + 92) / 2, e = (92 - 8) / (92 + 8 + 2 * R) * 1.6, b = a * Math.sqrt(1 - Math.min(0.9, e) ** 2);
      const ocx = cx + (a - R - 8);
      path = <ellipse cx={ocx} cy={cy} rx={a} ry={b} fill="none" stroke="#58b8f8" strokeDasharray="4 3" />;
      sat = [ocx + a * Math.cos(ang), cy + b * Math.sin(ang)];
      body = <>{[1.6, 2.2].map((k) => <circle key={k} cx={cx} cy={cy} r={R * k} fill="none" stroke="#f86848" strokeOpacity="0.25" strokeWidth="10" />)}</>;
    } else {
      path = <circle cx={cx} cy={cy} r={r} fill="none" stroke="#58b8f8" strokeDasharray="4 3" />;
      sat = [cx + r * Math.cos(ang), cy + r * Math.sin(ang) * (o.family === 'SSO' ? 0.35 : o.family === 'GEO' ? 1 : 0.55)];
    }
    body = <g>
      {sun}
      {o.family !== 'GTO' && geo.eclipseFrac > 0 && <polygon points={`${cx},${cy - R} ${cx + 175},${cy - R * (1 - shadowHalf * 0.2)} ${cx + 175},${cy + R * (1 - shadowHalf * 0.2)} ${cx},${cy + R}`} fill="#000" opacity="0.45" />}
      {body}
      <circle cx={cx} cy={cy} r={R} fill="#2a6ad0" /><path d={`M${cx - 20},${cy - 18} q10,-8 22,2 q8,10 -4,16 q-14,4 -18,-18`} fill="#3aa860" /><path d={`M${cx + 6},${cy + 8} q14,-2 16,10 q-6,10 -16,4z`} fill="#3aa860" />
      <path d={`M${cx},${cy - R} a${R},${R} 0 0 1 0,${2 * R}`} fill="#000" opacity="0.35" />
      {path}
      <rect x={sat[0] - 3} y={sat[1] - 3} width={6} height={6} fill="#f2c14e" stroke="#000" />
      <text x={W - 6} y={16} textAnchor="end" fontSize="13" fill="#e8ecff" fontFamily="VT323">{o.family} · {n(h, 0)} km · T={n(geo.periodMin, 0)} min</text>
      {geo.eclipseFrac > 0 && <text x={W - 6} y={H - 8} textAnchor="end" fontSize="12" fill="#9aa6d0" fontFamily="VT323">in shadow {pct(geo.eclipseFrac)} of each orbit</text>}
    </g>;
  } else if (o.family === 'LUNAR') {
    const R = 46, r = R + 4 + Math.sqrt(h) * 1.6, ang = t * 1.2;
    body = <g>{sun}<circle cx={W - 30} cy={30} r={10} fill="#2a6ad0" /><text x={W - 30} y={52} textAnchor="middle" fontSize="11" fill="#9aa6d0" fontFamily="VT323">Earth 384,400 km</text>
      <line x1={cx} y1={cy} x2={W - 30} y2={30} stroke="#58b8f8" strokeDasharray="2 4" opacity="0.5" />
      <circle cx={cx} cy={cy} r={R} fill="#a8a8b0" /><circle cx={cx - 14} cy={cy - 10} r={7} fill="#8a8a92" /><circle cx={cx + 12} cy={cy + 14} r={9} fill="#8a8a92" /><circle cx={cx} cy={cy + R - 6} r={6} fill="#5a5a62" />
      <path d={`M${cx},${cy - R} a${R},${R} 0 0 1 0,${2 * R}`} fill="#000" opacity="0.35" />
      <ellipse cx={cx} cy={cy} rx={r * 0.35} ry={r} fill="none" stroke="#58b8f8" strokeDasharray="4 3" />
      <rect x={cx + r * 0.35 * Math.cos(ang) - 3} y={cy + r * Math.sin(ang) - 3} width={6} height={6} fill="#f2c14e" stroke="#000" />
      <text x={cx} y={cy + R + 22} textAnchor="middle" fontSize="12" fill="#e8ecff" fontFamily="VT323">polar orbit {n(h, 0)} km above the Moon</text></g>;
  } else if (o.family === 'L1' || o.family === 'L2') {
    const L2 = o.family === 'L2';
    const ex = L2 ? 260 : 300, lx = L2 ? 340 : 230, ang = t * 0.8;
    body = <g>{sun}<line x1={30} y1={cy} x2={ex} y2={cy} stroke="#3a4a7a" strokeDasharray="3 4" />
      <circle cx={ex} cy={cy} r={12} fill="#2a6ad0" /><text x={ex} y={cy + 28} textAnchor="middle" fontSize="12" fill="#9aa6d0" fontFamily="VT323">Earth</text>
      <ellipse cx={lx} cy={cy} rx={10} ry={26} fill="none" stroke="#58b8f8" strokeDasharray="3 3" />
      <rect x={lx + 10 * Math.cos(ang) - 3} y={cy + 26 * Math.sin(ang) - 3} width={6} height={6} fill="#f2c14e" stroke="#000" />
      <text x={lx} y={cy - 34} textAnchor="middle" fontSize="12" fill="#e8ecff" fontFamily="VT323">{o.family} · 1.5 million km</text>
      {!L2 && [0, 1, 2, 3].map((i) => <path key={i} d={`M${40 + ((t * 40 + i * 50) % 180)},${cy - 30 + i * 18} q10,-4 20,0`} stroke="#f8a848" fill="none" opacity="0.6" />)}
      <text x={L2 ? 220 : 110} y={H - 10} textAnchor="middle" fontSize="12" fill="#f8a848" fontFamily="VT323">{L2 ? 'one sunshield blocks Sun, Earth & Moon' : 'solar wind → ~1 h warning'}</text></g>;
  } else {
    const ang = t * 0.15;
    const AU = o.distanceFromSunAU;
    const rT = 30 * Math.pow(AU, 0.68);
    const col = o.family === 'MARS' ? '#d8603a' : o.family === 'ASTEROID' ? '#b0946e' : '#d8a878';
    body = <g><circle cx={cx} cy={cy} r={8} fill="#f8d048" /><circle cx={cx} cy={cy} r={30} fill="none" stroke="#2a3a6a" /><circle cx={cx} cy={cy} r={rT} fill="none" stroke="#2a3a6a" />
      <circle cx={cx + 30 * Math.cos(ang * 4)} cy={cy + 30 * Math.sin(ang * 4)} r={4} fill="#2a6ad0" />
      <circle cx={cx + rT * Math.cos(ang)} cy={cy + rT * Math.sin(ang)} r={o.family === 'JUPITER' ? 9 : o.family === 'MARS' ? 6 : 4} fill={col} />
      <path d={`M${cx + 30},${cy} C${cx + 40},${cy - rT * 0.85} ${cx - rT * 0.6},${cy - rT * 0.95} ${cx + rT * Math.cos(ang)},${cy + rT * Math.sin(ang)}`} stroke="#58b8f8" strokeDasharray="4 3" fill="none" />
      <text x={W - 6} y={16} textAnchor="end" fontSize="13" fill="#e8ecff" fontFamily="VT323">{o.targetBody} · {AU} AU · sunlight {pct(1 / (AU * AU), 0)} · cruise {o.cruiseYears} yr</text></g>;
  }
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full pixel" style={{ height, background: '#050814' }}>{Array.from({ length: 30 }).map((_, i) => <rect key={i} x={(i * 71) % W} y={(i * 113) % H} width={1} height={1} fill="#8a9ad8" opacity={0.5} />)}{body}</svg>;
}

