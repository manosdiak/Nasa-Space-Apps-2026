import { AVATARS, drawCharacter, NPC_PALS, type CharPal } from '../../game/sprites';

const cache = new Map<string, string>();
function render(pal: CharPal, key: string, dir = 0) {
  const k = `${key}|${dir}`;
  if (cache.has(k)) return cache.get(k)!;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 22;
  const x = c.getContext('2d')!;
  drawCharacter(x, 0, 2, dir, 0, pal);
  const url = c.toDataURL();
  cache.set(k, url);
  return url;
}

export function AvatarIcon({ avatar, size = 32, npc, dir = 0 }: { avatar?: number; size?: number; npc?: string; dir?: number }) {
  const pal = npc ? NPC_PALS[npc] ?? AVATARS[0] : AVATARS[(avatar ?? 0) % AVATARS.length];
  const url = render(pal, npc ?? `a${avatar}`, dir);
  return <img src={url} width={size} height={(size * 22) / 16} alt="" style={{ imageRendering: 'pixelated', display: 'block', background: '#1a2446' }} />;
}
