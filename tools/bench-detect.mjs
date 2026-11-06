// Marker recall on the benchmark frames with the city map's own code: own JS detector vs OpenCV (cvdetect.js).
// node|bun tools/bench-detect.mjs . BENCHDIR   (frames from gusinjska-kocka test/gen_bench.py + a .gray copy of each)
// Under Bun this runs in JavaScriptCore, Safari's JavaScript engine.
import fs from 'node:fs';
import path from 'node:path';
const [REPO, DIR] = process.argv.slice(2);
const { MarkerDetector } = await import(path.join(REPO, 'js/cv/detector.js'));
const { CvDetector } = await import(path.join(REPO, 'js/cv/cvdetect.js'));
const layout = JSON.parse(fs.readFileSync(path.join(REPO, 'data/layout.json')));
const codes = [...layout.markers, ...(layout.card ? layout.card.markers : [])].map((m) => ({ id: m.id, cells: m.cells }));
const gt = JSON.parse(fs.readFileSync(path.join(DIR, 'gt.json')));
const engine = typeof Bun !== 'undefined' ? 'JavaScriptCore (Bun ' + Bun.version + ')' : 'V8 (Node ' + process.version + ')';
// load opencv.js the way a classic script would (it sets globalThis.cv)
const t0 = performance.now();
const src = fs.readFileSync(path.join(REPO, 'js/vendor/opencv/opencv.js'), 'utf8');
const savedProcess = globalThis.process;
Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true, writable: true });   // look like a browser
(0, eval)(src);
let cv = globalThis.cv; if (typeof cv.then === 'function') cv = await cv;
Object.defineProperty(globalThis, 'process', { value: savedProcess, configurable: true, writable: true });
const loadMs = performance.now() - t0;
const own = new MarkerDetector(codes), ocv = new CvDetector(cv, codes.map((c) => c.id));
function down2(g, w, h) {
  const W = w >> 1, H = h >> 1, o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 2 * y * w + 2 * x; o[y * W + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1] + 2) >> 2; }
  return { g: o, w: W, h: H };
}
let fi = 0;
const methods = {
  own: (s) => own.detectGray(s.g, s.w, s.h, { radius: [2, 3, 5][fi % 3] }).map((m) => m.id),
  opencv: (s) => ocv.detectGray(s.g, s.w, s.h, { mode: 'search', scale: 0.5 }).map((m) => m.id),
};
const res = {};
for (const fr of gt.frames) {
  fi++;
  const g = new Uint8Array(fs.readFileSync(path.join(DIR, fr.file.replace('.png', '.gray'))));
  const s = down2(g, gt.W, gt.H), vis = new Set(fr.visible);
  for (const [name, fn] of Object.entries(methods)) {
    const a = performance.now(); const ids = [...new Set(fn(s))]; const ms = performance.now() - a;
    const r = ((res[fr.cond] ??= {})[name] ??= { tp: 0, fp: 0, n: 0, ms: 0, hit: 0, frames: 0 });
    const tp = ids.filter((i) => vis.has(i)).length;
    r.tp += tp; r.fp += ids.length - tp; r.n += vis.size; r.ms += ms;
    if (vis.size) { r.frames++; if (tp >= 2) r.hit++; }
  }
}
console.log(`${engine}: opencv.js loaded and ready in ${(loadMs / 1000).toFixed(1)} s`);
console.log('condition'.padEnd(11) + 'markers found (own -> opencv)'.padEnd(32) + 'frames with >=2 markers'.padEnd(26) + 'outside gt  ms/frame (own, opencv)');
for (const [cond, r] of Object.entries(res)) {
  const p = (x) => Math.round(100 * x) + '%';
  console.log(cond.padEnd(11) + `${p(r.own.tp / r.own.n)} -> ${p(r.opencv.tp / r.opencv.n)}`.padEnd(32) + `${p(r.own.hit / r.own.frames)} -> ${p(r.opencv.hit / r.opencv.frames)}`.padEnd(26) + `${r.own.fp}, ${r.opencv.fp}`.padEnd(12) + `${(r.own.ms / r.own.frames).toFixed(1)}, ${(r.opencv.ms / r.opencv.frames).toFixed(1)}`);
}
