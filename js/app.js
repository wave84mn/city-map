// Gusinje city map on the AR cube.
// Camera -> marker tracking (from ar-cube) -> three.js: the town of Gusinje stands on the cube.
// Aim the centre ring at a landmark and hold still (or tap its dot / its name) and the building
// rises out of the map and grows until it fills the cube. Turn the cube upside down to go back.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Tracker, projectedBox } from './cv/tracker.js';
import { OneEuro, matToQuat, mulv } from './cv/pose.js';
import { t as tr, getLang, setLang, applyStatic, LANGS } from './i18n.js';

const VERSION = '0.6 · 30 Oct 2026';
const $ = s => document.querySelector(s);
const D2R = Math.PI / 180;
const params = new URLSearchParams(location.search);

// timings (seconds)
const GROW = 1.35, SHRINK = 1.1, DWELL = 1.4, COOLDOWN = 2.0, FLIP_WINDOW = 2.5;
const OPP = [5, 3, 4, 1, 2, 0];          // opposite face (top front right back left bottom)

// ---------------- settings (per-viewer convenience only) ----------------
const DEFAULTS = { plinth: 'stone', town: 2.0, hold: true, upright: true, shadows: true, debug: false, fov: 66, view: 'auto' };
const settings = Object.assign({}, DEFAULTS, readStore('citymap.settings') || {});
if (params.has('debug')) settings.debug = true;
if (params.has('fov')) settings.fov = +params.get('fov');
function readStore(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveSettings() { try { localStorage.setItem('citymap.settings', JSON.stringify(settings)); } catch { /* private mode */ } }

// ---------------- DOM ----------------
const video = $('#cam'), glCanvas = $('#gl'), dbgCanvas = $('#dbg');
const dbg = dbgCanvas.getContext('2d');
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
const disp = document.createElement('canvas');          // the exact frame that is tracked is the frame that is shown
const dctx = disp.getContext('2d', { alpha: false });
$('#ver').textContent = 'v' + VERSION;

// ---------------- three.js ----------------
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
camera.matrixAutoUpdate = false;
const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let videoTex = null;
const bgMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false });
const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
bgScene.add(bgMesh);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x6d655a, 0.6));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

const CV2GL = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
const anchors = { cube: new THREE.Group(), card: new THREE.Group() };
for (const a of Object.values(anchors)) { a.matrixAutoUpdate = false; a.visible = false; scene.add(a); }

// holder = the face the scene stands on (rolls between cube faces); yawGroup turns about it.
// yawGroup holds the town and the building, so they share one frame (+Y up, +Z = south, -Z = north).
const holder = new THREE.Group();
const yawGroup = new THREE.Group();
const townGroup = new THREE.Group();     // scaled town; slides down into the cube when a building is chosen
const bldGroup = new THREE.Group();      // the chosen building
holder.add(yawGroup); yawGroup.add(townGroup, bldGroup);
bldGroup.visible = false;

// the town disappears below the cube's top face as it sinks: clip everything under that plane
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let S = 70;                              // cube edge (mm), from layout
let plinth, shadowCatcher;

// ---------------- state ----------------
let layout, tracker, city = null, townRoot = null, townInfo = null;
const view = { W: 0, H: 0, vw: 0, vh: 0, s: 1, ox: 0, oy: 0 };
const T = {
  cube: { filtT: new OneEuro(3, 2.0, 0.3, 5.0), filtQ: new OneEuro(4, 2.0, 40, 5.0), raw: null, seen: -10, lostAt: -10, acquired: false, base: 0, q: null, prevQ: null },
  card: { filtT: new OneEuro(3, 2.0, 0.3, 5.0), filtQ: new OneEuro(4, 2.0, 40, 5.0), raw: null, seen: -10, lostAt: -10, acquired: false, base: 0, q: null, prevQ: null },
};
let active = null;                       // 'cube' | 'card' | null
const place = { Q: new THREE.Quaternion(), from: new THREE.Quaternion(), to: new THREE.Quaternion(), t0: 0, dur: 0.45,
  yaw: 0, yawFrom: 0, yawTo: 0, yt0: 0, needFace: true, appear: 0 };
let frameNo = 0, lastRes = null, fps = 0, procMs = 0, lastFrameT = 0;
let filmMode = false, filmSkipDraw = false; // showcase video (tools/film): frames and poses come from a script
const timing = { capture: 0, read: 0, track: 0, render: 0 };
const sensor = { ok: false, beta: 0, gamma: 0, t: 0 };

// town / building state machine: 'town' -> 'grow' -> 'building' -> 'shrink' -> 'town'
const city$ = {
  mode: 'town', anim: 0, sel: null, pending: null,
  townSince: 0,                          // when the town (re)appeared: no hold-to-choose right after
  target: null, dwellStart: 0, dwellP: 0,
  bldSince: 0, baseLog: [],              // for flip detection
  from: null, to: null,                  // grow path: { p, s, yaw }
  byaw: 0, byawFrom: 0, byawTo: 0, byt0: 0,
};
const now = () => performance.now() / 1000;

// ---------------- start ----------------
$('#go').addEventListener('click', start);
async function start() {
  const err = $('#err');
  err.style.display = 'none';
  const sensorP = enableSensors();          // must run inside the tap (iOS permission prompt)
  if (!navigator.mediaDevices?.getUserMedia) return fail(tr('errNoCam'));
  $('#go').disabled = true; $('#go').textContent = tr('starting');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    $('#go').disabled = false; $('#go').textContent = tr('start');
    const name = e && e.name;
    return fail(name === 'NotAllowedError' ? tr('errBlocked') : name === 'NotFoundError' ? tr('errNone') : tr('errOther', { m: (e && e.message) || e }));
  }
  await sensorP;
  videoTex = new THREE.CanvasTexture(disp);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.generateMipmaps = false; videoTex.minFilter = THREE.LinearFilter;
  bgMat.map = videoTex; bgMat.needsUpdate = true;
  $('#start').classList.add('hidden');
  for (const id of ['#hud', '#dock', '#hint']) $(id).hidden = false;
  keepAwake();
  resize();
  updateDock();
  runLoop();
  preloadBuildings();
}
function fail(msg) { const e = $('#err'); e.textContent = msg; e.style.display = 'block'; }

async function enableSensors() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
    window.addEventListener('deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      sensor.ok = true; sensor.beta = e.beta; sensor.gamma = e.gamma; sensor.t = performance.now();
    });
  } catch { /* no sensors: fall back to the screen-up guess */ }
}

let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && video.srcObject) keepAwake(); });

// world-up direction in OpenCV camera coordinates (x right, y down, z forward), from the tilt sensor
function upInCamera() {
  if (!sensor.ok || performance.now() - sensor.t > 1500) return null;
  const b = sensor.beta * D2R, g = sensor.gamma * D2R;
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b), uz = Math.cos(b) * Math.cos(g);
  const th = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * D2R;
  const sx = ux * Math.cos(th) - uy * Math.sin(th), sy = ux * Math.sin(th) + uy * Math.cos(th);
  return [sx, -sy, -uz];
}

// ---------------- platform: the QR codes add ?p=android or ?p=windows ----------------
const UA = navigator.userAgent || '';
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(UA) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(UA));
// real Chrome (incl. Chrome custom tabs), not an app's built-in browser (WebView "wv") or another browser
const inChrome = /Chrome\/\d/.test(UA) && !/; wv\)|SamsungBrowser|EdgA|OPR\/|Firefox|FxiOS|FBAN|FB_IAB|Instagram|MiuiBrowser|UCBrowser|YaBrowser|HuaweiBrowser|DuckDuckGo|GSA\//i.test(UA);
if (/Android/i.test(UA) && !inChrome) {
  // intent link: opens this page in Chrome; falls back to the normal link if Chrome is missing
  const here = location.href.split('#')[0];
  const intent = 'intent://' + here.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(here) + ';end';
  $('#openChrome').href = intent;
  $('#chromeBox').hidden = false;
}
if (params.get('p') === 'windows' || (!isMobile && params.get('p') !== 'android')) { const l = document.querySelector('#start .lead'); if (l) l.dataset.i18n = 'leadPc'; }

// ---------------- data ----------------
applyStatic();
for (const seg of document.querySelectorAll('.langseg')) seg.addEventListener('click', e => {
  const l = e.target.closest('button')?.dataset.lang; if (!LANGS.includes(l)) return;
  setLang(l); onLangChange();
});
function onLangChange() {
  if ($('#go') && !$('#go').disabled) $('#go').textContent = tr('start');
  buildChips(); buildPins(); updateDock(); updateInfo(); paintSettings(); updateStatusText(); ringState = '';
  $('#hintText').textContent = tr('pointCam');
}
$('#hintText').textContent = tr('pointCam');

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
init();
async function init() {
  try {
    const [lay, c] = await Promise.all([fetch('data/layout.json').then(r => r.json()), fetch('data/city.json').then(r => r.json())]);
    layout = lay; S = layout.edge; city = c;
    tracker = new Tracker(layout);
    buildPlinth();
    buildChips();
    const gltf = await loader.loadAsync(city.town.file);
    prepareTown(gltf.scene);
    buildPins();
  } catch (e) {
    console.error(e);
    fail(tr('errData', { m: e.message }));
  }
  bindSettingsUI();
}

// ---------------- plinth / shadow catcher ----------------
function noiseTexture(base, vary, size = 256, specks = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * vary;
    const sp = specks && Math.random() < specks ? -vary * 1.5 : 0;
    img.data[i * 4] = base[0] + n + sp; img.data[i * 4 + 1] = base[1] + n + sp; img.data[i * 4 + 2] = base[2] + n + sp; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.5; g.drawImage(c, 1, 0); g.drawImage(c, 0, 1); g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function buildPlinth() {
  const k = 1.025;   // a little larger than the real cube so its edges stay hidden
  const stone = new THREE.MeshStandardMaterial({ map: noiseTexture([214, 207, 194], 22, 256, 0.01), roughness: 0.88, metalness: 0 });
  plinth = new THREE.Mesh(new THREE.BoxGeometry(S * k, S * k, S * k), stone);
  plinth.receiveShadow = true;
  anchors.cube.add(plinth);
  shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.32 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  anchors.card.add(shadowCatcher);
  applyPlinthStyle();
}
function applyPlinthStyle() { if (plinth) plinth.visible = settings.plinth !== 'none'; }

// ---------------- town ----------------
const uTime = { value: 0 }, uTownInv = { value: new THREE.Matrix4() };
function makeTownMaterial() {
  // flat shading (the jigsaw model carries no normals); water is marked by vertex-colour alpha 128
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, flatShading: true,
    clippingPlanes: [clipPlane], clipShadows: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uTownInv = uTownInv;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uTownInv;\nvarying vec3 vTPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = (uTownInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vTPos;\nfloat waterFx = 0.0;')
      .replace('#include <color_fragment>', `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= vColor.rgb;
#endif
#if defined( USE_COLOR_ALPHA )
  waterFx = 1.0 - step(0.75, vColor.a);
#endif
  if (waterFx > 0.5) {
    float w = sin(vTPos.x * 0.33 + uTime * 1.5) * sin(vTPos.z * 0.41 - uTime * 1.1)
            + 0.55 * sin((vTPos.x + vTPos.z) * 0.71 + uTime * 2.2);
    diffuseColor.rgb *= 0.93 + 0.10 * w;
    diffuseColor.rgb += vec3(0.05, 0.07, 0.09) * smoothstep(0.7, 1.45, w);
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (waterFx > 0.5) roughnessFactor = 0.32;');
  };
  m.customProgramCacheKey = () => 'town-water-v1';
  return m;
}
function prepareTown(root) {
  const mat = makeTownMaterial();
  let tris = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = mat; o.castShadow = false; o.receiveShadow = false;
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  townInfo = { minY: box.min.y, maxY: box.max.y, width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z), tris: Math.round(tris) };
  probeLandmarks(root);
  // the jigsaw pieces have no undersides (never seen in the jigsaw game): close the map with a green base
  const [x0, z0, x1, z1] = city.town.inner || [box.min.x, box.min.z, box.max.x, box.max.z];
  const baseH = 1.6;
  const base = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.4, baseH, z1 - z0 + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2fa457, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, clippingPlanes: [clipPlane] }));
  base.position.set((x0 + x1) / 2, box.min.y + baseH / 2 + 0.02, (z0 + z1) / 2);
  base.name = 'town-base';
  root.add(base);
  townRoot = root;
  townGroup.add(root);
  applyTownSize();
}
// how tall each landmark stands on the map (so the detailed model starts at the same size)
function probeLandmarks(root) {
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
  const hitY = (x, z) => { rc.set(o.set(x, 400, z), down); const h = rc.intersectObject(root, true)[0]; return h ? h.point.y : null; };
  for (const L of city.landmarks) {
    const [x, , z] = L.pos;
    let top = -Infinity, ground = Infinity;
    for (const dx of [-1.2, 0, 1.2]) for (const dz of [-1.2, 0, 1.2]) { const y = hitY(x + dx, z + dz); if (y != null) top = Math.max(top, y); }
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, y = hitY(x + 7 * Math.cos(a), z + 7 * Math.sin(a)); if (y != null) ground = Math.min(ground, y); }
    if (!isFinite(top)) top = L.pos[1];
    if (!isFinite(ground)) ground = top - 4;
    L.top = top; L.ground = ground; L.hMap = Math.max(3, top - ground);
  }
}
function townScale() { return townInfo ? settings.town * S / townInfo.width : 1; }
function townBaseY() { return townInfo ? -townInfo.minY * townScale() + 0.05 : 0; }
function applyTownSize() {
  if (!townInfo) return;
  const k = townScale();
  townGroup.scale.setScalar(k);
  if (city$.mode === 'town') townGroup.position.y = townBaseY();
}

// ---------------- buildings (GKM1 models from Gusinjska kocka) ----------------
function parseGKM(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'GKM1') throw new Error('not a model file');
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  let off = 8 + hl;
  const take = (Ty, n, size) => { const a = new Ty(buf, off, n); off += Math.ceil((n * size) / 4) * 4; return a; };
  const qp = take(Uint16Array, head.nv * 3, 2), qu = take(Uint16Array, head.nv * 2, 2), qn = take(Int8Array, head.nv * 4, 1);
  const idx = head.idx32 ? take(Uint32Array, head.nf * 3, 4) : take(Uint16Array, head.nf * 3, 2);
  const lo = head.min, span = head.max.map((v, i) => v - lo[i]);
  const pos = new Float32Array(head.nv * 3), nor = new Float32Array(head.nv * 3), uv = new Float32Array(head.nv * 2);
  for (let i = 0; i < head.nv; i++) {
    for (let k = 0; k < 3; k++) { pos[3 * i + k] = lo[k] + (qp[3 * i + k] / 65535) * span[k]; nor[3 * i + k] = qn[4 * i + k] / 127; }
    uv[2 * i] = qu[2 * i] / 65535; uv[2 * i + 1] = qu[2 * i + 1] / 65535;
  }
  return { pos, nor, uv, idx, nf: head.nf, min: lo, max: head.max };
}
const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + src)); im.src = src; });
const bldCache = new Map();
function loadBuilding(id) {
  if (bldCache.has(id)) return bldCache.get(id);
  const p = (async () => {
    const [j, img] = await Promise.all([fetch(`models/${id}.json`).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), loadImage(`models/${id}.jpg`)]);
    const bin = Uint8Array.from(atob(j.data), c => c.charCodeAt(0)).buffer;
    const m = parseGKM(bin);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const tex = new THREE.Texture(img);
    tex.flipY = false;                   // the baked atlas is stored top row first
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, metalness: 0 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3());
    mesh.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);   // base centre at the origin
    const wrap = new THREE.Group(); wrap.add(mesh);
    wrap.userData = { foot: Math.max(sz.x, sz.z), height: sz.y, tris: m.nf };
    return wrap;
  })();
  bldCache.set(id, p);
  p.catch(() => bldCache.delete(id));
  return p;
}
function preloadBuildings() {
  if (!city) return;
  let i = 0;
  for (const L of city.landmarks) if (L.model) setTimeout(() => loadBuilding(L.model).catch(() => {}), 400 + 250 * i++);
}
// scale at which a building fills the cube's top face (tall towers are capped so they stay in view)
function fitScale(u) { return Math.min(0.92 * S / u.foot, 1.55 * S / u.height); }

// ---------------- choosing a building ----------------
const byId = id => city && city.landmarks.find(l => l.id === id);
const nameOf = L => (L.name && (L.name[getLang()] || L.name.me)) || L.id;

async function select(id) {
  const L = byId(id);
  if (!L || !townInfo) return;
  if (!L.model) { toast(nameOf(L) + ' · ' + tr('noModel')); return; }
  if (city$.mode === 'building' || city$.mode === 'grow') {
    if (city$.sel && city$.sel.id === id) return;
    city$.pending = id; goBack(); return;
  }
  if (city$.mode !== 'town') { city$.pending = id; return; }
  city$.mode = 'loading'; city$.sel = L;
  setRing(null, 0);
  let wrap;
  try { wrap = await loadBuilding(L.model); } catch (e) { city$.mode = 'town'; city$.sel = null; toast(tr('errModel', { m: e.message })); return; }
  if (city$.sel !== L) return;
  bldGroup.clear(); bldGroup.add(wrap);
  const u = wrap.userData, k = townScale();
  // town point (x, y, z) sits at (x k, townBaseY + y k, z k) in the yaw group
  const p0 = new THREE.Vector3(L.pos[0] * k, townBaseY() + L.ground * k, L.pos[2] * k);
  const s0 = (L.hMap * k) / u.height;
  const s1 = fitScale(u);
  city$.from = { p: p0, s: s0, yaw: 0 };
  city$.to = { p: new THREE.Vector3(0, 0.05, 0), s: s1, yaw: cameraYawIn(yawGroup) };
  city$.anim = 0; city$.mode = 'grow'; city$.animT0 = now();
  city$.bldSince = city$.animT0; city$.baseLog = [];
  bldGroup.visible = true;
  applyGrow(0);
  updateDock(); updateStatusText(); updateInfo();
}
function goBack() {
  if (city$.mode === 'building') {
    city$.from.yaw = 0;
    city$.to.yaw = city$.byaw;
    city$.mode = 'shrink'; city$.animT0 = now();
    updateDock(); updateStatusText();
  } else if (city$.mode === 'grow') {
    // reverse from where we are
    const a = clamp((now() - city$.animT0) / GROW, 0, 1);
    city$.mode = 'shrink'; city$.animT0 = now() - (1 - a) * SHRINK;
    updateDock(); updateStatusText();
  }
}
// yaw (about +Y of group g) that turns +Z towards the camera
function cameraYawIn(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const c = new THREE.Vector3(0, 0, 0).applyMatrix4(inv);
  return Math.atan2(c.x, c.z);
}
const easeIO = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const lerpAng = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
// a = 0: building small at its spot in the town, town in place; a = 1: building fills the cube, town sunk
function applyGrow(a) {
  const f = city$.from, to = city$.to, k = townScale();
  const sink = easeIO((a - 0.08) / 0.72);
  const depth = (townInfo.maxY - townInfo.minY) * k + 2;
  townGroup.position.y = townBaseY() - sink * depth;
  townGroup.visible = sink < 0.999;
  const g = easeIO((a - 0.1) / 0.9);
  const rise = easeIO(a / 0.25) * (1 - g);                       // first lifts off the map a little
  bldGroup.position.lerpVectors(f.p, to.p, g);
  bldGroup.position.y += Math.sin(Math.PI * g) * 0.32 * S + rise * 4 * k;
  bldGroup.scale.setScalar(f.s * Math.pow(to.s / f.s, g));
  bldGroup.rotation.y = lerpAng(f.yaw, to.yaw, g);
}
function stepCity(tNow) {
  if (city$.mode === 'grow') {
    const a = clamp((tNow - city$.animT0) / GROW, 0, 1);
    applyGrow(a);
    if (a >= 1) {
      city$.mode = 'building';
      city$.byaw = city$.byawFrom = city$.byawTo = city$.to.yaw; city$.byt0 = tNow - 10;
      updateDock(); updateStatusText();
      if (city$.pending) { const p = city$.pending; city$.pending = null; if (p !== city$.sel.id) select(p); }
    }
  } else if (city$.mode === 'shrink') {
    const a = 1 - clamp((tNow - city$.animT0) / SHRINK, 0, 1);
    applyGrow(a);
    if (a <= 0) {
      city$.blocked = city$.sel && city$.sel.id;
      city$.mode = 'town'; bldGroup.visible = false; city$.sel = null;
      townGroup.position.y = townBaseY(); townGroup.visible = true;
      city$.townSince = tNow; city$.target = null; city$.dwellP = 0;
      updateDock(); updateStatusText();
      if (city$.pending) { const p = city$.pending; city$.pending = null; select(p); }
    }
  } else if (city$.mode === 'building') {
    const ky = easeIO((tNow - city$.byt0) / 0.5);
    city$.byaw = city$.byawFrom + (city$.byawTo - city$.byawFrom) * ky;
    bldGroup.rotation.y = city$.byaw;
    bldGroup.position.copy(city$.to.p); bldGroup.scale.setScalar(city$.to.s);
  }
}
function setBldYaw(y) {
  const tn = now();
  let d = y - city$.byaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  city$.byawFrom = city$.byaw; city$.byawTo = city$.byaw + d; city$.byt0 = tn;
}

// ---------------- pins (landmark dots) and the aiming ring ----------------
const pinEls = new Map();
function buildPins() {
  const box = $('#pins'); box.innerHTML = ''; pinEls.clear();
  if (!city) return;
  for (const L of city.landmarks) {
    const b = document.createElement('button');
    b.className = 'pin' + (L.model ? ' m' : ''); b.hidden = true;
    b.setAttribute('aria-label', nameOf(L));
    b.append(document.createElement('i'));
    b.addEventListener('click', ev => { const n = nearestPin(ev.clientX, ev.clientY); select((n || L).id); });
    box.append(b); pinEls.set(L.id, b);
  }
}
// dots can overlap in the dense centre: a tap goes to the nearest one, and dots with a building win close calls
const pinXY = new Map();
function nearestPin(x, y) {
  if (!city || (!x && !y)) return null;
  let best = null, bs = Infinity;
  for (const L of city.landmarks) {
    const p = pinXY.get(L.id), el = pinEls.get(L.id);
    if (!p || el.hidden) continue;
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d > 30) continue;
    const score = d - (L.model ? 12 : 0);
    if (score < bs) { bs = score; best = L; }
  }
  return best;
}
const pv = new THREE.Vector3(), upv = new THREE.Vector3();
function updatePins(tNow) {
  const show = active && city$.mode === 'town' && townRoot;
  const W = glCanvas.clientWidth, H = glCanvas.clientHeight;
  let best = null, bestD = Infinity;
  if (show) {
    townRoot.updateMatrixWorld(true);
    // hide the dots when looking at the town from below
    upv.set(0, 1, 0).applyQuaternion(holder.getWorldQuaternion(tmpQ));
    const hp = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld);
    const fromBelow = upv.dot(hp) > -0.05 * hp.length();
    const cx = W / 2, cy = H / 2, R = Math.max(64, 0.17 * Math.min(W, H));
    for (const L of city.landmarks) {
      const el = pinEls.get(L.id);
      pv.set(L.pos[0], L.pos[1] + 1.5, L.pos[2]).applyMatrix4(townRoot.matrixWorld);
      const behind = pv.z > -1;
      pv.project(camera);
      const x = (pv.x + 1) / 2 * W, y = (1 - pv.y) / 2 * H;
      const vis = !fromBelow && !behind && x > -20 && x < W + 20 && y > -20 && y < H + 20;
      el.hidden = !vis;
      if (!vis) continue;
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      pinXY.set(L.id, [x, y]);
      const d = Math.hypot(x - cx, y - cy);
      if (d < R && d < bestD) { bestD = d; best = L; }
    }
  } else for (const el of pinEls.values()) el.hidden = true;
  for (const [id, el] of pinEls) el.classList.toggle('on', !!best && best.id === id);
  // dwell: hold the ring on a building with a model
  const ringR = 46;
  if (!show) { city$.target = null; setRing(null, 0); return; }
  if (!best) { city$.target = null; city$.dwellP = 0; setRing(null, 0); return; }
  if (!city$.target || city$.target.id !== best.id) { city$.target = best; city$.dwellStart = tNow; city$.lastXY = null; }
  // the building you just came back from can't be chosen again until the ring has left it
  if (city$.blocked && best.id !== city$.blocked) city$.blocked = null;
  // the hold only counts while the cube is steady (the dot hardly moves on screen)
  const xy = pinXY.get(best.id);
  let steady = true;
  if (xy) {
    if (city$.lastXY && tNow > city$.lastT) steady = Math.hypot(xy[0] - city$.lastXY[0], xy[1] - city$.lastXY[1]) / (tNow - city$.lastT) < 140;
    city$.lastXY = xy; city$.lastT = tNow;
  }
  const inside = bestD < ringR;
  const canHold = settings.hold && best.model && inside && steady && best.id !== city$.blocked && tNow - city$.townSince > COOLDOWN;
  if (!canHold) city$.dwellStart = tNow;
  city$.dwellP = canHold ? clamp((tNow - city$.dwellStart) / DWELL, 0, 1) : 0;
  setRing(best, city$.dwellP);
  if (city$.dwellP >= 1) { city$.dwellP = 0; select(best.id); }
}
let ringState = '';
function setRing(L, p) {
  const ring = $('#ring');
  const show = active && city$.mode === 'town';
  ring.hidden = !show;
  if (!show) return;
  ring.classList.toggle('on', !!L);
  $('#ringProg').style.strokeDashoffset = String(100 - 100 * p);
  const key = (L ? L.id : '') + '|' + getLang() + '|' + (p > 0 ? 1 : 0);
  if (key === ringState) return;
  ringState = key;
  $('#ringName').textContent = L ? nameOf(L) : '';
  $('#ringSub').textContent = !L ? '' : !L.model ? tr('noModel') : p > 0 ? tr('holdStill') : (settings.hold ? '' : '');
}

// ---------------- dock, chips, info ----------------
function buildChips() {
  const nav = $('#chips'); nav.innerHTML = '';
  if (!city) return;
  const list = city.landmarks.filter(l => l.model).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), getLang() === 'sq' ? 'sq' : 'sr-Latn'));
  for (const L of list) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.id = L.id;
    const th = document.createElement('span'); th.className = 'th';
    const tx = document.createElement('span'); const bb = document.createElement('b'); bb.textContent = nameOf(L); tx.append(bb);
    b.append(th, tx);
    b.addEventListener('click', () => select(L.id));
    nav.append(b);
  }
  markChips();
}
function markChips() {
  for (const b of document.querySelectorAll('#chips .chip')) b.setAttribute('aria-pressed', String(!!city$.sel && city$.sel.id === b.dataset.id && city$.mode !== 'shrink'));
}
function updateDock() {
  const inB = city$.mode === 'building' || city$.mode === 'grow';
  $('#bldActions').hidden = !inB;
  const hint = city$.mode === 'building' ? (settings.upright && sensor.ok ? tr('flipHint') : '') : city$.mode === 'town' && active ? tr('townHint') : '';
  $('#dockHint').textContent = hint;
  markChips();
}
function updateStatusText() {
  const txt = $('#statusText');
  if (!active) { txt.textContent = townRoot ? tr('looking') : tr('loadingTown'); return; }
  const L = city$.sel;
  txt.textContent = (L && city$.mode !== 'town' ? nameOf(L) + ' · ' + L.piece : tr('town')) + (active === 'card' ? ' · ▭' : '');
}
function updateInfo() {
  const L = city$.sel;
  if (!L) return;
  $('#infoTitle').textContent = nameOf(L);
  $('#infoDesc').textContent = tr('storySoon');
  const kv = $('#infoKv'); kv.innerHTML = '';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; kv.append(dt, dd); };
  const others = LANGS.filter(l => l !== getLang()).map(l => L.name[l]).filter((v, i, a) => v && a.indexOf(v) === i && v !== nameOf(L));
  if (others.length) add(tr('otherNames'), others.join(' · '));
  add(tr('piece'), L.piece);
}

// ---------------- layout / projection ----------------
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 300));
video.addEventListener('resize', resize);
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, filmMode ? 4 : 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(glCanvas.clientWidth || window.innerWidth, glCanvas.clientHeight || window.innerHeight, false);
  dbgCanvas.width = glCanvas.width; dbgCanvas.height = glCanvas.height;
  updateProjection();
}
function intrinsics() {
  const vw = video.videoWidth, vh = video.videoHeight, L = Math.max(vw, vh);
  const f = (L / 2) / Math.tan(settings.fov * D2R / 2);
  return { fx: f, fy: f, cx: vw / 2, cy: vh / 2 };
}
function updateProjection() {
  const W = glCanvas.width, H = glCanvas.height, vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !W || !H) return;
  // 'fill' crops the camera image to fill the screen; 'fit' shows the whole image (dark bars).
  // 'auto' fills unless that would crop away more than ~20 % of the image in one direction.
  const sFill = Math.max(W / vw, H / vh), sFit = Math.min(W / vw, H / vh);
  const mode = settings.view === 'auto' ? (sFill / sFit > 1.25 ? 'fit' : 'fill') : settings.view;
  const s = mode === 'fit' ? sFit : sFill;
  view.mode = mode;
  const ox = (vw - W / s) / 2, oy = (vh - H / s) / 2;
  Object.assign(view, { W, H, vw, vh, s, ox, oy });
  const K = intrinsics();
  const fx = K.fx * s, fy = K.fy * s, cx = (K.cx - ox) * s, cy = (K.cy - oy) * s;
  const n = 5, f = 20000;
  camera.projectionMatrix.set(2 * fx / W, 0, 1 - 2 * cx / W, 0, 0, 2 * fy / H, 2 * cy / H - 1, 0, 0, 0, -(f + n) / (f - n), -2 * f * n / (f - n), 0, 0, -1, 0);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  bgMesh.scale.set(vw * s / W, vh * s / H, 1);
}

// ---------------- main loop ----------------
function runLoop() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const cb = n => { try { onFrame(n); } catch (e) { console.error(e); } video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  } else {
    let last = -1;
    const raf = n => { if (video.currentTime !== last) { last = video.currentTime; try { onFrame(n); } catch (e) { console.error(e); } } requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
}

let PROC = 640;                      // processing size (long side), adapted to the phone's speed
function chooseRegion(K, t) {
  const vw = video.videoWidth, vh = video.videoHeight, L = Math.max(vw, vh);
  for (const key of ['cube', 'card']) {
    const st = T[key];
    if (!st.raw || t - st.seen > Math.max(0.25, 2.5 / Math.max(fps, 1)) || !tracker) continue;
    const tg = tracker.targets[key];
    const b = projectedBox(tg, st.raw, K);
    if (!b) continue;
    const pad = 0.35 * Math.max(b.x1 - b.x0, b.y1 - b.y0) + 24;
    const x0 = Math.max(0, Math.floor(b.x0 - pad)), y0 = Math.max(0, Math.floor(b.y0 - pad));
    const x1 = Math.min(vw, Math.ceil(b.x1 + pad)), y1 = Math.min(vh, Math.ceil(b.y1 + pad));
    if (x1 - x0 < 32 || y1 - y0 < 32) continue;
    const cellNative = tg.cell * K.fx / Math.max(50, st.raw.t[2]);
    const scale = Math.min(1, PROC / Math.max(x1 - x0, y1 - y0), 10 / cellNative);
    return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0, scale, radius: clamp(Math.round(cellNative * scale), 2, 7), mode: key };
  }
  if (frameNo % 2 === 0) {
    const scale = PROC / L;
    return { sx: 0, sy: 0, sw: vw, sh: vh, scale, radius: [2, 3, 5][(frameNo >> 1) % 3], mode: 'search' };
  }
  const cw = Math.round(vw / 2), ch = Math.round(vh / 2);
  const scale = Math.min(1, PROC / Math.max(cw, ch));
  return { sx: Math.round((vw - cw) / 2), sy: Math.round((vh - ch) / 2), sw: cw, sh: ch, scale, radius: [3, 5][(frameNo >> 1) % 2], mode: 'centre' };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let region = null;
function onFrame(nowMs) {
  frameNo++;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !tracker) return render(nowMs / 1000);
  if (vw !== view.vw || vh !== view.vh) updateProjection();
  const t = nowMs / 1000;
  if (lastFrameT) fps = fps * 0.9 + 0.1 / Math.max(1e-3, t - lastFrameT);
  lastFrameT = t;
  const K = intrinsics();
  region = chooseRegion(K, t);
  const w = Math.max(16, Math.round(region.sw * region.scale)), h = Math.max(16, Math.round(region.sh * region.scale));
  if (proc.width !== w || proc.height !== h) { proc.width = w; proc.height = h; }
  const p0 = performance.now();
  if (disp.width !== vw || disp.height !== vh) { disp.width = vw; disp.height = vh; }
  dctx.drawImage(video, 0, 0, vw, vh);
  const p1 = performance.now();
  pctx.drawImage(disp, region.sx, region.sy, region.sw, region.sh, 0, 0, w, h);
  const img = pctx.getImageData(0, 0, w, h);
  const p2 = performance.now();
  const res = tracker.process(img.data, w, h, { x0: region.sx, y0: region.sy, scale: w / region.sw }, K, t, { radius: region.radius });
  const p3 = performance.now();
  procMs = procMs * 0.85 + 0.15 * (p3 - p0);
  timing.capture = timing.capture * 0.85 + 0.15 * (p1 - p0);
  timing.read = timing.read * 0.85 + 0.15 * (p2 - p1);
  timing.track = timing.track * 0.85 + 0.15 * (p3 - p2);
  const cvMs = timing.read + timing.track;
  if (frameNo % 15 === 0) {
    if (cvMs > 30 && PROC > 400) PROC = Math.round(PROC * 0.85);
    else if (cvMs < 14 && PROC < 640) PROC = Math.min(640, Math.round(PROC * 1.1));
  }
  lastRes = res;
  handleResult(res, t);
  if (videoTex) videoTex.needsUpdate = true;   // draw exactly the frame that was tracked
  const r0 = performance.now();
  render(t);
  timing.render = timing.render * 0.85 + 0.15 * (performance.now() - r0);
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion();
// Judge the fit by its error relative to how big the markers look. A real cube, especially the folded paper
// one, is a millimetre or two off the ideal shape; held close to the camera that is 10-15 px, which an
// absolute pixel limit wrongly treats as a lost cube. Wrong poses are far worse than this (or ambiguous).
const REL_MAX = 0.12, REL_MAX_ONE = 0.03, HOLD = 0.5;
function markerSide(m) { let s = 0; for (let k = 0; k < 4; k++) { const a = m.corners[k], b = m.corners[(k + 1) % 4]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s / 4; }
function acceptPose(p, markers) {
  if (p.ambiguous) return false;
  const used = markers.filter(m => p.ids.includes(m.id));
  if (!used.length) return false;
  const side = used.reduce((a, m) => a + markerSide(m), 0) / used.length;
  p.rel = p.rms / Math.max(side, 1);
  return p.n >= 2 ? (p.rel < REL_MAX || p.rms < 6) : (p.rel < REL_MAX_ONE || p.rms < 3.5);
}
function handleResult(res, t) {
  for (const key of ['cube', 'card']) {
    const st = T[key], p = res.poses[key];
    const good = p && acceptPose(p, res.markers);
    if (good) {
      if (t - st.seen > 0.6) { st.filtT.reset(); st.filtQ.reset(); st.prevQ = null; st.acquired = true; }
      st.raw = p; st.seen = t;
      let q = matToQuat(p.R);
      if (st.prevQ && q[0] * st.prevQ[0] + q[1] * st.prevQ[1] + q[2] * st.prevQ[2] + q[3] * st.prevQ[3] < 0) q = q.map(x => -x);
      st.prevQ = q;
      const qf = st.filtQ.filter(q, t), tf = st.filtT.filter(p.t, t);
      const nq = Math.hypot(...qf);
      st.q = qf.map(x => x / nq); st.t = tf;
    }
  }
  const visible = k => T[k].raw && t - T[k].seen < Math.max(HOLD, 2.5 / Math.max(fps, 1));
  const next = visible('cube') ? 'cube' : visible('card') ? 'card' : null;
  if (next !== active) switchTarget(next, t);
  for (const key of ['cube', 'card']) {
    const st = T[key], a = anchors[key];
    a.visible = key === active;
    if (key !== active || !st.q) continue;
    tmpQ.set(st.q[0], st.q[1], st.q[2], st.q[3]);
    tmpM.makeRotationFromQuaternion(tmpQ).setPosition(st.t[0], st.t[1], st.t[2]);
    a.matrix.multiplyMatrices(CV2GL, tmpM);
    a.matrixWorldNeedsUpdate = true;
  }
  if (active === 'cube') updateBase(T.cube, t);
  if (active && place.needFace && townRoot) { faceCamera(false); place.needFace = false; }
  updateStatus(t);
}

function switchTarget(next, t) {
  const prev = active;
  active = next;
  if (next) {
    anchors[next].add(holder);
    applyPlinthStyle();
    if (next === 'card') { place.Q.identity(); place.from.identity(); place.to.identity(); place.dur = 0; }
    else if (prev !== 'cube' || t - T.cube.lostAt > 1.5) chooseInitialBase(T.cube);
    if (t - (T[next].lostAt || -10) > 1.5) {
      place.needFace = true; place.appear = 0;
      if (city$.mode === 'town') city$.townSince = now();
    }
  } else if (prev) {
    T[prev].lostAt = t;
  }
  updateDock(); updateStatusText();
}

// ---------------- which cube face is "up" ----------------
const faceN = () => layout.faces.map(f => f.N);
function chooseInitialBase(st) {
  if (!st.raw) return;
  const R = st.raw.R, up = settings.upright ? upInCamera() : null;
  let best = 0, bs = -9;
  faceN().forEach((N, i) => {
    const n = mulv(R, N);
    const sc = up ? n[0] * up[0] + n[1] * up[1] + n[2] * up[2] : (n[2] < 0.15 ? -n[1] : -9);
    if (sc > bs) { bs = sc; best = i; }
  });
  st.base = best;
  const q = quatYto(layout.faces[best].N);
  place.Q.copy(q); place.from.copy(q); place.to.copy(q); place.dur = 0;
}
function updateBase(st, t) {
  if (!settings.upright || !st.raw) return;
  const up = upInCamera();
  if (!up) return;
  const R = st.raw.R;
  const sc = faceN().map(N => { const n = mulv(R, N); return n[0] * up[0] + n[1] * up[1] + n[2] * up[2]; });
  let best = 0;
  for (let i = 1; i < 6; i++) if (sc[i] > sc[best]) best = i;
  if (best !== st.base && sc[best] > sc[st.base] + 0.3) {
    const a = new THREE.Vector3(...layout.faces[st.base].N), b = new THREE.Vector3(...layout.faces[best].N);
    const roll = new THREE.Quaternion().setFromUnitVectors(a, b);
    place.from.copy(place.Q);
    place.to.premultiply(roll);
    place.t0 = t; place.dur = 0.45;
    onBaseChange(st.base, best, t);
    st.base = best;
  }
}
// turning the cube upside down while a building is shown takes you back to the town
function onBaseChange(from, to, t) {
  if (city$.mode !== 'building' && city$.mode !== 'grow') return;
  const tn = now();
  city$.baseLog.push({ b: from, left: tn });
  if (city$.baseLog.length > 4) city$.baseLog.shift();
  const flip = city$.baseLog.some(e => e.b === OPP[to] && tn - e.left < FLIP_WINDOW && e.left >= city$.bldSince);
  if (flip) { city$.baseLog = []; goBack(); }
}
function quatYto(N) { return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...N)); }

// turn the town about its base so its south edge (+Z) points at the camera
function faceCamera(animate) {
  const key = active;
  if (!key || !T[key].raw) return;
  const p = T[key].raw;
  const R = p.R, t = p.t;
  const cam = new THREE.Vector3(-(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]), -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]), -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]));
  cam.applyQuaternion(place.to.clone().invert());
  setYaw(Math.atan2(cam.x, cam.z), animate);
}
function setYaw(y, animate) {
  const tn = now();
  let d = y - place.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  place.yawFrom = place.yaw; place.yawTo = place.yaw + d; place.yt0 = animate ? tn : tn - 10;
}

// ---------------- render ----------------
const ease = x => x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3);
const sunV = new THREE.Vector3(), upW = new THREE.Vector3();
function render(t = now()) {
  const tn = now();
  uTime.value = tn;
  if (place.dur > 0) {
    const k = ease((t - place.t0) / place.dur);
    place.Q.slerpQuaternions(place.from, place.to, k);
    if (k >= 1) { place.from.copy(place.to); place.dur = 0; }
  } else place.Q.copy(place.to);
  const ky = ease((tn - place.yt0) / 0.5);
  place.yaw = place.yawFrom + (place.yawTo - place.yawFrom) * ky;
  holder.quaternion.copy(place.Q);
  const off = active === 'card' ? 0.3 : S / 2 * (plinth && plinth.visible ? 1.025 : 1) + 0.2;
  holder.position.set(0, off, 0).applyQuaternion(place.Q);
  yawGroup.rotation.y = place.yaw;
  place.appear = Math.min(1, place.appear + 0.12);
  yawGroup.scale.setScalar(0.85 + 0.15 * ease(place.appear));
  stepCity(tn);
  if (active) {
    anchors[active].updateMatrixWorld(true);       // from the anchor: on the first tracked frame its new pose isn't applied yet
    // clip plane = the face the town stands on
    const hp = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld);
    upW.set(0, 1, 0).applyQuaternion(holder.getWorldQuaternion(tmpQ)).normalize();
    // plane a little under the town's base (the stone block's top is 0.2 mm lower still)
    clipPlane.setFromNormalAndCoplanarPoint(upW, hp.clone().addScaledVector(upW, -0.12));
    if (townRoot) uTownInv.value.copy(townRoot.matrixWorld).invert();
    // light from above, slightly from the camera side
    const toCam = hp.clone().negate().normalize();
    sunV.copy(hp).addScaledVector(upW, 600).addScaledVector(toCam, 300).add(new THREE.Vector3(-180, 0, 0));
    sun.position.copy(sunV); sun.target.position.copy(hp);
    sun.castShadow = settings.shadows && city$.mode !== 'town';   // shadows only under a building
    const r = city$.mode === 'building' ? 1.6 * S : 0.8 * settings.town * S + 20;
    const sc = sun.shadow.camera;
    if (sc.right !== r) { sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 2000; sc.updateProjectionMatrix(); }
  }
  if (filmSkipDraw) scene.updateMatrixWorld();     // showcase video, off-camera frames: keep the clock, skip the drawing
  else {
    renderer.clear();
    if (videoTex) renderer.render(bgScene, bgCam);
    renderer.render(scene, camera);
  }
  updatePins(tn);
  drawDebug();
}

// ---------------- status + debug ----------------
let hintTimer = 0, lastActive = null;
function updateStatus(t) {
  const pill = $('#status'), hint = $('#hint');
  if (active) { pill.classList.add('ok'); hint.classList.add('off'); hintTimer = t; }
  else { pill.classList.remove('ok'); if (t - hintTimer > 1.2) hint.classList.remove('off'); }
  if (active !== lastActive) { lastActive = active; updateStatusText(); }
}
function drawDebug() {
  const W = dbgCanvas.width, H = dbgCanvas.height;
  dbg.clearRect(0, 0, W, H);
  if (!settings.debug || !lastRes) return;
  const s = view.s, ox = view.ox, oy = view.oy, map = p => [(p[0] - ox) * s, (p[1] - oy) * s];
  const dpr = window.devicePixelRatio || 1;
  dbg.lineWidth = 2 * dpr;
  dbg.font = `${12 * dpr}px ui-monospace, monospace`;
  for (const m of lastRes.markers) {
    const c = m.corners.map(map);
    dbg.strokeStyle = m.refined ? '#6fcf97' : '#f2c94c';
    dbg.beginPath(); dbg.moveTo(c[0][0], c[0][1]); for (let i = 1; i < 4; i++) dbg.lineTo(c[i][0], c[i][1]); dbg.closePath(); dbg.stroke();
    dbg.fillStyle = '#fff'; dbg.fillText(String(m.id), (c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2);
  }
  const p = active && T[active].raw;
  const lines = [
    `fps ${fps.toFixed(0)}  track ${procMs.toFixed(1)} ms  draw ${timing.render.toFixed(1)} ms  ${region ? region.mode : ''}`,
    `video ${view.vw}x${view.vh} ${view.mode || ''}  proc ${PROC}  fov ${settings.fov}°  markers ${lastRes.markers.length}`,
    p ? `${active}: n ${p.n}  rms ${p.rms.toFixed(2)} px  z ${p.t[2].toFixed(0)} mm  base ${T.cube.base}` : 'no pose',
    `mode ${city$.mode}  tilt sensor ${sensor.ok ? 'on' : 'off'}  town ${townInfo ? townInfo.tris.toLocaleString('en') : '-'} tris`,
  ];
  const lh = 16 * dpr, y0 = 64 * dpr + lh;
  dbg.fillStyle = 'rgba(0,0,0,0.55)'; dbg.fillRect(8, y0 - lh, Math.min(W - 16, 440 * dpr), lh * (lines.length + 0.6));
  dbg.fillStyle = '#fff';
  lines.forEach((l, i) => dbg.fillText(l, 16, y0 + i * lh));
}

// ---------------- UI ----------------
function openSheet(id) {
  for (const s of document.querySelectorAll('.sheet')) s.classList.toggle('open', s.id === id);
  $('#scrim').classList.toggle('open', !!id);
}
$('#scrim').addEventListener('click', () => openSheet(null));
$('#btnSettings').addEventListener('click', () => openSheet('sheetSettings'));
$('#btnHelp').addEventListener('click', () => openSheet('sheetHelp'));
$('#btnInfo').addEventListener('click', () => { updateInfo(); openSheet('sheetInfo'); });
$('#btnBack').addEventListener('click', () => goBack());
$('#btnTurn').addEventListener('click', () => { if (city$.mode === 'building') setBldYaw(city$.byawTo + Math.PI / 2); });
$('#btnFace').addEventListener('click', () => { if (city$.mode === 'building') setBldYaw(cameraYawIn(yawGroup)); });
function paintSettings() {
  const seg = $('#segPlinth'), segV = $('#segView');
  for (const b of segV.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === settings.view));
  for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === settings.plinth));
  $('#rngTown').value = settings.town; $('#townVal').textContent = (+settings.town).toFixed(1) + '×';
  $('#chkHold').checked = settings.hold; $('#chkUpright').checked = settings.upright; $('#chkShadow').checked = settings.shadows; $('#chkDebug').checked = settings.debug;
  $('#rngFov').value = settings.fov; $('#fovVal').textContent = settings.fov + '°';
}
function bindSettingsUI() {
  $('#segView').addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (!v) return; settings.view = v; saveSettings(); updateProjection(); paintSettings(); });
  $('#segPlinth').addEventListener('click', e => { const v = e.target.closest('button')?.dataset.v; if (!v) return; settings.plinth = v; saveSettings(); applyPlinthStyle(); paintSettings(); });
  $('#rngTown').addEventListener('input', e => { settings.town = +e.target.value; saveSettings(); applyTownSize(); paintSettings(); });
  $('#chkHold').addEventListener('change', e => { settings.hold = e.target.checked; saveSettings(); });
  $('#chkUpright').addEventListener('change', e => { settings.upright = e.target.checked; saveSettings(); updateDock(); });
  $('#chkShadow').addEventListener('change', e => { settings.shadows = e.target.checked; saveSettings(); });
  $('#chkDebug').addEventListener('change', e => { settings.debug = e.target.checked; saveSettings(); });
  $('#rngFov').addEventListener('input', e => { settings.fov = +e.target.value; saveSettings(); updateProjection(); paintSettings(); });
  paintSettings();
}
let toastT = 0;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }

// expose a little for automated tests
window.__city = {
  T, place, settings, view, timing, city$, sensor,
  get active() { return active; }, get lastRes() { return lastRes; }, get fps() { return fps; }, get procMs() { return procMs; },
  get townInfo() { return townInfo; }, get landmarks() { return city && city.landmarks; }, get townRoot() { return townRoot; },
  select, goBack, setLang: l => { setLang(l); onLangChange(); },
  // tools: height of the map and the jigsaw piece at (x, z) in map millimetres
  probe(x, z) {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
    townRoot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(townRoot.matrixWorld);
    rc.ray.applyMatrix4(inv);
    const h = rc.intersectObject(townRoot, true)[0];
    if (!h) return null;
    const p = h.point.clone().applyMatrix4(inv.clone().invert());
    let o = h.object; while (o && !/^[A-H][1-8]$/.test(o.name) && o.parent) o = o.parent;
    return { y: +p.y.toFixed(2), piece: o && /^[A-H][1-8]$/.test(o.name) ? o.name : (h.object.name || '?') };
  },
  // tests: show the grow animation frozen at a (0 = on the map, 1 = fills the cube)
  async freeze(id, a) {
    const L = byId(id), wrap = await loadBuilding(L.model);
    if (!city$.from || city$.sel !== L) {
      bldGroup.clear(); bldGroup.add(wrap); city$.sel = L;
      const k = townScale(), u = wrap.userData;
      city$.from = { p: new THREE.Vector3(L.pos[0] * k, townBaseY() + L.ground * k, L.pos[2] * k), s: (L.hMap * k) / u.height, yaw: 0 };
      city$.to = { p: new THREE.Vector3(0, 0.05, 0), s: fitScale(u), yaw: cameraYawIn(yawGroup) };
    }
    city$.mode = 'frozen'; bldGroup.visible = true; applyGrow(a);
  },
  pins: () => [...pinEls].map(([id, el]) => ({ id, hidden: el.hidden, on: el.classList.contains('on'), tf: el.style.transform })),
  // showcase video (tools/film): run without a camera. Each frame gets a picture (any canvas) and, when the
  // cube is in view, its pose (R row-major 3x3, t in mm, OpenCV camera axes); the rest is the normal app.
  film: {
    async start(w, h) {
      filmMode = true;
      for (const [k, v] of [['videoWidth', w], ['videoHeight', h]]) Object.defineProperty(video, k, { configurable: true, get: () => v });
      disp.width = w; disp.height = h;
      videoTex = new THREE.CanvasTexture(disp);
      videoTex.colorSpace = THREE.SRGBColorSpace;
      videoTex.generateMipmaps = false; videoTex.minFilter = THREE.LinearFilter;
      bgMat.map = videoTex; bgMat.needsUpdate = true;
      $('#start').classList.add('hidden');
      for (const id of ['#hud', '#dock', '#hint']) $(id).hidden = false;
      resize(); updateDock();
      await Promise.all(city.landmarks.filter(l => l.model).map(l => loadBuilding(l.model)));
    },
    frame(src, pose, t, draw = true) {
      frameNo++; fps = 30; lastFrameT = t;
      if (draw) dctx.drawImage(src, 0, 0, disp.width, disp.height);
      if (pose) {
        const st = T.cube;
        let q = matToQuat(pose.R);
        if (st.prevQ && q[0] * st.prevQ[0] + q[1] * st.prevQ[1] + q[2] * st.prevQ[2] + q[3] * st.prevQ[3] < 0) q = q.map(x => -x);
        const n = Math.hypot(...q);
        st.prevQ = q; st.q = q.map(x => x / n); st.t = pose.t.slice();
        st.raw = { R: pose.R, t: pose.t, n: 12, rms: 0, ids: [] }; st.seen = t;
      }
      handleResult({ poses: {}, markers: [] }, t);
      videoTex.needsUpdate = draw;
      filmSkipDraw = !draw;
      render(t);
      filmSkipDraw = false;
    },
  },
};
