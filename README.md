# Mission HQ — Space Mission Design Game

NASA Space Apps Challenge 2026 · *Space Mission Design Game*

A Gen-3-Pokémon-style, top-down pixel-art game set on a NASA HQ campus. Pick a mission, build a spacecraft,
choose its orbit and rocket, press LAUNCH and watch it fly — then learn *why* it worked or failed, tweak one thing
and fly again. Solo, or with up to 4 friends in online co-op.

All pixel art is generated in code (no asset files). The physics engine, simulator and multiplayer reducer are
pure TypeScript shared by the browser and the server.

## Quick start

```bash
npm install
npm run dev          # Vite client on :5173 + multiplayer server on :8787 (proxied)
```

Open http://localhost:5173, enter a name and pick **Solo mission**, **Online co-op** (same room code on up to
4 machines) or **Local tabs** (several tabs on one device, no server needed).

Production (one process serves the game, WebSocket rooms and the leaderboard API):

```bash
npm run build && npm start      # http://localhost:8787   (PORT env var to change)
```

| Script | What it does |
|---|---|
| `npm run test:engine` | Flies every mission's NASA baseline: six resources, blockers, one simulated flight, 100-run Monte Carlo |
| `npm run test:phase3` | 45 Phase 3 checks: mission catalog, Easy/Medium presets, room flow, map + guard, legacy saves, word budget |
| `npm run calibrate` | Enumerates every Easy/Medium preset combination and reports how many fly |
| `npm run build:single` | Single self-contained HTML build (`dist-single/`) + claude.ai Artifact page (`dist-artifact/`) |
| `npm run typecheck` | TypeScript check of client, shared engine and server |

Clients can point at a remote server with `?server=wss://your-host` and pre-fill a room with `?room=CODE`.

## How a game flows

1. **Start Menu** → **Mission Selection** (7 cards):
   * Easy — 🌕 Lunar Reconnaissance Orbiter · 🌀 Earth Climate & Storm Watcher
   * Medium — 🧊 Lunar South Pole Ice Hunter · ☄️ Asteroid Belt Rendezvous (Vesta)
   * Hard — 🔴 Red Planet Odyssey (Mars) · 🪐 Europa Icy Moon Deep Probe
   * Sandbox — 🧪 Unlimited NASA Testbed
2. **NASA HQ campus** with exactly five buildings:

| Building | What happens inside |
|---|---|
| **Space Mission** (north) | The main hub: build the spacecraft & rocket, watch six resource bars, press **LAUNCH** |
| **Mission Control** (south-west) | **Locked until your first launch.** Live telemetry, results (success/fail, subsystem breakdown, why-takeaways, closest real NASA mission) and a 3D replay |
| **Archives** (south-east) | Every run: score, days flown, setup and key lesson. Load, 🔧 tweak & fly again, compare A/B, share codes |
| **Academy** (south) | Visual cards on rockets, orbits, Δv, sunlight, radio, radiation, heat, reliability — and real NASA missions |
| **HQ Command** (north-east) | Co-op hub: team roles, short briefing, strategy & chat. **In solo a security guard blocks the door**; in co-op he steps aside |

## Difficulty tiers inside the Space Mission building

* **Easy** — a 4-slide guide, then exactly **3 choices** (💲 cheap / 💲💲 balanced / 💲💲💲 best) for Engine, Fuel Tank,
  Power, Science, Comms and Orbit. The frame and rocket are auto-picked. Bars go green/yellow/red with a one-line tip.
* **Medium** — nine subsystems (adds Pointing, Thermal, Propellant type, Orbit altitude, Rocket) with 3–4 options,
  a one-line *why* (Δv, Isp, sunlight², data rate) and live numbers. Tighter NASA margins.
* **Hard / Sandbox** — the full catalog (100+ parts, 10 orbits, 8 rockets, 5 ground networks): every choice ripples
  through Mass, Power, Δv, Thermal, Link and Cost. Tooltips stay ≤ 2–3 sentences.

Controls: arrows/WASD walk · Shift run · E/Space interact · Esc close · touch D-pad on phones. The right-hand
quick bar opens any building's terminal without walking.

## Under the hood

* **Coupled physics**: power sizing across eclipses, battery depth-of-discharge vs cycle life, dB link budgets,
  Tsiolkovsky Δv with separate engines and tanks, drag decay and the 25-year space-junk rule, radiation dose,
  k-of-n reliability, coverage/resolution, learning-curve cost, lead-time schedule, Mars/Vesta/Jupiter cruise.
* **Simulation** with launch scrubs, failures, flares, wheel friction, conjunctions, leaks and software faults —
  emergency calls by the Ops role; **Monte Carlo** (100 futures) and a 0–1000 score.
* **Multiplayer**: 4 roles, permissions, resource locks, proposals with approve / reject / approve + fix.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system architecture and formulas.

## Layout

```
shared/            pure TS: types, catalogs, physics engine, simulator, scoring, room reducer, protocol
  data/mission.ts            7 missions, orbits, rockets, ground networks, difficulty rules, NASA baselines
  data/missionPresets.ts     Easy (3-choice) and Medium (3–4 option) preset tables
  data/nasaMissions.ts       real NASA missions (Academy + matcher), links, wavelength facts
  engine/presets.ts          preset choices → full design (auto frame + rocket)
  engine/payloadChain.ts     optics + detector cooling multipliers
  engine/missionMatch.ts     closest real NASA mission
server/index.ts    Node HTTP + WebSocket rooms + leaderboard
src/game/          canvas engine (guard step-aside, locked doors), procedural sprites, 5-building map, dialogue
src/net/           transports: solo, local tabs, WebSocket, claude.ai room
src/state/         Zustand store (scenes: title → select → game), simulation controller, archives (localStorage)
src/ui/            MissionSelect, HUD, buildings (SpaceMission, MCC, Archives, Academy, HQCommand), widgets
scripts/           engine check, Phase 3 checks, preset calibration, Artifact page builder
```
