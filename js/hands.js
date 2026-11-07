// Hands in the air: tracking (worker), pinch detection, and drawing the hand over the map.
// The map logic (what a pinch does to the town) is in app.js; this file only knows hands.
import { OneEuro } from './cv/pose.js';

// landmark indices: 0 wrist, 4 thumb tip, 8 index tip, 5/9/13/17 knuckles (index..little)
export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]];
const PALM = [0, 1, 5, 9, 13, 17];
const PINCH_ON = 0.032, PINCH_OFF = 0.048;   // thumb tip to index tip, metres (MediaPipe world landmarks)
const RATIO_ON = 0.30, RATIO_OFF = 0.45;     // the same on the picture, relative to the palm (if world data is missing)
const OPEN_GAP = 0.055, RATIO_OPEN = 0.55;   // fingers clearly apart: needed (twice in a row) before a pinch can start
const LOST = 0.3;                             // seconds a hand is kept after it was last seen

// ---------------- the tracker ----------------
export class HandEngine {
  constructor(onState) {
    this.state = 'off'; this.onState = onState || (() => {});
    this.worker = null; this.busy = false; this.id = 0; this.latest = null; this.delegate = '';
    this.ms = 0; this.rate = 0; this.lastResultAt = 0;
  }
  set(s, info) { this.state = s; this.onState(s, info); }
  start(delegate = 'GPU') {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.set('loading');
    let w;
    try { w = new Worker(new URL('./hand-worker.js', import.meta.url), { type: 'module' }); } catch (e) { this.set('error', String(e.message || e)); return; }
    this.worker = w;
    const timeout = setTimeout(() => { if (this.state === 'loading') { this.set('error', 'timeout'); this.stop(); } }, 60000);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(timeout); this.delegate = m.delegate; this.set('ready', m.delegate); }
      else if (m.type === 'error') { if (this.state === 'loading') { clearTimeout(timeout); this.set('error', m.msg); this.stop(); } else console.warn('hands:', m.msg); }
      else if (m.type === 'result') {
        this.busy = false;
        const now = performance.now();
        if (this.lastResultAt) this.rate = this.rate * 0.85 + 0.15 * (1000 / Math.max(1, now - this.lastResultAt));
        this.lastResultAt = now;
        this.ms = this.ms * 0.85 + 0.15 * m.ms;
        this.latest = { id: m.id, t: m.t, hands: m.hands, at: now };
      }
    };
    w.onerror = (e) => { clearTimeout(timeout); if (this.state !== 'error') this.set('error', e.message || 'worker'); this.stop(); };
    w.postMessage({ type: 'init', delegate, wasm: new URL('./vendor/mediapipe/wasm', import.meta.url).href, model: new URL('../models/hand_landmarker.task', import.meta.url).href });
  }
  stop() { if (this.worker) this.worker.terminate(); this.worker = null; this.busy = false; if (this.state !== 'error') this.set('off'); }
  // hand one camera frame to the worker (skipped while the previous one is still being processed)
  submit(source, w, h, tMs) {
    if (this.busy && performance.now() - this.sentAt > 1500) this.busy = false;   // lost message: don't wait forever
    if (this.state !== 'ready' || this.busy || !this.worker) return false;
    this.busy = true; this.sentAt = performance.now();
    const id = ++this.id;
    createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      .then(bm => { if (this.worker) this.worker.postMessage({ type: 'frame', bitmap: bm, t: tMs, id }, [bm]); else bm.close(); })
      .catch(() => { this.busy = false; });
    return true;
  }
}

// ---------------- hands over time: identity, smoothing, pinch ----------------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let nextId = 1;
export class HandSet {
  constructor() { this.hands = []; this.lastId = -1; }
  // result: worker result; toScreen(nx, ny) -> [x, y] in CSS px; now in seconds
  update(result, toScreen, now) {
    if (result && result.id !== this.lastId) {
      this.lastId = result.id;
      const seen = (result.hands || []).map(h => {
        const pts = h.lm.map(p => toScreen(p[0], p[1]));
        const palm = (dist(pts[0], pts[5]) + dist(pts[0], pts[17]) + dist(pts[5], pts[17])) / 3;
        return { pts, wl: h.wl, palm, side: h.side };
      });
      // match to the hands we already know (nearest wrist, same side preferred)
      const used = new Set();
      for (const s of seen) {
        let best = null, bd = Infinity;
        for (const k of this.hands) {
          if (used.has(k)) continue;
          const d = dist(k.raw[0], s.pts[0]) + (k.side === s.side ? 0 : 60);
          if (d < bd && d < 4 * Math.max(s.palm, 40)) { bd = d; best = k; }
        }
        if (!best) { best = { id: nextId++, pinch: false, pinchAt: 0, armed: false, holder: false, holderUntil: -10, fp: new OneEuro(2, 1.6, 0.04, 1.0), fs: new OneEuro(1, 1.0, 0.02, 1.0), born: now }; this.hands.push(best); }
        used.add(best);
        best.raw = s.pts; best.side = s.side; best.seen = now;
        // pinch: world landmarks (metres) when there are any, else the picture
        let pinched = best.pinch, open = false;
        if (s.wl && s.wl.length === 21) {
          const d = dist3(s.wl[4], s.wl[8]);
          best.gap = d;
          pinched = best.pinch ? d < PINCH_OFF : d < PINCH_ON;
          open = d > OPEN_GAP;
        } else {
          const r = dist(s.pts[4], s.pts[8]) / Math.max(s.palm, 1);
          best.gap = r * 0.1;
          pinched = best.pinch ? r < RATIO_OFF : r < RATIO_ON;
          open = r > RATIO_OPEN;
        }
        // a pinch only counts if the fingers were seen clearly apart first (two readings in a row): a hand that turns
        // up already closed (the hand gripping the cube, a fist) never grabs the map, and a single noisy reading
        // doesn't arm it. A pinch must hold for two readings to start (no flicker); it ends at once, and opening
        // the fingers again arms the next one.
        best.openN = open ? (best.openN || 0) + 1 : 0;
        if (best.openN >= 2) best.armed = true;
        if (pinched && !best.pinch && best.armed) {
          best.on2 = (best.on2 || 0) + 1;
          if (best.on2 >= 2) { best.pinch = true; best.pinchAt = now; best.on2 = 0; best.armed = false; }
        } else { best.on2 = 0; if (!pinched && best.pinch) { best.pinch = false; best.releasedAt = now; } }
        const mid = [(s.pts[4][0] + s.pts[8][0]) / 2, (s.pts[4][1] + s.pts[8][1]) / 2];
        best.p = best.fp.filter(mid, now);
        best.palm = best.fs.filter([s.palm], now)[0];
        best.pts = s.pts;
      }
    }
    // forget hands not seen for a while
    for (const k of this.hands) if (now - k.seen > LOST && k.pinch) { k.pinch = false; k.releasedAt = now; }
    this.hands = this.hands.filter(k => now - k.seen <= LOST);
    return this.hands;
  }
  clear() { this.hands = []; }
}

// ---------------- drawing ----------------
// the real hand over the map: the camera picture cut out along the hand's bones, so fingers stay in front of the town
export function drawHandCutouts(ctx, hands, img, mapImg, dpr) {
  for (const h of hands) {
    if (!h.pts || h.holder) continue;                // the hand holding the cube is under the town
    const pts = h.pts.map(p => [p[0] * dpr, p[1] * dpr]);
    const w = Math.max(10, h.palm * dpr * 0.26);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const pad = w * 1.5;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 4 || bh < 4) continue;
    const m = scratch(bw, bh), g = m.getContext('2d');
    g.clearRect(0, 0, bw, bh);
    g.save(); g.translate(-x0, -y0);
    g.strokeStyle = g.fillStyle = '#000'; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); PALM.forEach((i, k) => k ? g.lineTo(pts[i][0], pts[i][1]) : g.moveTo(pts[i][0], pts[i][1])); g.closePath(); g.fill();
    g.lineWidth = w * 1.15; g.stroke();
    for (const [a, b] of BONES) {
      const tip = b === 4 || b === 8 || b === 12 || b === 16 || b === 20;
      g.lineWidth = w * (a === 0 ? 1.3 : tip ? 0.82 : 1.0) * (b <= 4 ? 1.12 : 1);
      g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
    }
    g.restore();
    g.globalCompositeOperation = 'source-in';
    mapImg(g, x0, y0, bw, bh);                     // the camera picture for that box
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(m, x0, y0);
  }
}
let scr = null;
function scratch(w, h) {
  if (!scr) scr = document.createElement('canvas');
  if (scr.width < w || scr.height < h) { scr.width = Math.max(scr.width, w); scr.height = Math.max(scr.height, h); }
  return scr;
}

// the pinch cursor: thumb and index tips joined by a line; a filled dot while the map is held
export function drawPinchCursors(ctx, hands, dpr, accent, pairLine) {
  ctx.save();
  ctx.scale(dpr, dpr);
  for (const h of hands) {
    if (!h.pts || !h.p || h.holder) continue;
    const a = h.pts[4], b = h.pts[8];
    const close = Math.max(0, Math.min(1, 1 - ((h.gap || 0.08) - PINCH_ON) / 0.05));
    ctx.lineCap = 'round';
    if (!h.pinch) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(h.p[0], h.p[1], 13 - 4 * close, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.4 * close})`; ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(h.p[0], h.p[1], 17, 0, Math.PI * 2); ctx.fillStyle = 'rgba(47,123,255,0.22)'; ctx.fill();
      ctx.beginPath(); ctx.arc(h.p[0], h.p[1], 9, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  if (pairLine) {
    const [p, q] = pairLine;
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}
