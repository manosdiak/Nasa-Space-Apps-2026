// 3D replay of the mission (inspired by NASA Mission Viz): bodies, trajectory,
// live spacecraft position, ground-station cones, Earth's shadow, a timeline
// scrubber, chase / nadir / ground / overview cameras, stereo and WebXR VR.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { COMPONENT_MAP } from '../../../shared/data/components';
import { ORBIT_MAP } from '../../../shared/data/mission';
import { keplerPoint, sampleEllipse, sampleHalo, trueAnomaly } from '../../../shared/engine/gmat';
import { useStore } from '../../state/store';
import { n } from '../widgets/common';

type CamMode = 'free' | 'chase' | 'nadir' | 'ground' | 'helio';
type SceneMode = 'earth' | 'lunar' | 'libration' | 'helio';

const STATIONS: Record<string, [number, number, string][]> = {
  gs_uni: [[42.4, -71.1, 'Campus UHF (MA)'], [37.4, -122.2, 'Campus UHF (CA)'], [40.0, -105.3, 'Campus UHF (CO)']],
  gs_comm: [[78.2, 15.4, 'Svalbard'], [-72.0, 2.5, 'Troll'], [64.8, -147.5, 'Alaska'], [19.8, -155.5, 'Hawaii'], [1.3, 103.8, 'Singapore'], [-25.9, 27.7, 'Hartebeesthoek']],
  gs_optical: [[34.4, -117.7, 'Table Mountain'], [20.7, -156.3, 'Haleakalā'], [33.4, -116.9, 'Palomar']],
  gs_dsn34: [[35.4, -116.9, 'Goldstone'], [40.4, -4.2, 'Madrid'], [-35.4, 149.0, 'Canberra']],
  gs_dsn70: [[35.4, -116.9, 'Goldstone 70 m'], [40.4, -4.2, 'Madrid 70 m'], [-35.4, 149.0, 'Canberra 70 m']],
};

function pixelEarthTexture(): THREE.CanvasTexture {
  const W = 128, H = 64;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const noise: number[] = [];
  for (let i = 0; i < 24 * 12; i++) noise.push(rnd());
  const val = (x: number, y: number) => {
    const fx = (x / W) * 24, fy = (y / H) * 12;
    const x0 = Math.floor(fx) % 24, y0 = Math.min(11, Math.floor(fy)), x1 = (x0 + 1) % 24, y1 = Math.min(11, y0 + 1);
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const a = noise[y0 * 24 + x0], b = noise[y0 * 24 + x1], c2 = noise[y1 * 24 + x0], d = noise[y1 * 24 + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    const v = val(x, y) * 0.75 + val((x * 3) % W, (y * 3) % H) * 0.25;
    let col = '#1d4fa8';
    if (lat > 0.84) col = '#e8f0ff';
    else if (v > 0.6) col = lat < 0.35 && v > 0.72 ? '#c9a45c' : '#3f9a4a';
    else if (v > 0.55) col = '#2c6fc8';
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function label(text: string, color = '#f8f0d8'): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
  const g = cv.getContext('2d')!;
  g.font = '28px VT323, monospace'; g.fillStyle = 'rgba(8,12,28,0.75)';
  const w = Math.min(256, g.measureText(text).width + 16);
  g.fillRect(0, 6, w, 36); g.fillStyle = color; g.fillText(text, 8, 34);
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.center.set(0, 0.5);
  sp.userData.aspect = 256 / 48;
  sp.renderOrder = 10;
  return sp;
}

function spacecraftModel(cube: boolean): THREE.Group {
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(cube ? 0.5 : 1, cube ? 0.5 : 1, cube ? 1.2 : 1.2), new THREE.MeshLambertMaterial({ color: cube ? 0x8892b0 : 0xd8b04a }));
  g.add(bus);
  const pm = new THREE.MeshLambertMaterial({ color: 0x2b4fa0, emissive: 0x0a1030 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(cube ? 1.4 : 2.6, 0.05, cube ? 0.9 : 1), pm); p.position.x = s * (cube ? 1 : 1.9); g.add(p); }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.25, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xeeeeee, side: THREE.DoubleSide }));
  dish.rotation.x = Math.PI / 2; dish.position.z = -0.8; g.add(dish);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false }));
  glow.scale.set(1.6, 1.6, 1); g.add(glow);
  return g;
}

const latLon = (lat: number, lon: number, r: number) => {
  const phi = (90 - lat) * (Math.PI / 180), th = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};

interface Viz {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  stereo: THREE.StereoCamera;
  mode: SceneMode;
  craft: THREE.Group[];
  central: THREE.Vector3;
  earthSpin: THREE.Group | null;
  stations: { pos: THREE.Object3D; cone: THREE.Mesh; line: THREE.Line; lam: number }[];
  posAt: (tDays: number, phase: number, k: number) => { p: THREE.Vector3; v: THREE.Vector3; center: THREE.Vector3 };
  shadowR: number;
  scale: number;
  extraUpdate: (tDays: number) => void;
}

export function MissionViz3D() {
  const room = useStore((s) => s.room)!;
  const sim = useStore((s) => s.sim);
  const d = room.design;
  const orbit = ORBIT_MAP[d.orbit.id];
  const bus = COMPONENT_MAP[d.busId];
  const totalDays = sim?.totalDays ?? Math.round((orbit.cruiseYears + d.missionYears) * 365);
  const mountRef = useRef<HTMLDivElement>(null);
  const vrRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<Viz | null>(null);
  const [cam, setCam] = useState<CamMode>('free');
  const [pixel, setPixel] = useState(true);
  const [stereo, setStereo] = useState(false);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const [hud, setHud] = useState({ eclipse: false, visible: 0, rangeKm: 0 });
  const [glErr, setGlErr] = useState<string | null>(null);
  const [vrOk, setVrOk] = useState(false);
  const live = useRef({ cam, pixel, stereo, t, follow, playing });
  live.current = { cam, pixel, stereo, t, follow, playing };
  const cruiseD = orbit.cruiseYears * 365;
  const conops = [
    { day: 0, label: 'Launch', icon: '🚀' },
    ...(cruiseD > 1 ? [{ day: 1, label: 'Cruise', icon: '🛰' }, { day: cruiseD, label: 'Arrival & braking burn', icon: '🔥' }] : [{ day: 0.1, label: 'Deploy & check-out', icon: '🛰' }]),
    { day: cruiseD + 2, label: 'Science operations', icon: '🔬' },
    { day: Math.max(cruiseD + 3, totalDays - 1), label: 'End of mission', icon: '🏁' },
  ];
  const simEvents = (sim?.events ?? []).filter((e) => e.kind !== 'launch' && e.kind !== 'insertion' && !e.title.startsWith('Decision')).map((e) => ({ day: e.day, label: e.title, sev: e.severity }));

  useEffect(() => {
    if (follow && sim && room.sim) setT(sim.day);
  }, [follow, sim?.day, room.sim]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scene construction
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false }); }
    catch (e) { setGlErr(e instanceof Error ? e.message : 'WebGL unavailable'); return; }
    renderer.setClearColor(0x03050f);
    renderer.domElement.style.imageRendering = 'pixelated';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const stereoCam = new THREE.StereoCamera();
    scene.add(new THREE.AmbientLight(0x404a70, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2d0, 2.4);
    scene.add(sun);
    // stars
    const sg = new THREE.BufferGeometry();
    const sp: number[] = [];
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 1500; i++) { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 4000; sp.push(r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th)); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2, sizeAttenuation: false })));

    const fam = orbit.family;
    const mode: SceneMode = orbit.central === 'earth' ? 'earth' : fam === 'LUNAR' ? 'lunar' : fam === 'L1' || fam === 'L2' ? 'libration' : 'helio';
    const cube = !!bus.specs.cubeU;
    const N = Math.min(8, Math.max(1, d.fleetSize));
    const craft: THREE.Group[] = [];
    for (let k = 0; k < N; k++) { const m = spacecraftModel(cube); scene.add(m); craft.push(m); }
    const stations: Viz['stations'] = [];
    let earthSpin: THREE.Group | null = null;
    let posAt: Viz['posAt'];
    let central = new THREE.Vector3();
    let shadowR = 0, scale = 1;
    let extraUpdate: Viz['extraUpdate'] = () => undefined;
    const mkPath = (pts: THREE.Vector3[], color: number, dashed = false) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6 }) : new THREE.LineBasicMaterial({ color }));
      if (dashed) line.computeLineDistances();
      scene.add(line);
      return line;
    };
    const labels: { el: HTMLDivElement; obj: THREE.Object3D }[] = [];
    const labelLayer = labelsRef.current;
    const addLabel = (txt: string, pos: THREE.Vector3, size: number, color?: string, parent: THREE.Object3D = scene) => {
      const anchor = new THREE.Object3D(); anchor.position.copy(pos); parent.add(anchor);
      if (labelLayer) {
        const el = document.createElement('div');
        el.textContent = txt;
        el.style.cssText = `position:absolute;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:none;font:${size >= 1.5 ? 18 : 15}px VT323,monospace;color:${color ?? '#f8f0d8'};background:rgba(8,12,28,.7);padding:0 4px;border:1px solid rgba(0,0,0,.6);display:none`;
        labelLayer.appendChild(el);
        labels.push({ el, obj: anchor });
      }
      return anchor;
    };

    if (mode === 'earth') {
      // 1 unit = 1000 km
      const R = 6.371;
      scale = 1000;
      sun.position.set(100, 10, 0);
      earthSpin = new THREE.Group();
      scene.add(earthSpin);
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), new THREE.MeshLambertMaterial({ map: pixelEarthTexture() }));
      earthSpin.add(earth);
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 32, 16), new THREE.MeshBasicMaterial({ color: 0x6ab0ff, transparent: true, opacity: 0.12, side: THREE.BackSide })));
      addLabel('Earth', new THREE.Vector3(0, R * 1.3, 0), 1.6);
      // orbit
      let a: number, e = 0, inc = orbit.inclinationDeg, argp = 0;
      if (fam === 'GTO') { a = (2 * 6378 + 250 + 35786) / 2 / 1000; e = (35786 - 250) / (2 * 6378 + 250 + 35786); }
      else if (fam === 'GEO') { a = 42.164; inc = 0; }
      else a = R + d.orbit.altitudeKm / 1000;
      const raan = fam === 'SSO' && d.orbit.ltan === 'dawn-dusk' ? 90 : 25;
      const pts = sampleEllipse(a * 1000, e, inc, raan, argp, 256).map((p) => new THREE.Vector3(p[0] / 1000, p[1] / 1000, p[2] / 1000));
      mkPath(pts, 0xf2c14e);
      shadowR = R;
      const shadow = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 90, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x000010, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      shadow.rotation.z = Math.PI / 2; shadow.position.x = -45; scene.add(shadow);
      addLabel('Earth shadow (eclipse)', new THREE.Vector3(-a - 4, R + 1.5, 0), 1.3, '#9aa6d0');
      // ground stations + communication cones
      const mask = 10 * (Math.PI / 180);
      for (const [lat, lon, name] of STATIONS[d.groundNetworkId] ?? []) {
        const anchor = new THREE.Object3D(); anchor.position.copy(latLon(lat, lon, R)); earthSpin.add(anchor);
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0xff5050 })); anchor.add(dot);
        const hh = a - R;
        const lam = Math.PI / 2 - mask - Math.asin((R * Math.cos(mask)) / (R + hh));
        const coneH = (R + hh) * Math.cos(lam) - R, coneR = (R + hh) * Math.sin(lam);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, Math.max(0.1, coneH), 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
        cone.position.copy(anchor.position.clone().normalize().multiplyScalar(R + coneH / 2));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), anchor.position.clone().normalize());
        earthSpin.add(cone);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x4ade80 }));
        line.visible = false; scene.add(line);
        addLabel(name, anchor.position.clone().multiplyScalar(1.05), 0.8, '#ffb0b0', earthSpin);
        stations.push({ pos: anchor, cone, line, lam });
      }
      const period = 2 * Math.PI * Math.sqrt((a * 1000) ** 3 / 398600.4418);
      posAt = (_t, phase, k) => {
        const M = (phase + k / N) * 2 * Math.PI;
        const nu = trueAnomaly(M % (2 * Math.PI), e);
        const p = keplerPoint(a * 1000, e, inc, raan, argp, nu), p2 = keplerPoint(a * 1000, e, inc, raan, argp, nu + 0.01);
        const v = new THREE.Vector3(p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]).normalize();
        return { p: new THREE.Vector3(p[0] / 1000, p[1] / 1000, p[2] / 1000), v, center: new THREE.Vector3() };
      };
      camera.position.set(a * 1.25 + 5, a * 0.7 + 3, a * 1.25 + 5);
      (posAt as unknown as { period: number }).period = period;
    } else if (mode === 'lunar') {
      // 1 unit = 10,000 km for the transfer; the low lunar orbit is drawn ×8 for visibility
      scale = 10000;
      sun.position.set(200, 20, 0);
      const ER = 0.637 * 3, MR = 0.1737 * 3, moonPos = new THREE.Vector3(38.44, 0, 0);
      earthSpin = new THREE.Group(); scene.add(earthSpin);
      earthSpin.add(new THREE.Mesh(new THREE.SphereGeometry(ER, 32, 16), new THREE.MeshLambertMaterial({ map: pixelEarthTexture() })));
      const moon = new THREE.Mesh(new THREE.SphereGeometry(MR, 24, 12), new THREE.MeshLambertMaterial({ color: 0xbfc4cc }));
      moon.position.copy(moonPos); scene.add(moon);
      addLabel('Earth', new THREE.Vector3(0, ER + 1.2, 0), 1.2); addLabel('Moon', moonPos.clone().add(new THREE.Vector3(0, MR + 1, 0)), 1);
      const transfer: THREE.Vector3[] = [];
      for (let i = 0; i <= 80; i++) { const s = i / 80; transfer.push(new THREE.Vector3(ER + s * (moonPos.x - ER - MR * 3), Math.sin(s * Math.PI) * 9, -Math.sin(s * Math.PI) * 4)); }
      mkPath(transfer, 0x9aa6d0, true);
      const llo = MR + (d.orbit.altitudeKm / 10000) * 8 + 0.25;
      const ring: THREE.Vector3[] = []; for (let i = 0; i <= 96; i++) { const th = (i / 96) * Math.PI * 2; ring.push(moonPos.clone().add(new THREE.Vector3(0, Math.cos(th) * llo, Math.sin(th) * llo))); }
      mkPath(ring, 0xf2c14e);
      const dsnLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x4ade80 }));
      scene.add(dsnLine);
      stations.push({ pos: new THREE.Object3D(), cone: new THREE.Mesh(), line: dsnLine, lam: 0 });
      const cruise = Math.max(1, orbit.cruiseYears * 365);
      posAt = (tt, phase, k) => {
        if (tt < cruise) { const s = Math.min(1, tt / cruise); const i = Math.floor(s * 80); const p = transfer[i]; const q = transfer[Math.min(80, i + 1)]; return { p: p.clone(), v: q.clone().sub(p).normalize(), center: new THREE.Vector3() }; }
        const th = (phase + k / N) * Math.PI * 2;
        const p = moonPos.clone().add(new THREE.Vector3(0, Math.cos(th) * llo, Math.sin(th) * llo));
        const v = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
        return { p, v, center: moonPos.clone() };
      };
      central = moonPos;
      extraUpdate = () => {
        const p = craft[0].position;
        const toEarth = new THREE.Vector3().sub(p);
        const toMoon = moonPos.clone().sub(p);
        const behind = toMoon.dot(toEarth.clone().normalize()) > 0 && toMoon.clone().cross(toEarth.clone().normalize()).length() < MR;
        dsnLine.geometry.setFromPoints([new THREE.Vector3(), p.clone()]);
        (dsnLine.material as THREE.LineBasicMaterial).color.set(behind ? 0xf87171 : 0x4ade80);
      };
      camera.position.set(19, 26, 52); controls.target.set(19, 0, 0);
    } else if (mode === 'libration') {
      // 1 unit = 10,000 km; the Sun is far along −X
      scale = 10000;
      sun.position.set(-500, 0, 0);
      const ER = 2.2, sgn = fam === 'L1' ? -1 : 1, Lx = sgn * 150;
      earthSpin = new THREE.Group(); scene.add(earthSpin);
      earthSpin.add(new THREE.Mesh(new THREE.SphereGeometry(ER, 32, 16), new THREE.MeshLambertMaterial({ map: pixelEarthTexture() })));
      addLabel('Earth (×35)', new THREE.Vector3(0, ER + 2, 0), 2.2);
      const moonRing: THREE.Vector3[] = []; for (let i = 0; i <= 96; i++) { const th = (i / 96) * Math.PI * 2; moonRing.push(new THREE.Vector3(Math.cos(th) * 38.4, 0, Math.sin(th) * 38.4)); }
      mkPath(moonRing, 0x4b5583, true);
      const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff1a0 })); sunSprite.position.set(-900, 0, 0); sunSprite.scale.set(60, 60, 1); scene.add(sunSprite);
      addLabel('→ Sun (150 million km)', new THREE.Vector3(-210, 8, 0), 5, '#fde047');
      const lp = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0xf2c14e, wireframe: true })); lp.position.set(Lx, 0, 0); scene.add(lp);
      addLabel(fam, new THREE.Vector3(Lx, 6, 0), 3, '#f2c14e');
      const umbra = new THREE.Mesh(new THREE.ConeGeometry(ER, 138, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x000010, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
      umbra.rotation.z = Math.PI / 2; umbra.position.x = 69; scene.add(umbra);
      const halo = sampleHalo(fam === 'L2' ? 800000 : 700000, 400000, 160).map((p) => new THREE.Vector3(Lx + p[0] / 10000, p[1] / 10000, p[2] / 10000));
      mkPath(halo, 0xf2c14e);
      const transfer: THREE.Vector3[] = []; for (let i = 0; i <= 60; i++) { const s = i / 60; transfer.push(new THREE.Vector3(s * Lx, Math.sin(s * Math.PI) * 25, Math.sin(s * Math.PI * 0.9) * 30 + s * halo[0].z)); }
      mkPath(transfer, 0x9aa6d0, true);
      const dsnLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x4ade80 }));
      scene.add(dsnLine);
      const cruise = Math.max(1, orbit.cruiseYears * 365);
      posAt = (tt, phase, k) => {
        if (tt < cruise) { const s = Math.min(1, tt / cruise); const i = Math.floor(s * 60); return { p: transfer[i].clone(), v: transfer[Math.min(60, i + 1)].clone().sub(transfer[i]).normalize(), center: new THREE.Vector3() }; }
        const i = Math.floor(((phase * 0.25 + k / N) % 1) * 160);
        return { p: halo[i].clone(), v: halo[(i + 1) % 160].clone().sub(halo[i]).normalize(), center: new THREE.Vector3(Lx, 0, 0) };
      };
      extraUpdate = () => dsnLine.geometry.setFromPoints([new THREE.Vector3(), craft[0].position.clone()]);
      central = new THREE.Vector3(Lx, 0, 0);
      camera.position.set(Lx / 2, 110, 190); controls.target.set(Lx / 2, 0, 0);
    } else {
      // heliocentric: 1 unit = 0.1 AU
      scale = 0.1 * 1.496e8;
      sun.position.set(0, 0, 0);
      scene.remove(sun);
      const pl = new THREE.PointLight(0xfff2d0, 3, 0, 0); scene.add(pl);
      const sunM = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12), new THREE.MeshBasicMaterial({ color: 0xfde047 })); scene.add(sunM);
      addLabel('Sun', new THREE.Vector3(0, 2.6, 0), 1.6, '#fde047');
      const ring = (r: number, color: number) => { const p: THREE.Vector3[] = []; for (let i = 0; i <= 128; i++) { const th = (i / 128) * Math.PI * 2; p.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r)); } mkPath(p, color, true); };
      const planets: [string, number, number, number][] = [['Earth', 10, 0.45, 0x3b82f6], ['Mars', 15.24, 0.35, 0xef4444], ['Vesta', 23.6, 0.18, 0xbfa07a], ['Ceres', 27.7, 0.2, 0x9ca3af], ['Jupiter', 52.04, 1.3, 0xf59e0b]];
      const bodies: Record<string, THREE.Mesh> = {};
      for (const [name, r, rad, col] of planets) {
        ring(r, 0x2a3460);
        const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 8), new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.25 }));
        scene.add(m); bodies[name] = m;
        const l = addLabel(name, new THREE.Vector3(), 1.1); m.userData.label = l;
      }
      const TGT: Record<string, [string, number, number]> = { MARS: ['Mars', 15.24, 687], ASTEROID: ['Vesta', 23.6, 1325], JUPITER: ['Jupiter', 52.04, 4332] };
      const [tName, rT, perT] = TGT[fam] ?? TGT.JUPITER;
      const aT = (10 + rT) / 2, eT = (rT - 10) / (rT + 10);
      const transfer = sampleEllipse(aT, eT, 0, 0, 0, 200).slice(0, 101).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      mkPath(transfer, 0xf2c14e);
      const cruise = Math.max(1, orbit.cruiseYears * 365);
      const wT = (2 * Math.PI) / perT, wE = (2 * Math.PI) / 365.25;
      const arrive = Math.PI;
      const tStart = arrive - wT * cruise;
      posAt = (tt, phase, k) => {
        if (tt < cruise) {
          const M = Math.PI * (tt / cruise);
          const nu = trueAnomaly(M, eT);
          const p = keplerPoint(aT, eT, 0, 0, 0, nu), q = keplerPoint(aT, eT, 0, 0, 0, nu + 0.01);
          return { p: new THREE.Vector3(...p), v: new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize(), center: new THREE.Vector3() };
        }
        const jp = bodies[tName].position;
        const th = (phase + k / N) * Math.PI * 2;
        const rr = tName === 'Jupiter' ? 3.2 : 0.9;
        const p = jp.clone().add(new THREE.Vector3(Math.cos(th) * rr, Math.sin(th * 2) * rr * 0.12, Math.sin(th) * rr * 0.5));
        return { p, v: new THREE.Vector3(-Math.sin(th), 0, Math.cos(th)), center: jp.clone() };
      };
      extraUpdate = (tt) => {
        const set = (name: string, ang: number, r: number) => { const m = bodies[name]; m.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r); (m.userData.label as THREE.Object3D).position.copy(m.position).add(new THREE.Vector3(0, 1.4, 0)); };
        set('Earth', wE * tt, 10);
        for (const [nm, r0, per, ph] of [['Mars', 15.24, 687, 1], ['Vesta', 23.6, 1325, 2], ['Ceres', 27.7, 1682, 4], ['Jupiter', 52.04, 4332, 3]] as [string, number, number, number][]) set(nm, nm === tName ? tStart + wT * tt : (2 * Math.PI / per) * tt + ph, r0);
      };
      extraUpdate(0);
      camera.position.set(0, 70, 70);
    }
    const viz: Viz = { renderer, scene, camera, controls, stereo: stereoCam, mode, craft, central, earthSpin, stations, posAt: posAt!, shadowR, scale, extraUpdate };
    vizRef.current = viz;
    // WebXR
    let vrBtn: HTMLElement | null = null;
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
    if (xr) xr.isSessionSupported('immersive-vr').then((ok) => { if (ok && vrRef.current) { renderer.xr.enabled = true; vrBtn = VRButton.createButton(renderer); vrBtn.style.position = 'static'; vrRef.current.appendChild(vrBtn); setVrOk(true); } }).catch(() => undefined);
    // resize
    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setPixelRatio(live.current.pixel ? 0.45 : Math.min(2, window.devicePixelRatio));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(mount);
    // loop
    let last = performance.now(), phase = 0, lastHud = 0, lastLab = 0, lastPixel = live.current.pixel;
    const period = (posAt! as unknown as { period?: number }).period;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const L = live.current;
      if (L.pixel !== lastPixel) { lastPixel = L.pixel; resize(); }
      phase += dt / (mode === 'earth' ? (period && period > 40000 ? 24 : period && period > 20000 ? 14 : 8) : mode === 'helio' ? 10 : 9);
      if (earthSpin) earthSpin.rotation.y += dt * (mode === 'earth' && period ? (2 * Math.PI) / ((86164 / period) * 8) : 0.05);
      extraUpdate(L.t);
      craft.forEach((c, k) => {
        const s = viz.posAt(L.t, phase, k);
        c.position.copy(s.p);
        c.lookAt(s.p.clone().add(s.v));
        const camDist = camera.position.distanceTo(s.p);
        const sz = L.cam === 'chase' || L.cam === 'nadir' ? (mode === 'earth' ? 0.35 : 0.8) : Math.max(0.15, camDist * 0.028);
        c.scale.setScalar(sz);
      });
      // ground-station visibility (Earth scenes)
      let visible = 0;
      if (mode === 'earth') {
        const p = craft[0].position;
        for (const st of stations) {
          const wp = new THREE.Vector3(); st.pos.getWorldPosition(wp);
          const ang = wp.clone().normalize().angleTo(p.clone().normalize());
          const vis = ang <= st.lam;
          st.line.visible = vis;
          if (vis) { st.line.geometry.setFromPoints([wp, p.clone()]); visible++; }
          (st.cone.material as THREE.MeshBasicMaterial).opacity = vis ? 0.22 : 0.07;
        }
      }
      // cameras
      const s0 = viz.posAt(L.t, phase, 0);
      controls.enabled = L.cam === 'free';
      if (L.cam === 'chase') { const out = s0.p.clone().sub(s0.center).normalize(); camera.position.copy(s0.p.clone().sub(s0.v.clone().multiplyScalar(mode === 'earth' ? 1.4 : 3)).add(out.multiplyScalar(mode === 'earth' ? 0.45 : 1.2))); camera.lookAt(s0.p); }
      else if (L.cam === 'nadir') { const dir = s0.center.clone().sub(s0.p).normalize(); camera.position.copy(s0.p.clone().add(dir.clone().multiplyScalar(-0.6))); camera.up.set(s0.v.x, s0.v.y, s0.v.z); camera.lookAt(s0.center); camera.up.set(0, 1, 0); }
      else if (L.cam === 'ground') { const base = stations[0]?.pos; const wp = new THREE.Vector3(); if (base && mode === 'earth') base.getWorldPosition(wp); camera.position.copy(mode === 'earth' ? wp.clone().multiplyScalar(1.01) : new THREE.Vector3(0, 2.6, 0)); camera.lookAt(s0.p); }
      else if (L.cam === 'helio') { const far = mode === 'helio' ? 90 : mode === 'earth' ? 70 : mode === 'lunar' ? 70 : 240; const tg = controls.target; camera.position.set(tg.x + 0.001, far, tg.z); camera.lookAt(tg); }
      else controls.update();
      // HTML labels (crisp in pixel mode)
      if (now - lastLab > 60) {
        lastLab = now;
        const w = mount.clientWidth, h = mount.clientHeight;
        for (const lb of labels) {
          const wp = new THREE.Vector3(); lb.obj.getWorldPosition(wp);
          const v = wp.project(camera);
          const show = !L.stereo && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
          lb.el.style.display = show ? 'block' : 'none';
          if (show) { lb.el.style.left = `${((v.x + 1) / 2) * w}px`; lb.el.style.top = `${((1 - v.y) / 2) * h}px`; }
        }
      }
      // HUD
      if (now - lastHud > 250) {
        lastHud = now;
        const p = craft[0].position;
        const ecl = mode === 'earth' && p.x < 0 && Math.hypot(p.y, p.z) < shadowR;
        setHud({ eclipse: ecl, visible, rangeKm: p.length() * scale });
      }
      // render (mono / stereo)
      if (L.stereo && !renderer.xr.isPresenting) {
        camera.updateMatrixWorld();
        stereoCam.update(camera);
        const size = renderer.getSize(new THREE.Vector2());
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, size.x / 2, size.y); renderer.setViewport(0, 0, size.x / 2, size.y); renderer.render(scene, stereoCam.cameraL);
        renderer.setScissor(size.x / 2, 0, size.x / 2, size.y); renderer.setViewport(size.x / 2, 0, size.x / 2, size.y); renderer.render(scene, stereoCam.cameraR);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
      } else renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(loop);
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      vrBtn?.remove();
      for (const lb of labels) lb.el.remove();
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
      vizRef.current = null;
    };
  }, [d.orbit.id, d.orbit.altitudeKm, d.orbit.ltan, d.busId, d.fleetSize, d.groundNetworkId]); // eslint-disable-line react-hooks/exhaustive-deps

  // timeline playback when not following the live flight
  useEffect(() => {
    if (follow && room.sim) return;
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x >= totalDays ? 0 : Math.min(totalDays, x + totalDays / 240))), 250);
    return () => clearInterval(id);
  }, [follow, playing, room.sim, totalDays]);

  const phaseNow = [...conops].reverse().find((e) => e.day <= t);
  const nearEvt = simEvents.filter((e) => e.day <= t).slice(-1)[0];
  const x = (day: number) => `${(100 * Math.min(day, totalDays)) / Math.max(1, totalDays)}%`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {(['free', 'chase', 'nadir', 'ground', 'helio'] as CamMode[]).map((m) => (
          <button key={m} className={`px-btn sm ${cam === m ? 'gold' : 'ghost'}`} onClick={() => setCam(m)}>
            {{ free: '🖱 FREE', chase: '🛰 CHASE', nadir: '⬇ DOWN', ground: '📡 GROUND', helio: '☀ OVERVIEW' }[m]}
          </button>
        ))}
        <div className="flex-1" />
        <button className={`px-btn sm ${pixel ? 'gold' : 'ghost'}`} onClick={() => setPixel(!pixel)}>PIXEL {pixel ? 'ON' : 'OFF'}</button>
        <button className={`px-btn sm ${stereo ? 'gold' : 'ghost'}`} onClick={() => setStereo(!stereo)}>👓 STEREO</button>
        <div ref={vrRef} className="inline-flex" />
        {vrOk && <span className="text-[14px] text-ok">VR ready</span>}
      </div>
      <div className="relative w-full h-[min(56vh,460px)] border-2 border-black bg-[#03050f]">
        <div ref={mountRef} className="absolute inset-0" />
        <div ref={labelsRef} className="absolute inset-0 overflow-hidden pointer-events-none" />
        {glErr && <div className="absolute inset-0 flex items-center justify-center text-[19px] text-warn p-4 text-center">3D view unavailable on this device ({glErr}).</div>}
        <div className="absolute left-2 top-2 px-inset px-2 py-1 text-[16px] pointer-events-none">
          <div className="font-pixel text-[8px] text-gold">MISSION VIZ · DAY {n(t, 0)} / {n(totalDays, 0)}</div>
          <div>{phaseNow ? `${phaseNow.icon} ${phaseNow.label}` : '—'}</div>
          {orbit.central === 'earth' && <div style={{ color: hud.eclipse ? '#f87171' : '#fde047' }}>{hud.eclipse ? '● IN SHADOW (battery)' : '○ sunlit'} · {hud.visible ? `📡 ${hud.visible} in view` : 'no station'}</div>}
          {nearEvt && <div className="text-warn">⚠ d{nearEvt.day}: {nearEvt.label}</div>}
        </div>
      </div>
      <div className="mt-2">
        <div className="relative h-[34px] bg-black/60 border-2 border-black">
          <div className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: x(t) }} />
          {conops.map((e, i) => <div key={i} className="absolute top-0 text-[13px] -translate-x-1/2" style={{ left: x(e.day) }} title={`${e.label} · day ${n(e.day, 0)}`}>{e.icon}</div>)}
          {simEvents.map((e, i) => <div key={`s${i}`} className="absolute bottom-0 w-[3px] h-[12px]" style={{ left: x(e.day), background: e.sev === 'crit' ? '#f87171' : e.sev === 'warn' ? '#fbbf24' : '#4ade80' }} title={`d${e.day} ${e.label}`} />)}
        </div>
        <input type="range" className="px-range w-full" min={0} max={totalDays} step={Math.max(0.01, totalDays / 2000)} value={Math.min(t, totalDays)} onChange={(e) => { setFollow(false); setT(+e.target.value); }} aria-label="Mission timeline scrubber" />
        <div className="flex flex-wrap items-center gap-2 text-[16px]">
          <button className="px-btn sm" onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
          <button className="px-btn sm ghost" onClick={() => { setFollow(false); setT(0); }}>⏮ LAUNCH</button>
          {conops.slice(0, 8).map((e, i) => <button key={i} className="px-btn sm ghost" onClick={() => { setFollow(false); setT(e.day); }} title={e.label}>{e.icon}</button>)}
          {room.sim && <button className={`px-btn sm ${follow ? 'gold' : 'ghost'}`} onClick={() => setFollow(!follow)}>FOLLOW LIVE {follow ? 'ON' : 'OFF'}</button>}
          <span className="text-muted">Top: phases · bottom: flight events. Time is sped up.</span>
        </div>
      </div>
    </>
  );
}
