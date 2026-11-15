// Turns the single-file build (dist-single/index.html) into page content for a
// claude.ai Artifact: the Artifact host supplies the <!doctype>/<html>/<head>/<body>
// skeleton (charset + viewport), so we keep only <title>, font links, styles,
// the root element and the inlined module script.
//   npm run build:single && node scripts/make-artifact.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('dist-single/index.html', 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = src.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const keepHead = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();
// Title first (the host scans the first 8 KB for it); styles/scripts after.
const title = keepHead.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>Mission HQ</title>';
const rest = keepHead.replace(title, '');
const out = `${title}\n${rest}\n${body.trim()}\n`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/mission-hq.html', out);
console.log(`dist-artifact/mission-hq.html  ${(out.length / 1024).toFixed(0)} KB`);
