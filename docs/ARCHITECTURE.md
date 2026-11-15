# Mission HQ — System Architecture & Physics Trade-Off Formulas

NASA Space Apps 2026 · *Space Mission Design Game*

## 1. System architecture

```
┌──────────────────────────── Browser (React 19 + TypeScript + Tailwind 4) ────────────────────────────┐
│                                                                                                      │
│  Canvas tile engine (src/game)            React UI (src/ui)                       Zustand store       │
│  ─ procedural pixel tiles & sprites       ─ HUD: 6 resource pillars + bottlenecks  (src/state/store)   │
│  ─ campus overworld + 5 interiors         ─ Mission Select · Space Mission · MCC · ─ RoomState replica │
│  ─ warps, locked doors, guard, dialogue     Archives · Academy · HQ Command        ─ ResourceState     │
│  ─ remote avatars (presence)              ─ negotiation dock, chat, anomaly modal   ─ UI state         │
│            │                                          │                                   ▲          │
│            └───────────── presence ───────┐           │ actions (DesignChange, vote…)     │ reduce() │
│                                           ▼           ▼                                   │          │
│                         Transport (src/net) ── Solo | Local tabs | Online WS | claude.ai room         │
│                                                                                                      │
│  Simulation controller (src/state/simController): local replica of the deterministic flight sim,     │
│  replays sequenced anomaly decisions, then 100-run Monte Carlo → MissionReport → Archives (localStorage)│
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                     │                                              ▲
                     ▼                                              │
┌──────────── shared/ (pure TypeScript, used by client AND server) ─────────────────────────────────────┐
│ types.ts      schemas: MissionObjective, SpacecraftComponent, Orbit, LaunchVehicle, ResourceState,   │
│               MissionRunSave, PlayerRole, MissionDesign, SimResult, MissionReport, LeaderboardEntry    │
│ data/         component catalog (71 parts), orbits, launch vehicles, ground networks, objectives,      │
│               difficulty specs, roles, mentor baseline designs                                        │
│ engine/       physics.ts (budgets, link budget, power, Δv, decay, radiation, reliability, science)     │
│               simulate.ts (time-stepped sim + anomalies + Monte Carlo) · score.ts (score, analysis,    │
│               run comparison) · rng.ts (seeded mulberry32)                                             │
│ room.ts       RoomState + deterministic reducer: roles, permissions, proposals, resource locks,         │
│               design-phase random events, launch poll, decisions, load/branch                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                     ▲
┌──────────── server/index.ts (Node + ws) ──────┐
│ HTTP: serves dist/, /api/leaderboard (JSON)   │
│ WS /ws: rooms of ≤4 → RoomCore sequences      │
│ actions → broadcast; presence relayed 25 Hz   │
└───────────────────────────────────────────────┘
```

**Determinism is the multiplayer model.** A host (the Node server, an elected browser tab, or the in-process
solo core) stamps every action with a sequence number, time and nonce. Every client runs the *same* reducer on
the *same* sequence, so all replicas hold identical state. The flight simulation is seeded by the scenario seed
and fed the sequenced anomaly decisions, so every player watches the identical flight and computes the identical
report (verified: two clients → identical 779-point report).

Transports:

| Transport | When | How |
|---|---|---|
| Solo | offline | RoomCore in-process |
| Local tabs | several tabs on one device; fallback when no server | BroadcastChannel, host election, heartbeat & hand-over |
| Online (server) | `npm run server` | WebSocket rooms, server-side RoomCore, global leaderboard |
| Online (claude.ai) | hosted Artifact build | the viewer's `room` capability: named room per code, elected host runs RoomCore, chunked messages (4 KiB limit), presence for avatars, host hand-over; shared leaderboard in the Artifact `db` |

## 2. Roles, permissions & negotiation

| Role | Owns (resources) | Decides |
|---|---|---|
| Flight Director (FD) | Time | objective, difficulty, seed, orbit, duration, launch GO, load/branch |
| Spacecraft Systems Engineer (SE) | Mass, Power | bus, fleet size, power, batteries, computers, ADCS, propulsion, thermal |
| Principal Investigator (PI) | Data | instruments |
| Ops, Comms & Resource Controller (OPS) | Comms, Budget | radios, launch vehicle, ground network, contact hours, reserves, anomaly responses |

A design change is applied immediately unless it (a) touches a decision owned by another *human* player,
(b) pushes a pillar owned by another human into yellow/red, or (c) consumes a resource another player has
**locked**. Then it becomes a **proposal** that the owners approve, reject, or **approve + fix** (attach a
counter-measure from their own subsystem — e.g. "approve the SAR radar and add a 2 kW array"). Unclaimed roles are
shared by everyone; solo players hold all four.

## 3. Physics & trade-off formulas (shared/engine/physics.ts)

### Orbits
* Period: `T = 2π·√(a³/μ)`, `a = R + h` (Earth μ = 398 600 km³/s², Moon μ = 4 902.8)
* Eclipse fraction (cylindrical shadow, sun angle β): `f = acos(√(h²+2Rh) / ((R+h)·cos β)) / π`, zero when `β ≥ asin(R/(R+h))`. SSO dawn–dusk uses β = 75°.
* Ground-station visibility (10° mask): half-angle `λ = acos(R·cos ε/(R+h)) − ε`; typical pass `0.7·(2λ/360)·T`; passes/day scale with orbits/day, `2λ/180`, station count and polar-station geometry.
* Slant range at 20° elevation: `ρ = √((R+h)² − (R cos ε)²) − R sin ε`
* Atmospheric drag: piecewise-exponential density ρ(h) (Vallado table), `a_drag = ½ρv²·C_D·A/m`; decay `da/dt = −√(μa)·ρ·B`, integrated numerically to 180 km for lifetime; drag make-up Δv/yr = `a_drag × 3.156·10⁷ s`.
* Radiation: LEO/SSO dose rate interpolated by altitude (0.05 → 7 krad/yr), GTO 40, GEO 5, lunar 2, L1 1.5, Jupiter tour 900 krad/yr (behind 2.5 mm Al); divided by bus shielding (vault ×25), instruments get 60 % of it.

### Launch & propulsion
* LV capacity from `max_payload_kg_by_orbit[orbit]` (LEO/SSO/GTO/GEO/TLI/L1/L2/MARS/ASTEROID/JUPITER ≈ C3 classes), altitude-corrected `× (1 − 0.00028·Δh)`.
* Hard validator: block if `launch mass > capacity` (single spacecraft), fleets need `⌈mass/capacity⌉ ≤ 4` launches, stowed volume ≤ fairing.
* Δv budget = insertion (LOI 850 m/s, Mars MOI 1 000 m/s, Vesta cruise+capture 4 500 m/s, JOI+tour 1 100 m/s, L1 80 m/s; ×1.8 for planetary low-thrust spirals, ×1.15 for the heliocentric Vesta spiral) + station-keeping/drag × years + momentum dumps + disposal (Hohmann to 250 km perigee if natural decay > mission+5 yr; GEO graveyard 11 m/s) + 10 %.
* Tsiolkovsky: `m_prop = m_dry·(e^(Δv/(Isp·g₀)) − 1)`; insertion on the best chemical system, the rest on the highest-Isp one.
* **Engines and tanks are separate parts** (CubeSat modules keep built-in tanks). Tanks are filled to `min(capacity, 1.15·need)`: the 15 % reserve covers leaks and debris dodges; no tank = blocker, tank < need = early run-dry, tank < 1.15·need = "no reserve" warning.
* Electric engines must be powered during cruise: `P_array(1 AU)·flux((1+r)/2) ≥ bus + thruster + 30 W`.
* Space-junk rule: LEO/SSO spacecraft without propulsion whose natural decay exceeds mission + 25 yr get a Time/Fuel warning.
* Deep-space data budget: at Mars/Vesta, instruments faster than 0.5 Mbps record only `orbit.dataDuty` of the time (targeted observations); science is unaffected.

### Power (SMAD sizing)
* Solar: `P = Σ P₁AU · cos-factor · (1/r²) · LILT(r>3 AU) · (1 − d)^cruise · (1 − d·k_rad)^years`; RTG: `P₀·(1 − d)^t` day and night.
* Loads: always-on bus/avionics/ADCS/thermal (cold-spare wheels at 25 %), instruments × duty (daylight-only instruments concentrated in sunlight), radios × contact fraction, heaters `q_cold·A_surface·(MLI ? 0.6 : 1) − 0.1·RTG waste heat`, electric thrusters × firing duty.
* Required array: `P_sa = (Pₑ·Tₑ/0.65 + P_d·T_d/0.85) / T_d` (after subtracting RTG output). Margin = `(supply − demand)/demand`.
* Battery: allowed DoD `= clamp(0.8·√(N₈₀ / cycles), 0.1, 0.8)`; needed capacity `Pₑ·Tₑ / (DoD·0.9)`; cycle life at actual DoD `N₈₀·(0.8/DoD)²`.
* Thermal: rejection `radiator·(MLI ? 1.3 : 1) + Σ added` vs hot load `0.9·(load + 0.3·instrument peaks) + absorbed flux·A·0.3`.

### Communications (link budget, dB)
* Dish gain `G = 10·log₁₀(0.55·(πDf/c)²)`, beamwidth `θ ≈ √(27 000/G_lin)`, pointing loss `12·(e/θ)²`.
* `EIRP = 10·log P_tx + G − 1 dB`; `L_fs = 20·log₁₀(4πdf/c)`.
* `C/N₀ = EIRP + G/T − L_fs − L_point − L_atm + 228.6`; rate `R = 10^((C/N₀ − Eb/N₀_req − margin)/10)` capped by the modem (`Eb/N₀_req = 2.5 dB`, margin 3 dB).
* Optical: `R = R_ref·(d_ref/d)²`, ×(θ/e)⁴ off-pointing, weather availability 65 %.
* Downlink/day = `R × contact minutes × 60 × 0.9`. Contact: geometric passes (LEO/SSO) or booked hours × visibility (GEO/Moon/L1/Jupiter); DSN cannot track LEO.

### Data
* Generation `Σ rate·duty·86 400 / compression` (Gb/day); target-window instruments at Jupiter use flyby duty 0.2 %.
* Storage needed = `gen × longest contact gap × 2`; returned fraction = `min(1, downlink/gen)`; overflow day `= storage / (gen − downlink)`.

### Science
* Per instrument: `points × relevance(objective, kind) × orbit suitability × coverage × resolution × pointing × duplicate factor (1, ½, ¼) × real-time factor`.
* Earth imaging: swath `2h·tan(FOV/2)`; revisit `40 075 km / (swath × orbits/day × N × (day-only ? 1 : 2))`; coverage `min(1, req/revisit)^0.6`; GSD `gsd₅₀₀·h/500`, resolution `min(1, req/GSD)^0.5`.
* Fleet: coverage objectives `1 + 0.12(N−1)` (+ revisit), others `N^0.6`; synergy bonuses (e.g. neutron + lidar +20 %).
* Mission science = rate × years × (0.25 + 0.75·returned fraction); in flight, science travels with the data and only counts once downlinked.

### Cost & schedule
* Hardware `Σ cost·qty·overruns`, fleet `× N^0.848` (90 % learning; CubeSats 85 %); AI&T 20–35 %; PM/SE 15 %; reserves (difficulty minimum); launch (or rideshare $/kg); operations `ops/yr·√N × years` + ground (`base + $/h × hours`); late launch costs 1.5 % of development per month.
* Schedule = longest lead time + 4 + 0.35·(part types) + test campaign + fleet production; launch = max(ready, LV lead) + delays, snapped to Jupiter windows (13 months).

### Lifetime & reliability
* Lifetime = min(bus design life ×1.3, drag decay with propellant, propellant for station-keeping, radiation `TID·shield/dose`, solar degradation below load, battery cycle life).
* Unit reliability `R(t) = e^(−λt)`, `λ = −ln R₅/5`; k-of-n redundancy `Σ C(n,j)R^j(1−R)^(n−j)` (3-of-n wheels); radiation penalty near TID; fleet success needs `⌈N·f_min⌉` working; × launch reliability.

### Simulation (shared/engine/simulate.ts)
Daily steps per spacecraft: dose, unit failures (hazard × radiation acceleration × wheel wear × age past design life), ADCS degradation (two-wheel mode), station-keeping/drag propellant and decay, power balance with instrument load-shedding and battery-limited eclipses, brown-out loss, battery fade, data queues (priority low-rate + bulk) with science credited on downlink, overflow loss. Random events with operator decisions: solar flare/SEU, reaction-wheel friction, conjunction alert, ground outage, ops budget cut, software safe mode, instrument contamination, thruster leak; plus debris strikes, battery cell failures, geomagnetic storms, launch scrubs.

### Score (0–1000 × difficulty)
`300·P(success, Monte Carlo 100 runs) + 300·min(1.25, science/baseline)/1.25 + 200·efficiency(budget, mass, power margins) + 200·coordination` × (Cadet 0.8 · Engineer 1.0 · Flight Director 1.3 · Sandbox 0.5).
Coordination = proposals resolved, negotiation speed, first-time launch GO, work spread across players, low design churn, anomaly response speed.

## 4. Calibration
`npm run test:engine` flies every mission's NASA baseline at its own difficulty and prints the six pillars, blockers,
a simulated flight and a 100-run Monte Carlo (success 65–96 %, Europa lowest). `npm run calibrate` enumerates every
Easy (3⁶ = 729) and Medium (≈26 000–47 000) preset combination: all-balanced Easy designs fly, all-max designs bust the
budget and all-cheap designs fall short, so winning requires a mix.

## 5. Phase 3 — streamlined flow, 5 buildings, tiered difficulty

**Removed:** Goddard MDL stages, JPL CML gates, the 6-step lifecycle board, CubeSat certification/licensing/manifest,
TLE first-contact puzzle, BioNutrients ISS payload, CSA kiosk, GMAT planner UI and the citations drawer
(`nasaFramework`, `cubesatCertificationEngine`, `mdlTrades`, `bioModel`, `bioPayload`, `nasaTypes`,
`nasaOfficialResources`, `Cleanroom`, `Launch`, `HQ`, `Lifecycle`, `CsliWing`, `SpectrumChain`, `GroundStation`,
`NasaLibrary`, `Vault`). Kept: the optics/cryo payload chain (`payloadChain.ts`), the real-mission matcher
(`missionMatch.ts`), `gmat.ts` orbit math and the 3D replay (`MissionViz3D.tsx`).

**Flow.** `scene: 'title' → 'select' → 'game'`. The Title screen is unchanged; after Start the store shows
`MissionSelect` unless the room already has a mission (co-op joiners go straight to the campus). The reducer action
`selectMission` loads `freshDesign(id)`: Easy/Medium start with empty preset choices, Hard with a bare bus, Sandbox with a
working baseline. Only the Flight Director can change a chosen mission.

**Presets.** `DesignChange { k: 'preset', slot, option }` stores the choice in `design.presets` and `composeDesign()`
rebuilds the hardware: base kit + chosen options, bus = first in `busIds` that carries the parts, rocket = chosen
option or the cheapest in `autoRockets` with ≥ 5 % mass margin. `signoff` refuses to launch until every slot has a
choice. Hard/Sandbox keep the per-part `component`/`bus`/`orbit`/`launch`/`ground` changes.

**Locks.** `room.launches` counts GO decisions; Mission Control's door (engine `doorLock` hook) and panel are locked
while it is 0 — the door shows a red stand-by lamp and the exact stand-by message. The HQ guard is an NPC with an
`aside` tile: the engine's `npcAside` hook moves him off the door when the session is co-op (online or local tabs).

**Results.** `buildReport` adds `takeaways` (3–5 one-line icon reasons) next to the subsystem reliability bars,
the six resources at launch, the closest real NASA mission and the score breakdown; engineering detail is folded.

**Word budget.** `npm run test:phase3` enforces ≤ 16-word mission taglines, ≤ 12-word option blurbs and ≤ 22-word
Medium "why" lines.

