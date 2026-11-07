// The moment a building is chosen, and its name sign.
//
// GroundFx: the map sinks into the stone block, the block's top cracks open with blue light from below, and the
// building pushes up out of the floor, throwing stone chips (some tumble off the block's edges) and a ring of dust,
// and lands with a little thud and a shock ring. The building's material gets a glowing band where it comes out of
// the floor and a glowing cut face (so the cut never looks hollow).
//
// NamePlaque: an enamel street sign with the building's name, hung on two rings from the side of the block that
// faces you. It drops down and clacks against the stone; when you walk round the cube it swings up and drops again
// on the side you now face. On the flat card it hangs from a little frame instead.
//
// Both live in `holder`: the cube's top face, +Y up, origin on the face, axes square to the block.
import * as THREE from './vendor/three/three.module.min.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sat = x => clamp(x, 0, 1);
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = x => 1 - Math.pow(1 - sat(x), 3);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export const GLOW = new THREE.Color(0.42, 0.70, 1.0);
// grow timeline (fractions of the grow time): the map sinks, cracks, the building rises, lands
export const RISE = { sink0: 0.04, sink1: 0.34, crack0: 0.2, crack1: 0.44, rise0: 0.34, rise1: 0.84, burst: 0.36, land: 0.84 };

// ---------------- cracks: R = dark crack (wide), G = glowing core (thin) ----------------
function crackTexture(size = 1024, seed = 11) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), R = rng(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const lines = [];
  const walk = (x, y, ang, len, w, depth) => {
    const pts = [[x, y]], step = size * 0.016;
    while (len > 0) {
      ang += (R() - 0.5) * 0.85;
      x += Math.cos(ang) * step; y += Math.sin(ang) * step; len -= step;
      pts.push([x, y]);
      if (x < -20 || y < -20 || x > size + 20 || y > size + 20) break;
      if (depth < 2 && R() < 0.11) walk(x, y, ang + (R() < 0.5 ? -1 : 1) * (0.45 + R() * 0.6), len * (0.3 + R() * 0.35), w * 0.62, depth + 1);
    }
    lines.push({ pts, w });
  };
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = ((i + R() * 0.7) / n) * Math.PI * 2, r0 = size * (0.03 + R() * 0.07);
    walk(size / 2 + Math.cos(a) * r0, size / 2 + Math.sin(a) * r0, a, size * (0.34 + R() * 0.2), size * 0.0105, 0);
  }
  g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (pts, w, col) => {
    g.strokeStyle = col;
    for (let i = 1; i < pts.length; i++) {
      g.lineWidth = Math.max(1, w * (1 - 0.75 * i / pts.length));
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
  };
  for (const l of lines) stroke(l.pts, l.w * 2.3, 'rgb(255,0,0)');
  for (const l of lines) stroke(l.pts, l.w * 0.75, 'rgb(0,255,0)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}

// a stone chip: an icosahedron with its corners pushed about (the same corner always moves the same way)
function chipGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0), p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    const k = 0.6 + 0.55 * (h - Math.floor(h));
    p.setXYZ(i, v.x * k, v.y * k * 0.75, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class GroundFx {
  constructor(holder, S, clipPlane, growSeconds) {
    this.S = S; this.grow = growSeconds; this.clipPlane = clipPlane;
    this.floorY = -0.2; this.edge = S * 0.5125; this.card = false;
    // shared with the building's material
    this.u = { uRise: { value: 0 }, uGlow: { value: GLOW.clone() }, uBand: { value: 3.2 } };
    this.group = new THREE.Group(); this.group.visible = false; holder.add(this.group);

    // the floor: cracks, the light pool under the building and the landing shock ring, in one plane
    this.floorU = {
      uMap: { value: crackTexture() }, uReveal: { value: 0 }, uFade: { value: 0 }, uPool: { value: 0 },
      uShockR: { value: 0 }, uShockA: { value: 0 }, uTime: { value: 0 }, uGlow: { value: GLOW.clone() },
    };
    const floorMat = new THREE.ShaderMaterial({
      uniforms: this.floorU, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
uniform sampler2D uMap; uniform float uReveal, uFade, uPool, uShockR, uShockA, uTime; uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;                                  // 0 in the middle, 1 at the middle of an edge
  vec4 t = texture2D(uMap, vUv);
  float halo = 0.55 * texture2D(uMap, vUv, 3.0).g + 0.6 * texture2D(uMap, vUv, 5.0).g;
  float on = (1.0 - smoothstep(uReveal - 0.12, uReveal, r)) * uFade;
  float flick = 0.82 + 0.18 * sin(uTime * 19.0 + r * 31.0) * sin(uTime * 7.3 - r * 13.0);
  float edge = 1.0 - smoothstep(0.93, 1.0, max(abs(q.x), abs(q.y)) * 2.0);
  float a = t.r * on * 0.85 * edge;                           // the dark crack darkens the stone...
  vec3 light = uGlow * (t.g * 1.7 * flick + halo * 0.9 * flick) * on + vec3(0.45) * t.g * on * flick;
  light += uGlow * uPool * 0.55 * (1.0 - smoothstep(0.0, 0.85, r));
  light += uGlow * uShockA * exp(-pow((r - uShockR) / 0.05, 2.0));
  gl_FragColor = vec4(vec3(0.05, 0.04, 0.035) * a + light * edge, a);   // ...and the light adds on top
}`,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
    this.floor.rotation.x = -Math.PI / 2; this.floor.renderOrder = 5;
    this.group.add(this.floor);

    // stone chips
    const R = rng(5);
    this.chips = Array.from({ length: 34 }, () => ({
      a: R() * Math.PI * 2, r0: S * (0.36 + R() * 0.13), vh: 30 + R() * 55, vy: 75 + R() * 85, size: 0.6 + R() * 1.4,
      delay: R() * 0.12, axis: new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 6 + R() * 14,
    }));
    const chipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
    this.chipMesh = new THREE.InstancedMesh(chipGeometry(), chipMat, this.chips.length);
    this.chipMesh.frustumCulled = false; this.chipMesh.castShadow = false;
    const col = new THREE.Color();
    this.chips.forEach((c, i) => { const k = 0.62 + R() * 0.38; this.chipMesh.setColorAt(i, col.setRGB(0.84 * k, 0.81 * k, 0.76 * k)); });
    this.group.add(this.chipMesh);

    // dust
    const ND = 30;
    this.dust = Array.from({ length: ND }, () => ({
      a: R() * Math.PI * 2, r0: S * (0.42 + R() * 0.1), out: S * (0.1 + R() * 0.22), up: 2 + R() * 9,
      s0: 5 + R() * 6, s1: 12 + R() * 12, life: 0.8 + R() * 0.7, delay: R() * 0.18, al: 0.25 + R() * 0.3,
    }));
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ND * 3), 3));
    dg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(ND), 1));
    dg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(ND), 1));
    this.dustU = { uScale: { value: 500 }, uCol: { value: new THREE.Color(0.80, 0.77, 0.72) } };
    this.dustPts = new THREE.Points(dg, new THREE.ShaderMaterial({
      uniforms: this.dustU, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(1.0, -mv.z); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = vA * (1.0 - smoothstep(0.15, 1.0, r)); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a); }`,
    }));
    this.dustPts.frustumCulled = false; this.dustPts.renderOrder = 7;
    this.group.add(this.dustPts);

    // the ping on the map where the building stood (it sinks with the town)
    const pingMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, clippingPlanes: [clipPlane] });
    this.pings = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 48), pingMat.clone()); m.rotation.x = -Math.PI / 2; m.renderOrder = 6; return m; });
    this._db = new THREE.Vector2(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  // the building's material: clipped at the floor, glowing where it comes out of it, a glowing cut face
  patchMaterial(mat) {
    mat.clippingPlanes = [this.clipPlane]; mat.clipShadows = true; mat.side = THREE.DoubleSide;
    const u = this.u;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRise; uniform vec3 uGlow; uniform float uBand;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if NUM_CLIPPING_PLANES > 0
  float hUp = clippingPlanes[0].w - dot(vClipPosition, clippingPlanes[0].xyz);
  totalEmissiveRadiance += uGlow * (uRise * 2.2 * exp(-max(hUp, 0.0) / uBand));
#endif
  if (!gl_FrontFacing) {
    if (uRise > 0.001) { diffuseColor.rgb *= 0.15; totalEmissiveRadiance += uGlow * (1.5 * uRise); }
    else diffuseColor.rgb *= 0.4;
  }`);
    };
    mat.customProgramCacheKey = () => 'bld-rise-v1';
    mat.needsUpdate = true;
  }

  // where the floor is: the stone block (its half width) or the flat card
  setFloor(card, half) {
    this.card = card;
    this.floorY = card ? -0.3 : -0.2;
    this.edge = card ? Infinity : half;
    const w = card ? this.S * 1.025 : half * 2;
    this.floor.scale.set(w, w, 1);
    this.floor.position.y = this.floorY + 0.04;
  }

  begin(townRoot, L) {
    for (const p of this.pings) { if (p.parent !== townRoot) townRoot.add(p); p.position.set(L.pos[0], L.ground + 0.6, L.pos[2]); p.visible = true; }
  }
  end() {
    this.group.visible = false; this.u.uRise.value = 0;
    for (const p of this.pings) p.visible = false;
  }

  // a: 0..1 along the grow; mode 'grow' | 'frozen' (everything) or 'shrink' (no chips, dust or pings)
  update(a, mode, tn, renderer, camera) {
    const T = RISE, back = mode === 'shrink';
    this.group.visible = true;
    // pings on the map
    for (let i = 0; i < 2; i++) {
      const p = this.pings[i], k = (a - i * 0.07) / 0.26;
      p.visible = !back && k > 0 && k < 1;
      if (p.visible) { const r = 3 + 15 * easeOut(k); p.scale.set(r, r, r); p.material.opacity = 0.9 * (1 - k) * (1 - k); }
    }
    // the floor
    const f = this.floorU;
    f.uTime.value = tn;
    f.uReveal.value = 0.05 + 1.25 * easeOut((a - T.crack0) / (T.crack1 - T.crack0));
    f.uFade.value = smooth(T.crack0 - 0.02, T.crack0 + 0.04, a) * (1 - smooth(0.8, 0.98, a));
    f.uPool.value = Math.sin(Math.PI * sat((a - 0.24) / 0.64));
    const ks = (a - T.land) / (1 - T.land);
    f.uShockR.value = 0.35 + 0.75 * easeOut(ks);
    f.uShockA.value = !back && ks > 0 && ks < 1 ? 1.1 * (1 - ks) : 0;
    this.u.uRise.value = smooth(T.rise0 - 0.04, T.rise0 + 0.03, a) * (1 - smooth(T.rise1 - 0.04, 0.99, a));
    // chips and dust: seconds since the burst
    const t = (a - T.burst) * this.grow;
    this.chipMesh.visible = !back && t > 0;
    this.dustPts.visible = !back && t > 0;
    if (this.chipMesh.visible) this.stepChips(t);
    if (this.dustPts.visible) {
      renderer.getDrawingBufferSize(this._db);
      this.dustU.uScale.value = camera.projectionMatrix.elements[5] * this._db.y / 2;
      this.stepDust(t);
    }
  }

  stepChips(t) {
    const g = 480, rest = 0.32, fy = this.floorY, E = this.edge;
    const { _m: m, _q: q, _p: p, _s: s } = this;
    this.chips.forEach((c, i) => {
      let tt = t - c.delay;
      if (tt <= 0) { m.makeScale(0, 0, 0); this.chipMesh.setMatrixAt(i, m); return; }
      const ca = Math.cos(c.a), sa = Math.sin(c.a), half = c.size * 0.5;
      let x = ca * c.r0, z = sa * c.r0, y = fy + half, vx = ca * c.vh, vz = sa * c.vh, vy = c.vy, falling = false, rest_ = false;
      for (let b = 0; b < 3; b++) {
        const land = fy + half;
        const tau = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, y - land))) / g;
        const onFloor = Math.abs(x + vx * tau) < E - half && Math.abs(z + vz * tau) < E - half;
        if (tt < tau || !onFloor) {       // still in the air (or off the block's edge: keeps falling)
          x += vx * tt; z += vz * tt; y += vy * tt - 0.5 * g * tt * tt;
          falling = !onFloor && tt > tau;
          tt = 0; break;
        }
        x += vx * tau; z += vz * tau; y = land; tt -= tau;
        vy = -(vy - g * tau) * rest; vx *= 0.55; vz *= 0.55;
        if (vy < 10 || b === 2) { rest_ = true; break; }
      }
      if (rest_ && tt > 0) { const d = Math.min(tt, 0.25); x += vx * (d - d * d / 0.5); z += vz * (d - d * d / 0.5); }
      const life = t - c.delay;
      let k = c.size * (1 - smooth(1.0, 1.35, life));
      if (falling) k *= 1 - sat((fy - 2 - y) / 12);           // off the edge: gone as it falls past the block
      q.setFromAxisAngle(c.axis, c.spin * (1 - Math.exp(-life * 2.5)) / 2.5);
      p.set(x, y, z); s.setScalar(Math.max(0, k));
      m.compose(p, q, s); this.chipMesh.setMatrixAt(i, m);
    });
    this.chipMesh.instanceMatrix.needsUpdate = true;
  }

  stepDust(t) {
    const g = this.dustPts.geometry, P = g.attributes.position, Sz = g.attributes.aSize, A = g.attributes.aAlpha;
    this.dust.forEach((d, i) => {
      const k = (t - d.delay) / d.life;
      if (k <= 0 || k >= 1) { A.setX(i, 0); Sz.setX(i, 0); P.setXYZ(i, 0, -999, 0); return; }
      const r = d.r0 + d.out * (1 - Math.exp(-3 * k)), y = this.floorY + 0.8 + d.up * easeOut(k);
      P.setXYZ(i, Math.cos(d.a) * r, y, Math.sin(d.a) * r);
      Sz.setX(i, d.s0 + (d.s1 - d.s0) * easeOut(k));
      A.setX(i, d.al * Math.pow(Math.sin(Math.PI * k), 0.8));
    });
    P.needsUpdate = Sz.needsUpdate = A.needsUpdate = true;
  }
}

// ---------------- the name sign ----------------
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
// small pictograms, drawn in a w x w box with its centre at (0, 0)
function kindOf(L) {
  const m = (L.model || L.id || '');
  if (/dzamija/.test(m)) return 'mosque';
  if (/sebilj/.test(m)) return 'kiosk';
  if (/sahat/.test(m)) return 'clock';
  if (/opstina/.test(m)) return 'hall';
  if (/^sv-|crkva/.test(m)) return 'church';
  if (/kula/.test(m)) return 'tower';
  if (/kuca/.test(m)) return 'house';
  return 'pin';
}
function drawIcon(g, kind, w) {
  const u = w / 100;
  g.save(); g.scale(u, u);
  const R = (x, y, ww, hh) => g.fillRect(x, y, ww, hh);
  const tri = (x0, y0, x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill(); };
  const base = 40;
  if (kind === 'mosque') {
    R(-38, 4, 58, base - 4);
    g.beginPath(); g.arc(-9, 6, 25, Math.PI, 0); g.fill();
    R(-10, -26, 2, 8);
    R(26, -26, 10, base + 26); tri(24, -26, 31, -48, 38, -26); R(23, -8, 16, 4);
  } else if (kind === 'church') {
    R(-34, 0, 44, base); tri(-38, 2, -12, -20, 14, 2);
    R(14, -22, 20, base + 22); tri(12, -22, 24, -40, 36, -22); R(22.5, -52, 3, 14); R(18, -47, 12, 3);
  } else if (kind === 'tower') {
    R(-20, -16, 40, base + 16); tri(-27, -14, 0, -42, 27, -14);
    g.globalCompositeOperation = 'destination-out';
    R(-11, -4, 6, 9); R(5, -4, 6, 9); R(-11, 18, 6, 9); R(5, 18, 6, 9);
    g.globalCompositeOperation = 'source-over';
  } else if (kind === 'clock') {
    R(-14, -22, 28, base + 22); tri(-19, -20, 0, -48, 19, -20);
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, -6, 8, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over'; R(-1, -12, 2, 7); R(-1, -7, 6, 2);
  } else if (kind === 'hall') {
    R(-40, 30, 80, 10); tri(-42, -10, 0, -32, 42, -10); R(-40, -10, 80, 6);
    for (const x of [-34, -18, -2, 14, 30]) R(x, -2, 6, 30);
  } else if (kind === 'house') {      // stone ground floor, plastered upper floor, steep hipped roof
    R(-34, 14, 68, 26); R(-30, -6, 60, 20);
    g.beginPath(); g.moveTo(-44, -4); g.lineTo(-10, -40); g.lineTo(10, -40); g.lineTo(44, -4); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out';
    R(-22, 0, 12, 10); R(10, 0, 12, 10); R(-6, 22, 12, 18); R(-36, 9, 72, 2.5);
    g.globalCompositeOperation = 'source-over';
  } else if (kind === 'kiosk') {
    R(-30, 30, 60, 10); R(-24, 4, 4, 26); R(20, 4, 4, 26); R(-2, 4, 4, 26);
    g.beginPath(); g.moveTo(-32, 6); g.quadraticCurveTo(0, -42, 32, 6); g.closePath(); g.fill(); R(-1.5, -34, 3, 12);
  } else {
    g.beginPath(); g.arc(0, -8, 22, 0, Math.PI * 2); g.fill(); tri(-19, 4, 0, 40, 19, 4);
  }
  g.restore();
}

export class NamePlaque {
  constructor(holder, S) {
    this.S = S;
    const pw = this.pw = S * 0.8, ph = this.ph = pw * 0.3;
    this.root = new THREE.Group(); this.root.visible = false; holder.add(this.root);
    this.hinge = new THREE.Group(); this.root.add(this.hinge);
    // the enamel plate: a rounded slab, the picture on its front
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = Math.round(1024 * 0.3);
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const shape = new THREE.Shape(), r = ph * 0.13, x0 = -pw / 2, y0 = -ph;
    shape.moveTo(x0 + r, y0); shape.lineTo(x0 + pw - r, y0); shape.quadraticCurveTo(x0 + pw, y0, x0 + pw, y0 + r);
    shape.lineTo(x0 + pw, y0 + ph - r); shape.quadraticCurveTo(x0 + pw, y0 + ph, x0 + pw - r, y0 + ph);
    shape.lineTo(x0 + r, y0 + ph); shape.quadraticCurveTo(x0, y0 + ph, x0, y0 + ph - r);
    shape.lineTo(x0, y0 + r); shape.quadraticCurveTo(x0, y0, x0 + r, y0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.28, bevelSegments: 2, curveSegments: 5 });
    const P = geo.attributes.position, UV = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) UV.setXY(i, (P.getX(i) - x0) / pw, (P.getY(i) - y0) / ph);
    this.top = 0.6;                                        // plate top this far below the pins
    geo.translate(0, -this.top, -0.25);
    const face = new THREE.MeshPhysicalMaterial({ map: this.tex, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x1a3f95, roughness: 0.32, metalness: 0.1 });
    this.plate = new THREE.Mesh(geo, [face, edge]);
    this.plate.castShadow = true; this.plate.receiveShadow = true;
    this.hinge.add(this.plate);
    // two rings through the plate's top, hung on two iron pins
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.45, metalness: 0.75 });
    this.ringX = pw * 0.32;
    for (const sx of [-1, 1]) {
      // hangs on the pin (radius 0.32) and passes through a hole about 1.4 mm below the plate's top
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.2, 8, 22), iron);
      ring.rotation.y = Math.PI / 2; ring.position.set(sx * this.ringX, 0.32 + 0.2 - 1.25, 0); ring.castShadow = true;
      this.hinge.add(ring);
    }
    // on the block: pins out of the stone; on the card: a little frame with a bar
    this.pins = new THREE.Group(); this.root.add(this.pins);
    for (const sx of [-1, 1]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.2, 10), iron);
      pin.rotation.x = Math.PI / 2; pin.position.set(sx * this.ringX, 0, -0.75); pin.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), iron); head.position.set(sx * this.ringX, 0, 0.6);
      this.pins.add(pin, head);
    }
    this.frame = new THREE.Group(); this.root.add(this.frame);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3d25, roughness: 0.8 });
    this.postH = ph + this.top + 4;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.6, this.postH + 2, 1.6), wood);
      post.position.set(sx * (pw / 2 + 1.6), -this.postH / 2 + 1, 0); post.castShadow = true; this.frame.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, pw + 3.2, 10), iron);
    bar.rotation.z = Math.PI / 2; this.frame.add(bar);
    this.state = 'hidden'; this.t0 = 0; this.side = 0; this.nextSide = null; this.theta = 0; this.thetaFrom = 0; this.k = 0;
    this.L = null; this.lang = '';
    this._c = new THREE.Vector3();
  }

  set(L, lang, names) {
    this.L = L; this.lang = lang; this.names = names; this.draw();
  }

  draw() {
    const L = this.L; if (!L) return;
    const c = this.canvas, g = c.getContext('2d'), W = c.width, H = c.height;
    // fired enamel: deep blue, a touch lighter at the top, slightly mottled
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#2c66d9'); grd.addColorStop(0.55, '#2253be'); grd.addColorStop(1, '#1a43a0');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const R = rng(3);
    g.globalAlpha = 0.05;
    for (let i = 0; i < 260; i++) { g.fillStyle = R() < 0.5 ? '#ffffff' : '#0a1f55'; g.beginPath(); g.arc(R() * W, R() * H, 2 + R() * 9, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    // white rim
    rrect(g, 20, 20, W - 40, H - 40, 34); g.lineWidth = 10; g.strokeStyle = '#f6f3ea'; g.stroke();
    // holes for the rings
    for (const sx of [-1, 1]) {
      const x = W / 2 + sx * (this.ringX / this.pw) * W, y = (1.4 / this.ph) * H;
      g.fillStyle = '#e9e5da'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#16181c'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    }
    // pictogram in a white disc
    const cy = H / 2 + 10, dr = 88, dx = 58 + dr;
    g.fillStyle = '#f6f3ea'; g.beginPath(); g.arc(dx, cy, dr, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f4cb3'; g.save(); g.translate(dx, cy + 4); drawIcon(g, kindOf(L), dr * 1.25); g.restore();
    // the jigsaw piece (a map square), like a house number
    const bw = 112, bx = W - 50 - bw, by = cy - bw / 2;
    g.fillStyle = '#f6f3ea'; rrect(g, bx, by, bw, bw, 18); g.fill();
    g.fillStyle = '#1f4cb3'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 54px ${SANS}`; g.fillText(L.piece || '', bx + bw / 2, by + bw / 2 + 3);
    // name, and the other two languages under it
    const tx0 = dx + dr + 34, tw = bx - 30 - tx0;
    const fit = (text, size, weight, min) => {
      let s = size; g.font = `${weight} ${s}px ${SANS}`;
      while (g.measureText(text).width > tw && s > min) { s -= 2; g.font = `${weight} ${s}px ${SANS}`; }
      return s;
    };
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#ffffff';
    const name = this.names.main, sub = this.names.others.join('  ·  ');
    // a long name (Kuća Radončića – Balića) goes on two lines rather than shrinking out of reach
    let size = fit(name, 86, 700, 40), lines = [name];
    if (size < 64) {
      const cut = name.includes(' – ') ? name.indexOf(' – ') + 2 : name.lastIndexOf(' ', Math.ceil(name.length / 2) + 4);
      if (cut > 0) lines = [name.slice(0, cut).trim(), name.slice(cut).trim()];
    }
    if (lines.length === 1) {
      g.fillText(name, tx0, cy + 14);
      if (sub) { g.globalAlpha = 0.82; fit(sub, 36, 500, 20); g.fillText(sub, tx0, cy + 66); g.globalAlpha = 1; }
    } else {
      size = Math.min(...lines.map(l => fit(l, 66, 700, 34)));
      g.font = `700 ${size}px ${SANS}`;
      g.fillText(lines[0], tx0, cy - 12); g.fillText(lines[1], tx0, cy - 12 + size * 0.98);
      if (sub) { g.globalAlpha = 0.82; fit(sub, 30, 500, 18); g.fillText(sub, tx0, cy - 12 + size * 0.98 + 40); g.globalAlpha = 1; }
    }
    g.textBaseline = 'alphabetic';
    this.tex.needsUpdate = true;
  }

  show(tn) { if (this.state === 'hidden') { this.state = 'drop'; this.t0 = tn; this.nextSide = null; this.root.visible = true; this.pickSide = true; } }
  hide(tn) { if (this.state === 'drop' || this.state === 'shown') { this.state = 'lift'; this.t0 = tn; this.thetaFrom = this.theta; this.nextSide = null; } }
  hideNow() { this.state = 'hidden'; this.root.visible = false; }

  // camLocal: the camera's position in the holder's frame; half: the block's half width (cube) or null (card)
  update(tn, camLocal, half) {
    if (this.state === 'hidden') { this.root.visible = false; return; }
    const want = (Math.round(Math.atan2(camLocal.x, camLocal.z) / (Math.PI / 2)) % 4 + 4) % 4;
    if (this.pickSide) { this.side = want; this.pickSide = false; }
    if (this.state === 'shown' && want !== this.side) {
      let off = Math.atan2(camLocal.x, camLocal.z) - this.side * Math.PI / 2; off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > Math.PI / 4 + 0.22) { this.hide(tn); this.nextSide = want; }
    }
    const t = tn - this.t0, TOP = 1.75;
    if (this.state === 'drop') {
      // drops from flat over the edge and clacks against the wall: |cos| bounces, dying away
      this.k = easeOut(t / 0.14);
      this.theta = TOP * Math.exp(-t / 0.24) * Math.abs(Math.cos((Math.PI / 2) * t / 0.2));
      if (t > 1.5) this.state = 'shown';
    } else if (this.state === 'shown') {
      this.k = 1; this.theta = 0.01 * (0.5 + 0.5 * Math.sin(tn * 1.6));
    } else if (this.state === 'lift') {
      this.theta = this.thetaFrom + (TOP - this.thetaFrom) * easeOut(t / 0.2);
      this.k = 1 - smooth(0.08, 0.24, t);
      if (t > 0.24) {
        if (this.nextSide != null) { this.side = this.nextSide; this.nextSide = null; this.state = 'drop'; this.t0 = tn; }
        else { this.state = 'hidden'; this.root.visible = false; return; }
      }
    }
    this.root.visible = true;
    const card = half == null;
    this.pins.visible = !card; this.frame.visible = card;
    const yaw = this.side * Math.PI / 2;
    this.root.rotation.set(0, yaw, 0);
    const d = card ? this.S * 0.6 : half + 1.3, y = card ? this.postH - 0.3 : -0.2 - 2.4;
    this.root.position.set(Math.sin(yaw) * d, y, Math.cos(yaw) * d);
    this.hinge.rotation.x = -this.theta;
    this.root.scale.setScalar(Math.max(0.001, this.k));
  }
}
