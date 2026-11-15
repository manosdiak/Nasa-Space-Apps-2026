// Tiny procedural pixel-art worlds for mission cards (48×48, drawn once).
import { useEffect, useRef } from 'react';

type Kind = 'moon' | 'earth' | 'ice' | 'asteroid' | 'mars' | 'europa' | 'sandbox';
export const WORLD_OF: Record<string, Kind> = { lro: 'moon', storm: 'earth', lim: 'ice', ast: 'asteroid', mars: 'mars', eor: 'europa', sandbox: 'sandbox' };

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function draw(g: CanvasRenderingContext2D, kind: Kind, t: number) {
  const W = 48, C = 24;
  g.clearRect(0, 0, W, W);
  const r = rng(kind.length * 977 + 3);
  // stars
  for (let i = 0; i < 26; i++) { g.fillStyle = r() > 0.7 ? '#ffffff' : '#5a6aa8'; g.fillRect(Math.floor(r() * W), Math.floor(r() * W), 1, 1); }
  const R = kind === 'asteroid' ? 15 : kind === 'sandbox' ? 13 : 17;
  if (kind === 'europa') { // Jupiter behind
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dx = x - 44, dy = y - 6, d = Math.hypot(dx, dy);
      if (d < 26) { const band = Math.floor((y + x * 0.15) / 4) % 3; g.fillStyle = band === 0 ? '#d88a48' : band === 1 ? '#e8c088' : '#b86a38'; g.fillRect(x, y, 1, 1); }
    }
  }
  const cx = kind === 'europa' ? 20 : C, cy = kind === 'europa' ? 28 : C;
  const cr = rng(91);
  const craters = Array.from({ length: 9 }, () => ({ x: cx + (cr() - 0.5) * R * 1.4, y: cy + (cr() - 0.5) * R * 1.4, r: 1.5 + cr() * 3 }));
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let dx = x - cx, dy = y - cy;
    if (kind === 'asteroid') { const a = Math.atan2(dy, dx); dx /= 1 + 0.18 * Math.sin(a * 3 + 1); dy /= 0.85 + 0.12 * Math.cos(a * 2); }
    const d = Math.hypot(dx, dy);
    if (d > R) continue;
    const lit = (dx * -0.6 + dy * -0.5) / R; // light from upper-left
    const shade = lit > 0.25 ? 2 : lit > -0.3 ? 1 : 0;
    let col = '#888';
    const crater = craters.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
    switch (kind) {
      case 'moon': col = crater ? ['#5a5e6a', '#7a7e8a', '#9aa0aa'][shade] : ['#6a6e7a', '#a8acb8', '#d0d4dc'][shade]; break;
      case 'ice': col = dy > R * 0.55 ? ['#3a78a8', '#68b8e8', '#a8e8ff'][shade] : crater ? ['#4a4e5a', '#6a6e7a', '#8a909a'][shade] : ['#5a5e6a', '#9094a0', '#c0c4cc'][shade]; break;
      case 'earth': {
        const land = Math.sin((x + t * 0.05) * 0.35) + Math.cos(y * 0.4 + x * 0.1) > 1.1;
        const ang = Math.atan2(y - cy + 3, x - cx - 3), rr = Math.hypot(x - cx - 3, y - cy + 3);
        const spiral = rr < 9 && Math.sin(ang * 2 + rr * 0.9 - t * 0.02) > 0.55;
        col = spiral ? '#f4f8ff' : land ? ['#2a5a2a', '#3a8a4a', '#5aaa5a'][shade] : ['#123a7a', '#2a6ad0', '#4a8ae8'][shade];
        if (Math.abs(dy) > R * 0.85) col = '#e8f0ff';
        break;
      }
      case 'asteroid': col = crater ? ['#4a3a2a', '#6a5440', '#8a7058'][shade] : ['#5a4634', '#8a7058', '#b0946e'][shade]; break;
      case 'mars': col = dy < -R * 0.78 ? '#f4f0ec' : crater ? ['#6a2a18', '#8a3a20', '#a84a28'][shade] : ['#7a3018', '#c05a30', '#e07a48'][shade]; break;
      case 'europa': {
        const crack = Math.abs(Math.sin(x * 0.9 + y * 0.35)) < 0.12 || Math.abs(Math.sin(x * 0.3 - y * 0.8)) < 0.1;
        col = crack ? ['#6a3a28', '#9a5a38', '#b87a50'][shade] : ['#a89a80', '#e0d8c4', '#f8f4e8'][shade];
        break;
      }
      case 'sandbox': col = ['#5a2a8a', '#8a4ac8', '#b87af0'][shade]; break;
    }
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  if (kind === 'sandbox') { // ring
    for (let i = 0; i < 160; i++) { const a = (i / 160) * Math.PI * 2; const x = Math.round(C + Math.cos(a) * 21), y = Math.round(C + Math.sin(a) * 6); if (!(Math.sin(a) < 0 && Math.hypot(x - C, y - C) < R)) { g.fillStyle = ['#f2c14e', '#4ade80', '#58b8f8', '#f87171'][i % 4]; g.fillRect(x, y, 1, 1); } }
  }
  // orbiting spacecraft
  const a = t * 0.03;
  const sx = Math.round(cx + Math.cos(a) * (R + 5)), sy = Math.round(cy + Math.sin(a) * (R + 5) * 0.45);
  if (!(Math.sin(a) < 0 && Math.hypot(sx - cx, sy - cy) < R)) { g.fillStyle = '#f2c14e'; g.fillRect(sx, sy, 2, 1); g.fillStyle = '#58b8f8'; g.fillRect(sx - 2, sy, 2, 1); g.fillRect(sx + 2, sy, 2, 1); }
}

export function PixelWorld({ mission, size = 96, animate = true }: { mission: string; size?: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!;
    const kind = WORLD_OF[mission] ?? 'sandbox';
    let raf = 0, t = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 100) return;
      last = now; t += 4; draw(g, kind, t);
    };
    draw(g, kind, 0);
    if (animate) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mission, animate]);
  return <canvas ref={ref} width={48} height={48} style={{ width: size, height: size, imageRendering: 'pixelated' }} aria-hidden="true" />;
}
