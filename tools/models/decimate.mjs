// Quadric-error mesh simplification (Garland & Heckbert) with manifold and flip checks.
// Usage: node decimate.mjs in.bin out.bin targetTriangles
// Binary in/out: u32 nv, u32 nf, f64 pos[3nv], i32 faces[3nf]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, targetArg] = process.argv;
const buf = readFileSync(inPath);
const nv = buf.readUInt32LE(0), nf = buf.readUInt32LE(4);
const pos = new Float64Array(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + nv * 24));
const F = new Int32Array(buf.buffer.slice(buf.byteOffset + 8 + nv * 24, buf.byteOffset + 8 + nv * 24 + nf * 12));
const target = Number(targetArg);

const faceAlive = new Uint8Array(nf).fill(1);
const vAlive = new Uint8Array(nv).fill(1);
const vVer = new Uint32Array(nv);
const locked = new Uint8Array(nv);
const vf = Array.from({ length: nv }, () => []);
for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vf[F[3 * f + k]].push(f);

// ---- quadrics ----
const Q = new Float64Array(10 * nv);
function addPlane(v, a, b, c, d, w) {
  const o = 10 * v;
  Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
  Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
  Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
}
function faceNormal(f, out) {
  const a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2];
  const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
  const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
  out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  return Math.hypot(out[0], out[1], out[2]);
}
const tmp = [0, 0, 0];
let totalArea = 0;
for (let f = 0; f < nf; f++) {
  const l = faceNormal(f, tmp); if (l < 1e-20) continue;
  const a = tmp[0] / l, b = tmp[1] / l, c = tmp[2] / l, v0 = F[3 * f];
  const d = -(a * pos[3 * v0] + b * pos[3 * v0 + 1] + c * pos[3 * v0 + 2]);
  const area = l / 2; totalArea += area;
  for (let k = 0; k < 3; k++) addPlane(F[3 * f + k], a, b, c, d, area);
}
// Edge use counts: boundary (1 face) gets a constraint plane, non-manifold (>2) is locked.
const edgeMap = new Map();
const ekey = (a, b) => (a < b ? a * nv + b : b * nv + a);
for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) {
  const a = F[3 * f + k], b = F[3 * f + (k + 1) % 3], key = ekey(a, b);
  const e = edgeMap.get(key); if (e) e.n++; else edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), n: 1, f });
}
const isBoundaryV = new Uint8Array(nv);
for (const e of edgeMap.values()) {
  if (e.n > 2) { locked[e.a] = 1; locked[e.b] = 1; continue; }
  if (e.n === 1) {
    isBoundaryV[e.a] = 1; isBoundaryV[e.b] = 1;
    const l = faceNormal(e.f, tmp); if (l < 1e-20) continue;
    const nx = tmp[0] / l, ny = tmp[1] / l, nz = tmp[2] / l;
    const ex = pos[3 * e.b] - pos[3 * e.a], ey = pos[3 * e.b + 1] - pos[3 * e.a + 1], ez = pos[3 * e.b + 2] - pos[3 * e.a + 2];
    let px = ey * nz - ez * ny, py = ez * nx - ex * nz, pz = ex * ny - ey * nx; const pl = Math.hypot(px, py, pz);
    if (pl < 1e-20) continue; px /= pl; py /= pl; pz /= pl;
    const d = -(px * pos[3 * e.a] + py * pos[3 * e.a + 1] + pz * pos[3 * e.a + 2]);
    const w = 20 * (ex * ex + ey * ey + ez * ez);
    addPlane(e.a, px, py, pz, d, w); addPlane(e.b, px, py, pz, d, w);
  }
}

// ---- heap ----
let hCost = new Float64Array(1 << 20), hA = new Int32Array(1 << 20), hB = new Int32Array(1 << 20), hVa = new Uint32Array(1 << 20), hVb = new Uint32Array(1 << 20);
let hX = new Float64Array(3 << 20), hN = 0;
function grow() {
  const n = hCost.length * 2;
  const g = (A, T, m = 1) => { const B = new T(n * m); B.set(A); return B; };
  hCost = g(hCost, Float64Array); hA = g(hA, Int32Array); hB = g(hB, Int32Array); hVa = g(hVa, Uint32Array); hVb = g(hVb, Uint32Array); hX = g(hX, Float64Array, 3);
}
function swap(i, j) {
  let t = hCost[i]; hCost[i] = hCost[j]; hCost[j] = t;
  t = hA[i]; hA[i] = hA[j]; hA[j] = t; t = hB[i]; hB[i] = hB[j]; hB[j] = t;
  t = hVa[i]; hVa[i] = hVa[j]; hVa[j] = t; t = hVb[i]; hVb[i] = hVb[j]; hVb[j] = t;
  for (let k = 0; k < 3; k++) { t = hX[3 * i + k]; hX[3 * i + k] = hX[3 * j + k]; hX[3 * j + k] = t; }
}
function push(cost, a, b, x, y, z) {
  if (hN >= hCost.length) grow();
  let i = hN++;
  hCost[i] = cost; hA[i] = a; hB[i] = b; hVa[i] = vVer[a]; hVb[i] = vVer[b]; hX[3 * i] = x; hX[3 * i + 1] = y; hX[3 * i + 2] = z;
  while (i > 0) { const p = (i - 1) >> 1; if (hCost[p] <= hCost[i]) break; swap(i, p); i = p; }
}
function pop() {
  hN--; swap(0, hN);
  let i = 0;
  for (;;) {
    const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < hN && hCost[l] < hCost[m]) m = l;
    if (r < hN && hCost[r] < hCost[m]) m = r;
    if (m === i) break; swap(i, m); i = m;
  }
  return hN;
}

const Qs = new Float64Array(10);
function evalEdge(a, b) {
  if (locked[a] || locked[b]) return;
  for (let k = 0; k < 10; k++) Qs[k] = Q[10 * a + k] + Q[10 * b + k];
  const m00 = Qs[0], m01 = Qs[1], m02 = Qs[2], m11 = Qs[4], m12 = Qs[5], m22 = Qs[7];
  const b0 = -Qs[3], b1 = -Qs[6], b2 = -Qs[8];
  const det = m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
  const cost = (x, y, z) => Qs[0] * x * x + 2 * Qs[1] * x * y + 2 * Qs[2] * x * z + 2 * Qs[3] * x + Qs[4] * y * y + 2 * Qs[5] * y * z + 2 * Qs[6] * y + Qs[7] * z * z + 2 * Qs[8] * z + Qs[9];
  const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2], bx = pos[3 * b], by = pos[3 * b + 1], bz = pos[3 * b + 2];
  let best = null;
  const scale = Math.abs(m00) + Math.abs(m11) + Math.abs(m22);
  if (Math.abs(det) > 1e-9 * scale * scale * scale) {
    const x = (b0 * (m11 * m22 - m12 * m12) - m01 * (b1 * m22 - m12 * b2) + m02 * (b1 * m12 - m11 * b2)) / det;
    const y = (m00 * (b1 * m22 - m12 * b2) - b0 * (m01 * m22 - m12 * m02) + m02 * (m01 * b2 - b1 * m02)) / det;
    const z = (m00 * (m11 * b2 - b1 * m12) - m01 * (m01 * b2 - b1 * m02) + b0 * (m01 * m12 - m11 * m02)) / det;
    // keep the optimum close to the edge (avoid spikes)
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2, el = Math.hypot(bx - ax, by - ay, bz - az);
    if (Math.hypot(x - mx, y - my, z - mz) < el * 1.5) best = [cost(x, y, z), x, y, z];
  }
  for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]]) {
    const c = cost(x, y, z); if (!best || c < best[0]) best = [c, x, y, z];
  }
  // Boundary vertices must stay on the boundary: only collapse boundary edges into an endpoint position.
  if (isBoundaryV[a] || isBoundaryV[b]) {
    let sharedN = 0;
    for (const f of vf[a]) if (faceAlive[f] && (F[3 * f] === b || F[3 * f + 1] === b || F[3 * f + 2] === b)) sharedN++;
    if (isBoundaryV[a] && isBoundaryV[b] && sharedN !== 1) return;
    if (isBoundaryV[a] && !isBoundaryV[b]) best = [cost(ax, ay, az), ax, ay, az];
    else if (isBoundaryV[b] && !isBoundaryV[a]) best = [cost(bx, by, bz), bx, by, bz];
  }
  push(Math.max(0, best[0]), a, b, best[1], best[2], best[3]);
}

function neighbours(v) {
  const s = new Set();
  for (const f of vf[v]) if (faceAlive[f]) for (let k = 0; k < 3; k++) { const w = F[3 * f + k]; if (w !== v) s.add(w); }
  return s;
}

const n0 = [0, 0, 0], n1 = [0, 0, 0];
function flips(v, other, x, y, z) {
  for (const f of vf[v]) {
    if (!faceAlive[f]) continue;
    const i0 = F[3 * f], i1 = F[3 * f + 1], i2 = F[3 * f + 2];
    if (i0 === other || i1 === other || i2 === other) continue; // removed by the collapse
    const l0 = faceNormal(f, n0);
    const P = (i) => (i === v ? [x, y, z] : [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    const A = P(i0), B = P(i1), C = P(i2);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    n1[0] = uy * wz - uz * wy; n1[1] = uz * wx - ux * wz; n1[2] = ux * wy - uy * wx;
    const l1 = Math.hypot(n1[0], n1[1], n1[2]);
    if (l1 < 1e-24 || l0 < 1e-24) return true;
    if ((n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < 0.25) return true;
    // reject slivers: area relative to longest edge squared
    const e2 = Math.max(ux * ux + uy * uy + uz * uz, wx * wx + wy * wy + wz * wz, (C[0] - B[0]) ** 2 + (C[1] - B[1]) ** 2 + (C[2] - B[2]) ** 2);
    if (l1 / e2 < 0.02 && l0 / Math.max(e2, 1e-30) >= 0.02) return true;
  }
  return false;
}

for (const e of edgeMap.values()) if (e.n <= 2) evalEdge(e.a, e.b);

let alive = nf, collapses = 0;
const t0 = Date.now();
while (alive > target && hN > 0) {
  const top = 0;
  const a = hA[top], b = hB[top], va = hVa[top], vb = hVb[top], x = hX[0], y = hX[1], z = hX[2];
  pop();
  if (!vAlive[a] || !vAlive[b] || vVer[a] !== va || vVer[b] !== vb) continue;
  // shared faces and link condition
  const shared = vf[a].filter((f) => faceAlive[f] && (F[3 * f] === b || F[3 * f + 1] === b || F[3 * f + 2] === b));
  if (shared.length === 0 || shared.length > 2) continue;
  const na = neighbours(a), nb = neighbours(b);
  let common = 0; for (const w of na) if (nb.has(w)) common++;
  if (common !== shared.length) continue;
  if (flips(a, b, x, y, z) || flips(b, a, x, y, z)) continue;
  // collapse b into a
  for (const f of shared) { faceAlive[f] = 0; alive--; }
  for (const f of vf[b]) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) if (F[3 * f + k] === b) F[3 * f + k] = a;
    vf[a].push(f);
  }
  vf[b] = []; vAlive[b] = 0;
  vf[a] = vf[a].filter((f) => faceAlive[f]);
  pos[3 * a] = x; pos[3 * a + 1] = y; pos[3 * a + 2] = z;
  for (let k = 0; k < 10; k++) Q[10 * a + k] += Q[10 * b + k];
  if (isBoundaryV[b]) isBoundaryV[a] = 1;
  vVer[a]++;
  collapses++;
  for (const w of neighbours(a)) evalEdge(Math.min(a, w), Math.max(a, w));
  if (collapses % 20000 === 0) process.stderr.write(`  ${alive} faces left, heap ${hN}\n`);
}

// compact
const remap = new Int32Array(nv).fill(-1);
let nv2 = 0; const outPos = [], outF = [];
for (let f = 0; f < nf; f++) {
  if (!faceAlive[f]) continue;
  for (let k = 0; k < 3; k++) {
    const v = F[3 * f + k];
    if (remap[v] < 0) { remap[v] = nv2++; outPos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); }
    outF.push(remap[v]);
  }
}
const nf2 = outF.length / 3;
const out = Buffer.alloc(8 + nv2 * 24 + nf2 * 12);
out.writeUInt32LE(nv2, 0); out.writeUInt32LE(nf2, 4);
Buffer.from(new Float64Array(outPos).buffer).copy(out, 8);
Buffer.from(new Int32Array(outF).buffer).copy(out, 8 + nv2 * 24);
writeFileSync(outPath, out);
console.log(JSON.stringify({ in: { nv, nf }, out: { nv: nv2, nf: nf2 }, collapses, seconds: (Date.now() - t0) / 1000 }));
