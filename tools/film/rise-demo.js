// A short clip of choosing a building: the map sinks, the floor cracks, Nova džamija pushes up out of it, the name
// sign drops on the side facing the camera, swings over to the next side as the camera goes round, and the
// building sinks back. Run inside the film harness:
//   FILMSEG=tools/film/rise-demo.js node tools/film/film.cjs OUT     (then tools/film/encode.sh OUT)
//   FILMSEG=tools/film/rise-demo.js SHOTS="rise:30,rise:60" node tools/film/film.cjs OUT   (a few frames)
// Checks are printed by the page (console) and kept in window.__riseTest.
(() => {
  const R = window.__riseTest = { log: [], ok: true };
  const check = (cond, msg) => { R.log.push((cond ? 'ok: ' : 'FAIL: ') + msg); if (!cond) R.ok = false; console.warn('[risetest]', (cond ? 'ok: ' : 'FAIL: ') + msg); };
  const ID = window.__riseId || 'radoncica';
  window.__filmSegments = (h) => {
    let around;
    return [
      { name: 'setup', dur: 1.6, capture: false, enter() {
          Object.assign(h.rig, { az: 14, el: 36, dist: 300, tx: 0, ty: 44, tz: 0, shake: 0.6 });
          h.uiAlpha(1); h.app.settings.hold = false;
        }, update() { return { pose: true }; } },
      { name: 'town', dur: 0.9, update(lt) { h.rig.az = 14 + 3 * lt; return { pose: true }; } },
      { name: 'rise', dur: 3.7, enter() {
          h.app.select(ID);
          R.move = h.mover({ ty: 84, el: 27, dist: 330 }, 0.2, 2.2);
        }, update(lt) {
          R.move(lt);
          const c = h.app.city$;
          if (lt > 0.3 && lt < 0.4 && !R.r1) { R.r1 = true; check(c.mode === 'grow', `growing (${c.mode})`); }
          if (lt > 3.0 && !R.r2) {
            R.r2 = true;
            check(c.mode === 'building', `the building stands on the cube (${c.mode})`);
            const p = h.app.plaque; check(p && p.visible && (p.state === 'drop' || p.state === 'shown'), `the name sign is up (${p && p.state})`);
            R.side0 = p && p.side;
          }
          return { pose: true };
        } },
      { name: 'around', dur: 3.6, enter() { around = h.mover({ az: 122, el: 30 }, 0.1, 3.2); },
        update(lt) {
          around(lt);
          const p = h.app.plaque;
          if (p && p.state === 'lift') R.lifted = true;
          if (lt > 3.5 && !R.r3) {
            R.r3 = true;
            check(R.lifted, 'the sign swung up when the camera went round');
            check(p.visible && p.side !== R.side0, `the sign hangs on the side now facing the camera (side ${R.side0} -> ${p.side})`);
          }
          return { pose: true };
        } },
      { name: 'back', dur: 1.9, enter() { h.app.goBack(); },
        update(lt) {
          const c = h.app.city$, p = h.app.plaque;
          if (lt > 0.4 && !R.r4) { R.r4 = true; check(c.mode === 'shrink', `sinking back (${c.mode})`); }
          if (lt > 1.8 && !R.r5) {
            R.r5 = true;
            check(c.mode === 'town', `back to the town (${c.mode})`);
            check(!p.visible, 'the sign is gone');
            console.warn('[risetest] RESULT: ' + (R.ok ? 'PASS' : 'FAIL'));
          }
          return { pose: true };
        } },
    ];
  };
})();
