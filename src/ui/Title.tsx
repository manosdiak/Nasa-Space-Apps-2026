import { useEffect, useRef, useState } from 'react';
import { makeSeed } from '../../shared/engine/rng';
import { defaultServerUrl } from '../net/transport';
import { HOSTED, getCap } from '../net/claudeHost';
import { useStore } from '../state/store';
import { AvatarIcon } from './widgets/AvatarIcon';

function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const x = c.getContext('2d')!;
    let raf = 0; const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2 }));
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const w = (c.width = Math.ceil(window.innerWidth / 3)), h = (c.height = Math.ceil(window.innerHeight / 3));
      x.fillStyle = '#070a18'; x.fillRect(0, 0, w, h);
      for (const s of stars) {
        const px = Math.floor(((s.x * w + t * 0.004 * s.z * 10) % w)), py = Math.floor(s.y * h);
        x.fillStyle = s.z > 0.8 ? '#ffffff' : s.z > 0.5 ? '#9fb4ff' : '#4a5a9a';
        x.fillRect(px, py, s.z > 0.85 ? 2 : 1, 1);
      }
      // planet
      const cx = Math.floor(w * 0.82), cy = Math.floor(h * 0.86), r = Math.floor(Math.min(w, h) * 0.32);
      for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
        if (xx * xx + yy * yy > r * r) continue;
        const land = Math.sin((xx + t * 0.002) * 0.15) + Math.cos(yy * 0.2 + xx * 0.05) > 0.9;
        x.fillStyle = (xx + yy) > r * 0.6 ? (land ? '#1e4a2a' : '#12305a') : land ? '#3a8a4a' : '#2a6ad0';
        x.fillRect(cx + xx, cy + yy, 1, 1);
      }
      const a = t * 0.0006;
      x.fillStyle = '#f8e048'; x.fillRect(Math.floor(cx + Math.cos(a) * r * 1.4), Math.floor(cy + Math.sin(a) * r * 0.45 - r * 0.2), 2, 2);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="fixed inset-0 w-full h-full" style={{ imageRendering: 'pixelated' }} />;
}

export function Title() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const connect = useStore((s) => s.connect);
  const status = useStore((s) => s.status);
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || makeSeed(5));
  const [server, setServer] = useState<'checking' | 'up' | 'down'>('checking');
  const serverUrl = defaultServerUrl();
  useEffect(() => {
    if (HOSTED) { getCap('room').then((r) => setServer(r ? 'up' : 'down')); return; }
    if (!serverUrl) { setServer('down'); return; }
    const http = serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
    fetch(`${http}/api/health`).then((r) => setServer(r.ok ? 'up' : 'down'), () => setServer('down'));
  }, [serverUrl]);
  const name = profile.name;
  const ready = name.trim().length > 0;
  const go = (k: 'solo' | 'online' | 'local') => { if (!ready) setProfile({ name: 'Cadet' }); connect(k, k === 'solo' ? 'SOLO' : room); };
  return (
    <div className="fixed inset-0 overflow-y-auto">
      <Starfield />
      <div className="relative min-h-full flex flex-col items-center justify-center p-4 gap-4">
        <div className="text-center">
          <div className="font-pixel text-[11px] sm:text-[13px] text-accent mb-3 tracking-widest">NASA SPACE APPS 2026</div>
          <h1 className="font-pixel text-[30px] sm:text-[52px] leading-tight text-gold" style={{ textShadow: '4px 4px 0 #8a3a10, 8px 8px 0 #000' }}>MISSION HQ</h1>
          <div className="font-pixel text-[9px] sm:text-[12px] mt-3 text-cream">SPACE MISSION DESIGN GAME</div>
          <p className="text-[19px] sm:text-[22px] text-muted max-w-[640px] mt-3 mx-auto leading-snug">Walk the NASA HQ campus, pick a mission objective, build a spacecraft, choose an orbit and a rocket, then fly it — alone or with up to 4 teammates negotiating every trade-off.</p>
        </div>
        <div className="px-frame w-full max-w-[640px] p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-pixel text-[9px] text-muted">YOUR NAME</span>
            <input className="px-input text-[22px]" value={name} maxLength={16} placeholder="e.g. Ada" onChange={(e) => setProfile({ name: e.target.value })} />
          </label>
          <div>
            <span className="font-pixel text-[9px] text-muted">AVATAR</span>
            <div className="flex gap-2 mt-1 flex-wrap">
              {[0, 1, 2, 3, 4, 5].map((a) => (
                <button key={a} onClick={() => setProfile({ avatar: a })} className={`p-1 border-2 ${profile.avatar === a ? 'border-gold bg-white/10' : 'border-line'}`} aria-label={`Avatar ${a + 1}`}>
                  <AvatarIcon avatar={a} size={32} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2 mt-1">
            <button className="px-btn primary py-4" onClick={() => go('solo')} disabled={status === 'connecting'}>▶ SOLO MISSION</button>
            <button className="px-btn gold py-4" onClick={() => go('online')} disabled={server !== 'up' || status === 'connecting'} title={server === 'up' ? 'Up to 4 players online' : 'Online play is not available from this page'}>⚑ ONLINE CO-OP</button>
            <button className="px-btn py-4" onClick={() => go('local')} disabled={status === 'connecting'} title="Several browser tabs/windows on this device share one room">⧉ LOCAL TABS</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-pixel text-[9px] text-muted">ROOM CODE</span>
            <input className="px-input w-[130px] font-pixel text-[12px] uppercase" value={room} maxLength={8} onChange={(e) => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button className="px-btn sm ghost" onClick={() => setRoom(makeSeed(5))}>NEW</button>
            <span className="text-[16px] text-muted">Teammates join with the same code.</span>
          </div>
          <div className="text-[16px] leading-snug text-muted">
            {server === 'up' && <span className="text-ok">● {HOSTED ? 'Online co-op is live on this page — teammates open it, pick Online co-op and type the same room code.' : 'Multiplayer server online — share the room code with up to 3 friends.'}</span>}
            {server === 'down' && (HOSTED
              ? <span>● Online co-op needs a signed-in viewer who can interact with this page. <b className="text-cream">Local tabs</b> works now: open the page in several tabs with the same room code.</span>
              : <span>● No multiplayer server on this page. Run <code className="text-cream">npm run server</code> (or open with <code className="text-cream">?server=wss://host</code>) for online play. <b className="text-cream">Local tabs</b> works right now: open this page in several tabs/windows with the same room code.</span>)}
            {server === 'checking' && <span>● Checking for a multiplayer server…</span>}
          </div>
        </div>
        <div className="text-[16px] text-muted text-center max-w-[640px]">Arrow keys / WASD to walk · Shift to run · E or Space to interact · Esc closes panels · works on touch screens too</div>
      </div>
    </div>
  );
}
