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
  let A, B, gA, C, D, gC, gD, tapPin, E, holdP;

  window.__filmSegments = (h) => [
    { name: 'setup', dur: 1.6, capture: false, enter() {
        Object.assign(h.rig, { az: 8, el: 52, dist: 300, tx: 0, ty: 40, tz: 0, shake: 0 });
        h.uiAlpha(1); h.app.settings.hold = false; inject(null);
      }, update() { return { pose: true }; } },
    // the hand that holds the cube (from the 7 Nov phone video): the cube is lifted and tilts a little as a hand
    // holds it; thumb and index meet on the cube's front face and the grip loosens and closes again (a quick
    // "pinch") halfway. That hand must not grab, tap or be drawn.
    { name: 'holder', dur: 2.45, enter() { R.hGrabs = 0; R.hOpened = false; R.hDrawn = 0; },
      update(lt) {
        const cst = h.cubeState, wob = lt < 1.9 ? 1 : 1 - h.smooth((lt - 1.9) / 0.4);
        cst.axis.set(1, 0, 0.4).normalize();
        cst.lift = 35 * h.smooth(lt / 0.3) * wob;
        cst.ang = (5 * Math.sin(lt * 4.2) + 3 * Math.sin(lt * 9.1)) * Math.PI / 180 * wob;
        const cs = window.__city.cubeOnScreen();
        if (!cs) { if (!R.hNoCube) { R.hNoCube = true; check(false, 'the cube is on screen for the holder test'); } return { pose: true }; }
        // on the cube's front face: between its centre and its lowest corner on screen
        const d = [cs.c[0] - cs.tc[0], cs.c[1] - cs.tc[1]];
        const low = cs.hull.reduce((m, p) => (p[0] * d[0] + p[1] * d[1] > m[0] * d[0] + m[1] * d[1] ? p : m), cs.hull[0]);
        const P = [cs.c[0] + 0.6 * (low[0] - cs.c[0]), cs.c[1] + 0.6 * (low[1] - cs.c[1])];
        let k = 1;
        if (lt >= 1.0 && !R.hNoise) { R.hNoise = true; k = 0; }      // one noisy 'open' reading, as in the 7 Nov video
        inject(lt < 2.0 ? [hand(P[0], P[1], 0.9 * cs.size, k)] : []);
        if (window.__city.grip.n) R.hGrabs++;
        if (window.__city.city$.mode !== 'town') R.hOpened = true;
        if (window.__city.hands.list.some(x => !x.holder) && lt > 0.5 && lt < 2.0) R.hDrawn++;
        if (lt > 0.8 && !R.h1) {
          R.h1 = true;
          const l = window.__city.hands.list;
          check(window.__city.cubeHeld, 'a lifted, tilting cube counts as held');
          check(l.length === 1 && l[0].holder, 'the hand gripping the cube is recognised as holding it');
          check(window.__city.hintKey === 'handCubeOnly', `the hint says the cube hand doesn't count (${window.__city.hintKey})`);
        }
        if (lt > 2.4 && !R.h2) {
          R.h2 = true;
          check(R.hGrabs === 0, `the cube hand never grabs the map (${R.hGrabs} frames)`);
          check(!R.hOpened, 'the cube hand’s quick re-grip does not open a building');
          check(R.hDrawn === 0, `the cube hand is not drawn over the town (${R.hDrawn} frames as a free hand)`);
          check(window.__city.hintKey === 'handNone', `with no hand in sight the hint asks for one (${window.__city.hintKey})`);
        }
        return { pose: true };
      } },
    // the cube moves (on a lap, 7 Nov video 2) and a free hand, first seen with its fingers open, pinches right over
    // the cube's front on screen: it is not taken for the hand holding the cube, and it takes hold of the map
    { name: 'lap', dur: 2.2, enter() { R.lapP = null; },
      update(lt) {
        const cst = h.cubeState, wob = lt < 1.6 ? 1 : 1 - h.smooth((lt - 1.6) / 0.4);
        cst.axis.set(0.3, 0, 1).normalize();
        cst.lift = 0;
        cst.ang = (4 * Math.sin(lt * 3.3) + 2 * Math.sin(lt * 8.3)) * Math.PI / 180 * wob;
        const cs = window.__city.cubeOnScreen();
        if (!cs) return { pose: true };
        if (!R.lapP) {
          const d = [cs.c[0] - cs.tc[0], cs.c[1] - cs.tc[1]];
          const low = cs.hull.reduce((m, p) => (p[0] * d[0] + p[1] * d[1] > m[0] * d[0] + m[1] * d[1] ? p : m), cs.hull[0]);
          R.lapP = [cs.c[0] + 0.6 * (low[0] - cs.c[0]), cs.c[1] + 0.6 * (low[1] - cs.c[1]), cs.size];
        }
        const k = lt < 0.35 ? 0 : 1;
        inject(lt < 1.2 ? [hand(R.lapP[0], R.lapP[1], 0.9 * R.lapP[2], k)] : []);
        if (lt > 0.9 && !R.lap1) {
          R.lap1 = true;
          const l = window.__city.hands.list;
          check(window.__city.cubeHeld, 'the cube moving on a lap counts as held');
          check(l.length === 1 && !l[0].holder, 'a free hand that showed open fingers is not taken for the cube hand');
          check(window.__city.grip.n === 1, 'its pinch over the cube takes hold of the map');
        }
        return { pose: true };
      } },
    // a free hand above the town that turns up already closed: no grab until it opens its fingers and pinches
    { name: 'closed', dur: 2.4, enter() { E = [W() * 0.5, H() * 0.36]; },
      update(lt) {
        const k = lt < 0.8 ? 1 : lt < 1.1 ? 0 : 1;
        inject(lt < 1.9 ? [hand(E[0], E[1], 130, k)] : []);
        if (lt > 0.7 && !R.c1) { R.c1 = true; check(window.__city.grip.n === 0, 'a hand that turns up already closed does not grab'); check(window.__city.hintKey === 'handSeen', `a free hand is reported as seen (${window.__city.hintKey})`); }
        if (lt > 1.5 && !R.c2) { R.c2 = true; check(window.__city.grip.n === 1, 'once it has opened its fingers, a pinch grabs the map'); check(window.__city.hintKey === 'handHold', `the hint explains dragging (${window.__city.hintKey})`); }
        return { pose: true };
      } },
    // the cube rests on the table again: a free hand pinching over the near part of the town (which on screen covers
    // the cube's front, the same spot as the holder test) does grab the map
    { name: 'near', dur: 1.7, enter() { R.n0 = null; },
      update(lt) {
        const cs = window.__city.cubeOnScreen();
        if (!cs) return { pose: true };
        const d = [cs.c[0] - cs.tc[0], cs.c[1] - cs.tc[1]];
        const low = cs.hull.reduce((m, p) => (p[0] * d[0] + p[1] * d[1] > m[0] * d[0] + m[1] * d[1] ? p : m), cs.hull[0]);
        if (!R.n0) R.n0 = [cs.c[0] + 0.6 * (low[0] - cs.c[0]), cs.c[1] + 0.6 * (low[1] - cs.c[1]), cs.size];
        const k = lt < 0.3 ? 0 : 1;
        inject(lt < 1.2 ? [hand(R.n0[0], R.n0[1], 0.9 * R.n0[2], k)] : []);
        if (lt > 0.9 && !R.n1) {
          R.n1 = true;
          check(!window.__city.cubeHeld, 'a cube resting on the table is not held');
          check(window.__city.grip.n === 1, 'with the cube resting, a pinch over the near part of the town grabs the map');
        }
        return { pose: true };
      } },
    // pinch at A, then spread thumb and index (gap 0 -> 5.2 cm): zoom about 2.2x around the fingers
    { name: 'zoom', dur: 1.9, enter() { A = [W() * 0.45, H() * 0.5]; gA = null; },
      update(lt) {
        const k = lt < 0.1 ? 0 : lt < 0.45 ? h.smooth((lt - 0.1) / 0.2) : lerp(1, 0.35, h.smooth((lt - 0.45) / 1.2));
        inject([hand(A[0], A[1], 140, k)]);
        if (!gA && window.__city.grip.n === 1) gA = window.__city.grip.g[0].slice();
        if (lt > 1.85 && !R.zoomDone) {
          R.zoomDone = true;
          const v = window.__city.mapView, want = Math.exp((Math.log(0.65 * 0.0794 / 0.025) - 0.08) * 1.25);
          check(Math.abs(v.z - want) / want < 0.08, `spreading thumb and index zooms in: z ${v.z.toFixed(2)} (expected about ${want.toFixed(2)})`);
          const s = window.__city.mapToScreen(gA[0], gA[1]), e = Math.hypot(s[0] - A[0], s[1] - A[1]);
          check(e < 8, `the zoom stays centred on the fingers (${e.toFixed(1)} px)`);
          check(window.__city.hintKey === 'handHold', `while holding, the hint explains spreading (${window.__city.hintKey})`);
        }
        return { pose: true };
      } },
    // fingers stay spread, the hand moves from A to B: the map point between the fingers stays between them
    { name: 'drag', dur: 1.6, enter() { B = [W() * 0.6, H() * 0.56]; },
      update(lt) {
        const m = h.smooth((lt - 0.1) / 1.1), p = [lerp(A[0], B[0], m), lerp(A[1], B[1], m)];
        inject([hand(p[0], p[1], 140, 0.35)]);
        if (lt < 0.05) R.zAfterZoom = window.__city.mapView.z;
        if (lt > 1.55 && !R.dragDone) {
          R.dragDone = true;
          const s = window.__city.mapToScreen(gA[0], gA[1]), e = Math.hypot(s[0] - B[0], s[1] - B[1]);
          check(e < 6, `moving the hand moves the map: the held point ends ${e.toFixed(1)} px from the fingers`);
          check(Math.abs(Math.log(window.__city.mapView.z / R.zAfterZoom)) < 0.02, 'moving the hand does not zoom');
        }
        return { pose: true };
      } },
    // the hand holds still: after about a second it lets go and the zoom stays; closing the fingers then does nothing
    { name: 'lock', dur: 2.2, update(lt) {
        const k = lt < 1.5 ? 0.35 : 1;
        inject(lt < 1.9 ? [hand(B[0], B[1], 140, k)] : []);
        if (lt > 1.4 && !R.lock1) { R.lock1 = true; R.zLock = window.__city.mapView.z; check(window.__city.grip.n === 0, 'holding still lets go of the map'); check(Math.abs(R.zLock - R.zAfterZoom) / R.zAfterZoom < 0.02, `the zoom stays when letting go (${R.zLock.toFixed(2)})`); }
        if (lt > 2.15 && !R.lock2) { R.lock2 = true; check(Math.abs(window.__city.mapView.z - R.zLock) / R.zLock < 0.02, 'closing the fingers after letting go does not zoom out'); }
        return { pose: true };
      } },
    // drag far past the town's edge: the map gives a little, then springs back inside when let go
    { name: 'edge', dur: 2.4, update(lt) {
        const k = h.smooth((lt - 0.05) / 0.15), m = h.smooth((lt - 0.25) / 1.0);   // pinch, drag far, take the hand away
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
    { name: 'whole', dur: 1.0, enter() { document.getElementById('btnMap').click(); },
      update(lt) {
        if (lt > 0.95 && !R.wholeDone) { R.wholeDone = true; const v = window.__city.mapView; check(Math.abs(v.z - 1) < 0.01 && Math.abs(v.cx) < 0.01, `"whole map" goes back to the whole town (z ${v.z.toFixed(2)})`); console.warn('[handtest] RESULT', R.ok ? 'PASS' : 'FAIL'); }
        return { pose: true };
      } },
  ];
})();
