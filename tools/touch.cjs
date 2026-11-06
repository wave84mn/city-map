// usage: node tools/touch.cjs VIDEO.y4m [query]   (seq.py still; serve the folder on port 8123 first)
// Fingers on the screen: two fingers zoom the map (the touched points stay under the fingers), one finger slides
// it, "Whole map" brings it back, a tap on a dot opens the building, a drag that starts on a dot does not, and
// the mouse wheel zooms. Also: tracking details are not remembered.
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, query = '?hands=off'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'], isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const cdp = await ctx.newCDPSession(page);
  let ok = true; const expect = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) ok = false; };
  const touchEv = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) });
  const mapAt = p => page.evaluate(p => { const a = window.__city, h = a.planeHit(p); return h ? a.localToMap(h[0], h[1]) : null; }, p);
  const view = () => page.evaluate(() => ({ z: +window.__city.mapView.z.toFixed(3), cx: +window.__city.mapView.cx.toFixed(1), cz: +window.__city.mapView.cz.toFixed(1), mode: window.__city.city$.mode }));

  await page.goto('http://localhost:8123/' + query + '&debug');
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 90000 });
  await page.evaluate(() => { window.__city.settings.shadows = false; window.__city.settings.hold = false; });
  await page.click('#go');
  await page.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 })), 50));
  await page.waitForFunction(() => window.__city.active === 'cube' && window.__city.eng.kind === 'worker', null, { timeout: 40000 });
  await page.waitForTimeout(2000);

  // the town's centre on screen
  const c = await page.evaluate(() => { const a = window.__city, r = document.getElementById('gl').getBoundingClientRect(); return [r.width / 2, r.height * 0.5]; });
  const box = await page.evaluate(() => { const ps = [...document.querySelectorAll('#pins .pin')].filter(b => !b.hidden).map(b => b.getBoundingClientRect()); return ps.map(r => [r.x + r.width / 2, r.y + r.height / 2]); });
  // pick a spot on the map without a dot nearby for the gestures
  const free = (p, r = 40) => !box.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r);
  let A = [c[0] - 45, c[1] + 40], B = [c[0] + 45, c[1] + 40];
  for (const dy of [40, 70, 100, -60, 130]) { A = [c[0] - 45, c[1] + dy]; B = [c[0] + 45, c[1] + dy]; if (free(A) && free(B)) break; }

  // 1) pinch out
  const gA = await mapAt(A), gB = await mapAt(B);
  const v0 = await view();
  await touchEv('touchStart', [A, B]);
  const A2 = [A[0] - 60, A[1]], B2 = [B[0] + 60, B[1]];   // a straight spread (the map does not turn with the fingers; the cube turns it)
  for (let i = 1; i <= 10; i++) {
    const k = i / 10;
    await touchEv('touchMove', [[A[0] + (A2[0] - A[0]) * k, A[1] + (A2[1] - A[1]) * k], [B[0] + (B2[0] - B[0]) * k, B[1] + (B2[1] - B[1]) * k]]);
    await page.waitForTimeout(40);
  }
  const v1 = await view();
  const hA = await mapAt(A2), hB = await mapAt(B2);
  await touchEv('touchEnd', []);
  const err = Math.max(Math.hypot(hA[0] - gA[0], hA[1] - gA[1]), Math.hypot(hB[0] - gB[0], hB[1] - gB[1]));
  expect(v1.z > 2 && v1.z <= 5.001, `two fingers spread: zoom ${v0.z} -> ${v1.z}`);
  expect(err < 4, `the touched map points stay under the fingers (off by ${err.toFixed(1)} mm of map)`);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => !document.getElementById('btnMap').hidden), '"Whole map" button shows');

  // 2) one finger slides the zoomed map
  const v2 = await view(), S = [c[0], c[1] + 60];
  await touchEv('touchStart', [S]);
  for (let i = 1; i <= 8; i++) { await touchEv('touchMove', [[S[0] + 9 * i, S[1] - 4 * i]]); await page.waitForTimeout(30); }
  await touchEv('touchEnd', []);
  await page.waitForTimeout(700);
  const v3 = await view();
  expect(Math.hypot(v3.cx - v2.cx, v3.cz - v2.cz) > 3 && Math.abs(v3.z - v2.z) < 0.01, `one finger slides the map (${v2.cx},${v2.cz} -> ${v3.cx},${v3.cz}), zoom unchanged`);

  // 3) Whole map
  await page.tap('#btnMap');
  await page.waitForTimeout(1500);
  expect((await view()).z < 1.01, '"Whole map" goes back to the whole town');

  // 4) a drag that starts on a dot does not open it
  const pins = await page.evaluate(() => [...document.querySelectorAll('#pins .pin.m')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }).filter(p => p[1] > 120 && p[1] < 700));
  const P = pins[0];
  await touchEv('touchStart', [P]);
  for (let i = 1; i <= 6; i++) { await touchEv('touchMove', [[P[0] + 10 * i, P[1] + 6 * i]]); await page.waitForTimeout(30); }
  await touchEv('touchEnd', []);
  await page.waitForTimeout(900);
  expect((await view()).mode === 'town', 'dragging from a dot does not open its building');

  // 5) wheel zoom (computer)
  await page.mouse.move(c[0], c[1] + 60);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  const v5 = await view();
  expect(v5.z > 1.5, `mouse wheel zooms in (${v5.z})`);
  await page.tap('#btnMap').catch(() => {}); await page.waitForTimeout(1500);

  // 6) a tap on a dot still opens the building
  const pins2 = await page.evaluate(() => [...document.querySelectorAll('#pins .pin.m')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }).filter(p => p[1] > 120 && p[1] < 700));
  await touchEv('touchStart', [pins2[0]]); await page.waitForTimeout(60); await touchEv('touchEnd', []);
  await page.waitForTimeout(1500);
  expect((await view()).mode !== 'town', `a tap on a dot opens its building (${(await view()).mode})`);

  // 7) tracking details are not remembered
  const stored = await page.evaluate(() => { window.__city.settings.town = window.__city.settings.town; document.getElementById('rngTown').dispatchEvent(new Event('input')); return localStorage.getItem('citymap.settings'); });
  expect(stored && !/"debug"/.test(stored), 'settings are saved without the tracking-details switch');
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await browser.close();
})();
