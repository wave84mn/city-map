// Test for the hand gestures, run inside the film harness (no camera, no hand model: hand readings are made up here
// and handed to the app with __city.injectHands). Usage:
//   FILMSEG=tools/film/test-hands.js SHOTS="drag:50,zoom:59,two:70,tap:20" node tools/film/film.cjs OUT
//   (or without SHOTS to film every frame); the checks are printed by the page (console) and kept in window.__handTest.
(() => {
  const R = window.__handTest = { log: [], ok: true };
  const check = (cond, msg) => { R.log.push((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) R.ok = false; console.warn('[handtest]', (cond ? 'ok: ' : 'FAIL: ') + msg); };
  // a right hand, back towards the camera, fingers up; units of "palm" (P); thumb tip 4 and index tip 8
  const OPEN = [[0, 0], [-0.35, -0.25], [-0.6, -0.55], [-0.75, -0.85], [-0.8, -1.1], [-0.3, -1.0], [-0.4, -1.45], [-0.48, -1.75], [-0.55, -2.0],
    [0, -1.05], [0, -1.55], [0, -1.85], [0, -2.1], [0.27, -1.0], [0.32, -1.45], [0.35, -1.72], [0.38, -1.95], [0.5, -0.85], [0.6, -1.2], [0.65, -1.42], [0.7, -1.6]];
  const MID = [-0.66, -1.5];
  const shape = (k) => OPEN.map((p, i) => {             // k = 0 open .. 1 pinched: thumb and index tips meet at MID
    if (i === 4 || i === 8) return [p[0] + (MID[0] - p[0]) * k, p[1] + (MID[1] - p[1]) * k];
    if (i === 3 || i === 7) return [p[0] + (MID[0] - p[0]) * k * 0.45, p[1] + (MID[1] - p[1]) * k * 0.45];
    return p;
  });
  const PALM = 0.94;                                     // mean of |0-5|, |0-17|, |5-17| in these units
  // screen CSS px -> 0..1 on the camera picture (the inverse of the app's toScreen)
  const toNorm = (x, y) => { const v = window.__city.view, d = window.devicePixelRatio; return [(x * d / v.s + v.ox) / v.vw, (y * d / v.s + v.oy) / v.vh]; };
  // one hand whose pinch point (thumb/index midpoint) is at (x, y) CSS px, palm size `palm` px, pinch 0..1
  function hand(x, y, palm, k) {
    const sh = shape(k), mid = [(sh[4][0] + sh[8][0]) / 2, (sh[4][1] + sh[8][1]) / 2], P = palm / PALM;
    const lm = sh.map(p => { const n = toNorm(x + (p[0] - mid[0]) * P, y + (p[1] - mid[1]) * P); return [n[0], n[1], 0]; });
    const wl = sh.map(p => [p[0] * 0.085, p[1] * 0.085, 0]);           // metres: palm about 8.5 cm
    return { lm, wl, side: 'Right', score: 0.95 };
  }
  const inject = (hs) => window.__city.injectHands(hs ? { hands: hs } : null);
  const lerp = (a, b, k) => a + (b - a) * k;
  const W = () => innerWidth, H = () => innerHeight;
  let A, B, gA, C, D, gC, gD, tapPin;

  window.__filmSegments = (h) => [
    { name: 'setup', dur: 1.6, capture: false, enter() {
        Object.assign(h.rig, { az: 8, el: 52, dist: 300, tx: 0, ty: 40, tz: 0, shake: 0 });
        h.uiAlpha(1); h.app.settings.hold = false; inject(null);
      }, update() { return { pose: true }; } },
    // pinch at A and bring the hand closer (palm 120 -> 180 px): zoom about 2x, the grabbed point stays under the fingers
    { name: 'zoom', dur: 1.9, enter() { A = [W() * 0.45, H() * 0.5]; gA = null; },
      update(lt) {
        const k = h.smooth((lt - 0.1) / 0.2), m = h.smooth((lt - 0.45) / 1.2);
        inject([hand(A[0], A[1], lerp(120, 180, m), k)]);
        if (!gA && window.__city.grip.n === 1) gA = window.__city.grip.g[0].slice();
        if (lt > 1.85 && !R.zoomDone) {
          R.zoomDone = true;
          const v = window.__city.mapView, want = Math.exp((Math.log(1.5) - 0.08) * 2.2);
          check(Math.abs(v.z - want) / want < 0.08, `zoom by bringing the hand closer: z ${v.z.toFixed(2)} (expected about ${want.toFixed(2)})`);
          const s = window.__city.mapToScreen(gA[0], gA[1]), e = Math.hypot(s[0] - A[0], s[1] - A[1]);
          check(e < 8, `zoom keeps the grabbed point under the fingers (${e.toFixed(1)} px)`);
        }
        return { pose: true };
      } },
    // still pinched, drag from A to B: the map point under the fingers stays under them
    { name: 'drag', dur: 1.6, enter() { B = [W() * 0.6, H() * 0.56]; },
      update(lt) {
        const m = h.smooth((lt - 0.1) / 1.1), p = [lerp(A[0], B[0], m), lerp(A[1], B[1], m)];
        inject([hand(p[0], p[1], 180, 1)]);
        if (lt > 1.55 && !R.dragDone) {
          R.dragDone = true;
          const s = window.__city.mapToScreen(gA[0], gA[1]), e = Math.hypot(s[0] - B[0], s[1] - B[1]);
          check(e < 6, `drag: the grabbed point ends ${e.toFixed(1)} px from the fingers`);
          check(Math.abs(Math.log(window.__city.mapView.z / R.zAfterZoom)) < 0.02 || !R.zAfterZoom, 'dragging sideways does not zoom');
        }
        if (lt < 0.05) R.zAfterZoom = window.__city.mapView.z;
        return { pose: true };
      } },
    { name: 'release', dur: 0.6, update(lt) {
        const k = 1 - h.smooth(lt / 0.2);
        inject(lt < 0.4 ? [hand(B[0], B[1], 180, k)] : []);
        if (lt > 0.55 && !R.relDone) { R.relDone = true; check(window.__city.grip.n === 0, 'letting go releases the map'); }
        return { pose: true };
      } },
    // drag far past the town's edge: the map gives a little, then springs back inside when let go
    { name: 'edge', dur: 2.4, update(lt) {
        const k = lt < 1.5 ? h.smooth((lt - 0.05) / 0.15) : 0, m = h.smooth((lt - 0.25) / 1.0);
        const p = [lerp(W() * 0.3, W() * 0.95, m), H() * 0.5];
        inject(lt < 1.7 ? [hand(p[0], p[1], 150, k)] : []);
        const v = window.__city.mapView, lim = 138.1 * (1 - 1 / v.z);
        if (lt > 1.2 && lt < 1.3 && !R.edge1) { R.edge1 = true; R.over = Math.max(Math.abs(v.cx), Math.abs(v.cz)) - lim; check(R.over > 0.5, `past the edge the map gives a little (${R.over.toFixed(1)} mm)`); }
        if (lt > 2.35 && !R.edge2) { R.edge2 = true; const o = Math.max(Math.abs(v.cx), Math.abs(v.cz)) - lim; check(o < 0.05, `...and springs back when let go (${o.toFixed(2)} mm)`); }
        return { pose: true };
      } },
    // two hands pinch and move apart: the map stretches between them
    { name: 'two', dur: 2.2, enter() { C = [W() * 0.36, H() * 0.52]; D = [W() * 0.64, H() * 0.52]; gC = gD = null; },
      update(lt) {
        const k = h.smooth((lt - 0.1) / 0.2), m = h.smooth((lt - 0.4) / 1.2), sp = lerp(0, 0.12, m) * W();
        const c = [C[0] - sp, C[1]], d = [D[0] + sp, D[1]];
        const lh = hand(c[0], c[1], 110, k); lh.side = 'Left';
        inject([lh, hand(d[0], d[1], 110, k)]);
        if (!gC && window.__city.grip.n === 2) { gC = window.__city.grip.g[0].slice(); gD = window.__city.grip.g[1].slice(); R.z2 = window.__city.mapView.z; }
        if (lt > 2.1 && !R.twoDone && gC) {
          R.twoDone = true;
          const v = window.__city.mapView;
          check(v.z > R.z2 * 1.25, `two hands moving apart zoom in: ${R.z2.toFixed(2)} -> ${v.z.toFixed(2)}`);
          const s1 = window.__city.mapToScreen(gC[0], gC[1]), s2 = window.__city.mapToScreen(gD[0], gD[1]);
          const e = Math.max(Math.hypot(s1[0] - c[0], s1[1] - c[1]), Math.hypot(s2[0] - d[0], s2[1] - d[1]));
          check(e < 10 || v.z >= 4.99, `both grabbed points stay under their hands (${e.toFixed(1)} px)`);
        }
        return { pose: true };
      } },
    { name: 'gap', dur: 0.5, update() { inject([]); return { pose: true }; } },
    // a quick pinch on a gold dot opens that building
    { name: 'tap', dur: 2.0, enter() {
        const pins = window.__city.pins().filter(p => !p.hidden && window.__city.landmarks.find(l => l.id === p.id).model);
        tapPin = pins[0];
        R.tapId = tapPin && tapPin.id;
      }, update(lt) {
        if (!tapPin) { if (!R.tapDone) { R.tapDone = true; check(false, 'a gold dot is visible to tap'); } return { pose: true }; }
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tapPin.tf), x = +m[1], y = +m[2];
        const k = lt < 0.1 ? 0 : lt < 0.35 ? 1 : 0;
        inject(lt < 0.6 ? [hand(x, y, 110, k)] : []);
        if (lt > 1.9 && !R.tapDone) { R.tapDone = true; const c = window.__city.city$; check(c.sel && c.sel.id === tapPin.id && c.mode !== 'town', `quick pinch on ${tapPin.id} opens it (mode ${c.mode})`); }
        return { pose: true };
      } },
    { name: 'back', dur: 2.0, capture: false, enter() { window.__city.goBack(); }, update() { return { pose: true }; } },
    { name: 'whole', dur: 1.0, enter() { document.getElementById('btnMap').click(); },
      update(lt) {
        if (lt > 0.95 && !R.wholeDone) { R.wholeDone = true; const v = window.__city.mapView; check(Math.abs(v.z - 1) < 0.01 && Math.abs(v.cx) < 0.01, `"whole map" goes back to the whole town (z ${v.z.toFixed(2)})`); console.warn('[handtest] RESULT', R.ok ? 'PASS' : 'FAIL'); }
        return { pose: true };
      } },
  ];
})();
