import { useMemo, useState } from 'react';

export interface Series { name: string; color: string; points: [number, number][]; dashed?: boolean; area?: boolean }

/** Minimal crisp SVG line chart with hover readout. */
export function LineChart({ series, height = 140, yLabel, xLabel = 'day', yMin, yMax, markers = [], format = (v: number) => v.toFixed(1), refLines = [] }: {
  series: Series[]; height?: number; yLabel?: string; xLabel?: string; yMin?: number; yMax?: number;
  markers?: { x: number; color: string; label: string }[]; format?: (v: number) => string; refLines?: { y: number; color: string; label: string }[];
}) {
  const W = 600, H = height, padL = 46, padR = 8, padT = 10, padB = 20;
  const [hover, setHover] = useState<number | null>(null);
  const { x0, x1, y0, y1 } = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of series) for (const [x, y] of s.points) { if (!Number.isFinite(y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (const r of refLines) { y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y); }
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    if (yMin !== undefined) y0 = yMin; if (yMax !== undefined) y1 = yMax;
    if (y1 - y0 < 1e-9) { y1 = y0 + 1; }
    if (x1 - x0 < 1e-9) x1 = x0 + 1;
    return { x0, x1, y0, y1: y1 + (y1 - y0) * 0.05 };
  }, [series, yMin, yMax, refLines]);
  const sx = (x: number) => padL + ((x - x0) / (x1 - x0)) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
  const hoverX = hover === null ? null : x0 + ((hover - padL) / (W - padL - padR)) * (x1 - x0);
  const values = hoverX === null ? [] : series.map((s) => {
    let best: [number, number] | null = null;
    for (const p of s.points) if (!best || Math.abs(p[0] - hoverX) < Math.abs(best[0] - hoverX)) best = p;
    return { s, p: best };
  });
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full pixel" style={{ height: 'auto', maxHeight: H * 1.6 }}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(((e.clientX - r.left) / r.width) * W); }}
        onMouseLeave={() => setHover(null)}>
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="#0a0f20" stroke="#2e3d70" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => { const y = padT + f * (H - padT - padB); return <g key={f}><line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#1a2446" /><text x={padL - 4} y={y + 4} fontSize="11" fill="#9aa6d0" textAnchor="end" fontFamily="VT323">{format(y1 - f * (y1 - y0))}</text></g>; })}
        <text x={padL} y={H - 4} fontSize="11" fill="#9aa6d0" fontFamily="VT323">{Math.round(x0)}</text>
        <text x={W - padR} y={H - 4} fontSize="11" fill="#9aa6d0" textAnchor="end" fontFamily="VT323">{Math.round(x1)} {xLabel}</text>
        {yLabel && <text x={padL + 4} y={padT + 12} fontSize="12" fill="#9aa6d0" fontFamily="VT323">{yLabel}</text>}
        {refLines.map((r, i) => <g key={i}><line x1={padL} x2={W - padR} y1={sy(r.y)} y2={sy(r.y)} stroke={r.color} strokeDasharray="6 4" /><text x={W - padR - 4} y={sy(r.y) - 3} fontSize="11" fill={r.color} textAnchor="end" fontFamily="VT323">{r.label}</text></g>)}
        {markers.map((m, i) => <g key={i}><line x1={sx(m.x)} x2={sx(m.x)} y1={padT} y2={H - padB} stroke={m.color} strokeWidth="1" opacity="0.7" /><title>{m.label}</title></g>)}
        {series.map((s) => {
          if (!s.points.length) return null;
          const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(Number.isFinite(y) ? y : y1).toFixed(1)}`).join(' ');
          return <g key={s.name}>
            {s.area && <path d={`${d} L${sx(s.points[s.points.length - 1][0])},${sy(y0)} L${sx(s.points[0][0])},${sy(y0)} Z`} fill={s.color} opacity="0.15" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} />
          </g>;
        })}
        {hover !== null && hover >= padL && <line x1={hover} x2={hover} y1={padT} y2={H - padB} stroke="#f8f0d8" opacity="0.5" />}
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[16px] leading-tight mt-1">
        {series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[3px]" style={{ background: s.color }} />{s.name}{values[i]?.p ? <b className="ml-1" style={{ color: s.color }}>{format(values[i].p![1])}</b> : null}</span>
        ))}
        {hoverX !== null && <span className="text-muted ml-auto">{xLabel} {Math.round(hoverX)}</span>}
      </div>
    </div>
  );
}
