// Showcase video director: runs inside the app page (added by film.cjs).
// Draws the "real world" (a wooden table with the printed AR cube) as the camera picture, moves the camera
// and the cube along a script, hands the cube's pose to the app (window.__city.film) and lays captions on top.
// Time is virtual: film.cjs calls step() once per video frame (30 fps) and takes a screenshot.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const app = window.__city;
const FPS = 30, DT = 1 / FPS;
const VW = 1080, VH = 1920, FOV = 66;              // the "phone camera": portrait, same FOV as the app's default
const OPT = Object.assign({ worldScale: 0.5, worldAA: false, shadow: 1024 }, window.__filmOpts || {});
const WW = Math.round(VW * OPT.worldScale), WH = Math.round(VH * OPT.worldScale);   // the camera picture is drawn smaller (a phone camera image is soft anyway)
const S = 70;
const D2R = Math.PI / 180;
const $ = s => document.querySelector(s);

// ---------------- helpers ----------------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeIO = x => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
// fade in over [a, a+fi], out over [b-fo, b]
const fade = (t, a, b, fi = 0.35, fo = 0.3) => Math.min(smooth((t - a) / fi), smooth((b - t) / fo));

// ---------------- the world: table + printed cube ----------------
const canvas = document.createElement('canvas');
canvas.width = WW; canvas.height = WH;
const R3 = new THREE.WebGLRenderer({ canvas, antialias: OPT.worldAA, preserveDrawingBuffer: true });
R3.setPixelRatio(1); R3.setSize(WW, WH, false);
R3.outputColorSpace = THREE.SRGBColorSpace;
R3.toneMapping = THREE.NeutralToneMapping;
R3.shadowMap.enabled = true; R3.shadowMap.type = THREE.PCFSoftShadowMap;
const world = new THREE.Scene();
const ROOM = 0x2b2622;
world.background = new THREE.Color(ROOM);
world.fog = new THREE.Fog(ROOM, 650, 2300);
world.environment = new THREE.PMREMGenerator(R3).fromScene(new RoomEnvironment(), 0.04).texture;
world.environmentIntensity = 0.35;
world.add(new THREE.HemisphereLight(0xfff3e3, 0x4d3f33, 0.95));
const sun = new THREE.DirectionalLight(0xfff0da, 2.1);
sun.position.set(-260, 560, 240); sun.castShadow = true;
sun.shadow.mapSize.set(OPT.shadow, OPT.shadow);
Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 50, far: 1600 });
sun.shadow.radius = 6; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
world.add(sun, sun.target);

// value noise for the wood
function makeNoise(seed) {
  const p = new Uint8Array(512); let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const v = new Float32Array(256); for (let i = 0; i < 256; i++) { v[i] = rnd(); p[i] = i; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const f = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v[p[(p[xi & 255] + yi) & 511] & 255], b = v[p[(p[(xi + 1) & 255] + yi) & 511] & 255];
    const c = v[p[(p[xi & 255] + yi + 1) & 511] & 255], d = v[p[(p[(xi + 1) & 255] + yi + 1) & 511] & 255];
    return lerp(lerp(a, b, f(xf)), lerp(c, d, f(xf)), f(yf));
  };
}
function woodTexture() {
  // light oak planks running along X: long gently waving grain lines, fine fibres, a seam between planks
  const W = 2048, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), n1 = makeNoise(7), n2 = makeNoise(19), n3 = makeNoise(31);
  const plank = 256;                                // px per plank (texture covers 900 mm: ~112 mm planks)
  for (let y = 0; y < H; y++) {
    const pi = Math.floor(y / plank), py = y % plank;
    const tone = 0.92 + 0.14 * n2(pi * 3.7, 0.5);
    for (let x = 0; x < W; x++) {
      const xs = x + pi * 733;
      const warp = 26 * n1(xs * 0.0012, pi * 1.3) + 6 * n1(xs * 0.006, y * 0.01);
      const band = (py + warp) * 0.11 + 3 * n3(xs * 0.0007, pi);
      const f = band - Math.floor(band);
      const line = 1 - 0.16 * Math.exp(-f * 9) - 0.05 * Math.exp(-(1 - f) * 14);     // thin darker latewood lines
      const fibre = 0.97 + 0.05 * n1(xs * 0.03, y * 0.8) + 0.02 * n2(xs * 0.2, y * 1.7);
      let k = tone * line * fibre;
      if (py < 2) k *= 0.62; else if (py < 4) k *= 0.88;   // seam between planks
      const i = (y * W + x) * 4;
      img.data[i] = 186 * k; img.data[i + 1] = 142 * k; img.data[i + 2] = 101 * k; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.repeat.set(4, 4);
  return t;
}
const table = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.62, metalness: 0 }));
table.rotation.x = -Math.PI / 2; table.receiveShadow = true;
world.add(table);

// the printed cube: white body, black ArUco squares from the layout (same markers the app tracks)
function faceTexture(layout, fi) {
  const f = layout.faces[fi], px = 1024, k = px / S;
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, px, px);
  const O = f.N.map(v => v * S / 2);
  const uv = P => { const d = P.map((v, i) => v - O[i]); const u = d[0] * f.U[0] + d[1] * f.U[1] + d[2] * f.U[2], w = d[0] * f.V[0] + d[1] * f.V[1] + d[2] * f.V[2]; return [(u + S / 2) * k, (S / 2 - w) * k]; };
  g.fillStyle = '#16171a';
  for (const m of layout.markers.filter(m => m.face === fi)) {
    const [c0, c1, , c3] = m.corners.map(uv), n = m.cells.length;
    const at = (r, cc) => [c0[0] + (c1[0] - c0[0]) * cc / n + (c3[0] - c0[0]) * r / n, c0[1] + (c1[1] - c0[1]) * cc / n + (c3[1] - c0[1]) * r / n];
    for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) {
      if (!m.cells[r][cc]) continue;
      const a = at(r, cc), b = at(r, cc + 1), d = at(r + 1, cc + 1), e = at(r + 1, cc);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]); g.lineTo(e[0], e[1]); g.closePath();
      g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#16171a'; g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const cube = new THREE.Group();
cube.matrixAutoUpdate = false;
world.add(cube);
async function buildCube() {
  const layout = await fetch('data/layout.json').then(r => r.json());
  const body = new THREE.Mesh(new RoundedBoxGeometry(S, S, S, 4, 2.5), new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.5 }));
  body.castShadow = true; body.receiveShadow = true;
  cube.add(body);
  layout.faces.forEach((f, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S - 3.2, S - 3.2), new THREE.MeshStandardMaterial({ map: faceTexture(layout, i), roughness: 0.45 }));
    // the texture is drawn for the full 70 mm face: crop it to the flat part inside the rounded edges
    const cut = 1.6 / S; m.geometry.attributes.uv.array.forEach((v, j, a) => { a[j] = cut + v * (1 - 2 * cut); });
    const U = new THREE.Vector3(...f.U), V = new THREE.Vector3(...f.V), N = new THREE.Vector3(...f.N);
    m.matrix.makeBasis(U, V, N).setPosition(N.clone().multiplyScalar(S / 2 + 0.05));
    m.matrixAutoUpdate = false; m.receiveShadow = true;
    cube.add(m);
  });
}

// ---------------- camera rig ----------------
const cam = new THREE.PerspectiveCamera(FOV, VW / VH, 5, 6000);
// spherical position around a target (mm, degrees; az 0 = from the south side, +Z)
const rig = { az: -28, el: 38, dist: 330, tx: 0, ty: 30, tz: 0, roll: 0, shake: 1 };
let T = 10;                                         // virtual time (s)
function placeCamera() {
  const a = rig.az * D2R, e = rig.el * D2R;
  const tgt = new THREE.Vector3(rig.tx, rig.ty, rig.tz);
  cam.position.set(tgt.x + rig.dist * Math.cos(e) * Math.sin(a), tgt.y + rig.dist * Math.sin(e), tgt.z + rig.dist * Math.cos(e) * Math.cos(a));
  cam.up.set(0, 1, 0); cam.lookAt(tgt);
  // a hand-held phone: slow small wobble
  const k = rig.shake;
  cam.rotateY(k * D2R * (0.22 * Math.sin(T * 1.13) + 0.12 * Math.sin(T * 2.71 + 1)));
  cam.rotateX(k * D2R * (0.2 * Math.sin(T * 0.93 + 2) + 0.1 * Math.sin(T * 2.3)));
  cam.rotateZ(D2R * rig.roll + k * D2R * 0.35 * Math.sin(T * 0.7 + 0.5));
  cam.updateMatrixWorld(true);
}
const rigKeys = ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'roll'];
// move the rig from where it is now to `to` over [t0, t0+dur] (local time), eased
function mover(to, t0, dur, ease = easeIO) {
  let from = null;
  return lt => {
    if (lt < t0) return;
    if (!from) from = Object.fromEntries(rigKeys.map(k => [k, rig[k]]));
    const k = ease((lt - t0) / dur);
    for (const key of rigKeys) if (key in to) rig[key] = lerp(from[key], to[key], k);
  };
}

// cube on the table: centre at y = S/2; the flip lifts and turns it
const cubeState = { lift: 0, axis: new THREE.Vector3(1, 0, 0), ang: 0 };
function placeCube() {
  const q = new THREE.Quaternion().setFromAxisAngle(cubeState.axis, cubeState.ang);
  cube.matrix.compose(new THREE.Vector3(0, S / 2 + cubeState.lift, 0), q, new THREE.Vector3(1, 1, 1));
  cube.matrixWorldNeedsUpdate = true;
  cube.updateMatrixWorld(true);
}

// the cube's pose as the app's tracker would report it: cube -> OpenCV camera (x right, y down, z forward)
const CV = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
function pose() {
  const M = new THREE.Matrix4().copy(cam.matrixWorld).invert().multiply(cube.matrixWorld).premultiply(CV);
  const e = M.elements;
  return { R: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], t: [e[12], e[13], e[14]] };
}
// tilt sensor reading for the phone (inverse of the app's upInCamera)
function feedSensor() {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()).invert());
  const cv = [up.x, -up.y, -up.z];
  app.sensor.ok = true;
  app.sensor.beta = Math.asin(clamp(-cv[1], -1, 1)) / D2R;
  app.sensor.gamma = Math.atan2(-cv[0], -cv[2]) / D2R;
  app.sensor.t = performance.now();
}
// a landmark's dot (as the app places it) in world coordinates
function pinWorld(id) {
  const L = app.landmarks.find(l => l.id === id), tr = app.townRoot;
  tr.updateMatrixWorld(true);
  let a = tr; while (a.parent && !a.parent.isScene) a = a.parent;       // the app's cube anchor
  const p = new THREE.Vector3(L.pos[0], L.pos[1] + 1.5, L.pos[2]).applyMatrix4(tr.matrixWorld);
  p.applyMatrix4(new THREE.Matrix4().copy(a.matrixWorld).invert());     // -> cube frame
  return p.applyMatrix4(cube.matrixWorld);                               // -> world
}
// rig values that look straight at a world point from (az, el, dist)
const aimAt = (p, az, el, dist) => ({ tx: p.x, ty: p.y, tz: p.z, az, el, dist });

// ---------------- overlay: captions, title, outro, taps ----------------
const ov = document.createElement('div');
ov.id = 'fx';
ov.innerHTML = `
  <div id="fx-title"><div class="shade"></div><div class="box">
    <img class="logo" src="img/xplore-prokletije-dark.png" alt="">
    <h1>Mapa Gusinja</h1><p>Gusinje na AR kocki</p></div></div>
  <div id="fx-cap"><div class="line"></div></div>
  <div id="fx-tap"></div>
  <div id="fx-outro"><div class="box">
    <img class="logo" src="img/xplore-prokletije-dark.png" alt="">
    <h2>Mapa Gusinja</h2>
    <div class="qr"><img src="tools/film/qr.png" alt=""></div>
    <p class="cta">Skeniraj i isprobaj</p>
    <p class="url">wave84mn.github.io/city-map</p>
    <p class="note">Treba ti samo kocka: odštampaj je<br>ili je složi od papira.</p>
  </div></div>`;
document.body.append(ov);
const capEl = $('#fx-cap .line');
let capText = null;
// caption: html, alpha (0..1)
function caption(html, a) {
  if (html !== capText) { capEl.innerHTML = html || ''; capText = html; }
  capEl.style.opacity = a.toFixed(3);
  capEl.style.transform = `translateY(${((1 - a) * 10).toFixed(1)}px)`;
  capEl.parentNode.style.display = html && a > 0.001 ? '' : 'none';
}
// several captions on a segment's own clock: [[text, from, to], ...]
function captions(lt, list) {
  for (const [txt, a, b] of list) if (lt >= a && lt <= b) return caption(txt, fade(lt, a, b));
  caption(null, 0);
}
// app interface visibility (hidden under the title)
const uiEls = ['#hud', '#dock', '#hint', '#ring', '#pins'].map(s => $(s));
function uiAlpha(a) { for (const el of uiEls) el.style.filter = a >= 0.999 ? '' : `opacity(${a.toFixed(3)})`; }
// a finger tap on an element: ring that grows and fades
function tapFx(el, lt, t0) {
  const tap = $('#fx-tap');
  const k = (lt - t0) / 0.55;
  if (!el || k < 0 || k > 1) { tap.style.opacity = '0'; return; }
  const r = el.getBoundingClientRect();
  tap.style.left = (r.left + Math.min(r.width / 2, 70)) + 'px'; tap.style.top = (r.top + r.height / 2) + 'px';
  tap.style.opacity = (k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75).toFixed(3);
  tap.style.transform = `scale(${(0.6 + 0.7 * easeOut(k)).toFixed(3)})`;
}
function titleFx(lt, alpha) {
  const t = $('#fx-title');
  t.style.display = alpha > 0.001 ? '' : 'none';
  t.style.opacity = alpha.toFixed(3);
  const parts = [['.logo', 0.15], ['h1', 0.55], ['p', 0.85]];
  for (const [s, a0] of parts) {
    const k = easeOut((lt - a0) / 0.7), el = t.querySelector(s);
    el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 18).toFixed(1)}px)`;
  }
}
function outroFx(lt) {
  const o = $('#fx-outro');
  const a = smooth(lt / 0.5);
  o.style.display = a > 0.001 ? '' : 'none';
  o.style.opacity = a.toFixed(3);
  const parts = [['.logo', 0.2], ['h2', 0.4], ['.qr', 0.6], ['.cta', 0.95], ['.url', 1.1], ['.note', 1.3]];
  for (const [s, a0] of parts) {
    const k = easeOut((lt - a0) / 0.6), el = o.querySelector(s);
    el.style.opacity = k.toFixed(3); el.style.transform = `translateY(${((1 - k) * 16).toFixed(1)}px)` + (s === '.qr' ? ` scale(${(0.94 + 0.06 * k).toFixed(3)})` : '');
  }
}
const langCap = active => ['Crnogorski', 'Shqip', 'English'].map((l, i) => `<span class="${i === active ? 'on' : ''}">${l}</span>`).join('<i>·</i>');
const chip = id => [...document.querySelectorAll('#chips .chip')].find(c => c.dataset.id === id);

// ---------------- the script ----------------
// Each segment: dur (s), capture (false = run but don't film), enter(), update(lt).
let seen = {};                                      // per-segment memory
const segments = [
  { name: 'A-title', dur: 3.2, enter() {
      Object.assign(rig, { az: -30, el: 37, dist: 310, tx: 0, ty: 100, tz: 0 });
      uiAlpha(0);
      app.settings.hold = false;                    // no choosing while the camera just looks around
    }, update(lt) {
      const m = span(lt, 0, 3.2 + 6.5);             // the camera move runs on through the next segment
      rig.az = lerp(-30, 20, easeIO(m)); rig.el = lerp(37, 43, easeIO(m)); rig.dist = lerp(310, 280, easeIO(m)); rig.ty = lerp(100, 48, easeIO(m));
      titleFx(lt, Math.min(smooth(lt / 0.25), smooth((3.2 - lt) / 0.45)));
      caption(null, 0);
      return { pose: false };
    } },
  { name: 'B-town', dur: 6.5, update(lt) {
      const m = span(lt + 3.2, 0, 3.2 + 6.5);
      rig.az = lerp(-30, 20, easeIO(m)); rig.el = lerp(37, 43, easeIO(m)); rig.dist = lerp(310, 280, easeIO(m)); rig.ty = lerp(100, 48, easeIO(m));
      titleFx(0, 0);
      uiAlpha(smooth(lt / 0.4));
      captions(lt, [['Usmjeri telefon na kocku…', 0.1, 2.3], ['…i na njoj se pojavi Gusinje', 2.5, 6.4]]);
      return { pose: lt >= 0.9 };
    } },
  { name: 'C-choose', dur: 6.9, enter() {
      seen.C = { grow: null };
      app.settings.hold = true;
      const p = pinWorld('sahat');
      seen.C.aim = mover(aimAt(p, rig.az - 8, 50, 215), 0, 1.7);
      seen.C.p = p;
    }, update(lt) {
      const c = seen.C, mode = app.city$.mode;
      if (c.grow == null && mode !== 'town') { c.grow = lt; c.frame = mover({ tx: 0, ty: 92, tz: 0, el: 27, dist: 360, az: rig.az + 6 }, lt + 0.15, 1.9); }
      if (c.grow == null) c.aim(lt);
      else c.frame(lt);
      if (c.grow == null && lt > 4.2) app.select('sahat');            // safety net: the hold should have chosen it
      const g = c.grow ?? 99;
      captions(lt, [['Nanišani zgradu i drži mirno', 0.15, g + 0.15], ['…i ona izraste u cijelu kocku', g + 0.35, 6.8]]);
      if (c.grow != null && lt > c.grow + 2.1) rig.az += 2.2 * DT;     // slow drift around it
      return { pose: true };
    } },
  { name: 'D1-list', dur: 4.0, enter() { seen.D1 = { orbit: mover({ az: rig.az + 12, el: 25, dist: 300, ty: 74 }, 0, 4.0, smooth) }; },
    update(lt) {
      seen.D1.orbit(lt);
      const el = chip('crkva');
      tapFx(el, lt, 0.45);
      if (!seen.D1.tapped && lt >= 0.6) { seen.D1.tapped = true; el.click(); }
      captions(lt, [['…ili je izaberi sa spiska', 0.15, 3.85]]);
      return { pose: true };
    } },
  // quick cuts: choose the next building off camera, then film it
  { name: 'D2-pre', dur: 2.7, capture: false, enter() { app.select('kula'); Object.assign(rig, { az: -42, el: 24, dist: 340, tx: 0, ty: 86, tz: 0 }); caption(null, 0); },
    update() { return { pose: true }; } },
  { name: 'D2-kula', dur: 1.6, update(lt) { rig.az = -42 + 9 * lt; captions(lt, [['Osam zgrada iz srca Gusinja', 0.05, 99]]); return { pose: true }; } },
  { name: 'D3-pre', dur: 2.7, capture: false, enter() { app.select('opstina'); Object.assign(rig, { az: 38, el: 30, dist: 330, tx: 0, ty: 78, tz: 0 }); },
    update() { return { pose: true }; } },
  { name: 'D3-opstina', dur: 1.6, update(lt) { rig.az = 38 - 9 * lt; captions(lt, [['Osam zgrada iz srca Gusinja', -1, 1.45]]); return { pose: true }; } },
  { name: 'E-pre', dur: 2.7, capture: false, enter() { app.select('vezirova'); Object.assign(rig, { az: 12, el: 26, dist: 420, tx: 0, ty: 100, tz: 0 }); caption(null, 0); },
    update() { return { pose: true }; } },
  { name: 'E-flip', dur: 5.4, enter() {
      seen.E = {};
      app.settings.hold = false;                    // after the flip: just the town, nothing gets chosen
      // turn about the camera's horizontal right axis, so the top tips towards the phone
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize();
      cubeState.axis.copy(right);
    }, update(lt) {
      rig.az = 12 + 1.5 * lt;
      cubeState.lift = 58 * (smooth(span(lt, 0.9, 1.35)) - smooth(span(lt, 2.15, 2.55)));
      cubeState.ang = Math.PI * easeIO(span(lt, 1.15, 2.25));
      if (seen.E.back == null && app.city$.mode === 'shrink') seen.E.back = lt;
      if (seen.E.back != null && !seen.E.mv) seen.E.mv = mover({ ty: 56, el: 40, dist: 300 }, seen.E.back + 0.2, 1.6);
      if (seen.E.mv) seen.E.mv(lt);
      const b = Math.max(seen.E.back ?? 2.4, 2.4);
      captions(lt, [['Okreni kocku naopako…', 0.15, b], ['…i opet si u gradu', b + 0.2, 5.3]]);
      return { pose: true };
    } },
  { name: 'F-lang', dur: 3.6, enter() {
      app.settings.hold = false;                    // just show the names, don't choose
      seen.F = { aim: mover(aimAt(pinWorld('sahat'), rig.az, 47, 235), 0, 0.9) };
    }, update(lt) {
      seen.F.aim(lt);
      const li = lt < 1.2 ? 0 : lt < 2.4 ? 1 : 2;
      if (seen.F.li !== li) { seen.F.li = li; app.setLang(['me', 'sq', 'en'][li]); }
      captions(lt, [[langCap(li), 0.1, 99]]);
      return { pose: true };
    } },
  { name: 'G-outro', dur: 4.6, update(lt) {
      captions(lt, [[langCap(2), -1, 0.3]]);
      outroFx(lt);
      return { pose: true, still: lt > 0.6 };      // the outro covers the app: no need to draw it any more
    } },
];

// ---------------- CSS transitions on the virtual clock ----------------
const animT = new WeakMap();
function stepAnimations() {
  for (const a of document.getAnimations()) {
    if (!animT.has(a)) { animT.set(a, 0); a.pause(); } else animT.set(a, animT.get(a) + DT * 1000);
    try { a.currentTime = animT.get(a); } catch { /* ignore */ }
  }
}

let cur = -1, segT = 0;
const film = {
  segments: segments.map(s => ({ name: s.name, frames: Math.round(s.dur * FPS), capture: s.capture !== false })),
  async init() {
    await buildCube();
    performance.__setVT(T * 1000);
    await app.film.start(WW, WH);
    $('#fx-outro').style.display = 'none';
    caption(null, 0); uiAlpha(0);
    placeCube(); placeCamera(); R3.render(world, cam);
    await Promise.all([...document.images].map(im => im.decode().catch(() => {})));
    return true;
  },
  // one video frame of segment si, local frame i
  step(si, i, want = true) {
    if (si !== cur) { cur = si; segT = 0; segments[si].enter?.(); }
    const seg = segments[si];
    const lt = i * DT;
    T += DT; performance.__setVT(T * 1000);
    const r = seg.update(lt) || {};
    placeCube(); placeCamera();
    const w0 = Date.now();
    const draw = seg.capture !== false && want && !r.still;   // off-camera parts only need the app's clock, not pictures
    if (draw) R3.render(world, cam);
    const w1 = Date.now();
    feedSensor();
    app.film.frame(canvas, r.pose ? pose() : null, T, draw);
    stepAnimations();
    return { active: app.active, mode: app.city$.mode, sel: app.city$.sel && app.city$.sel.id, dwell: +app.city$.dwellP.toFixed(2), ms: [w1 - w0, Date.now() - w1] };
  },
  pinWorld, rig, cubeState,
};
window.__film = film;
