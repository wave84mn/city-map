// usage: node tools/flip.cjs FLIP.y4m [query]   (seq.py flip; serve the folder on port 8123 first)
// Choose Opština, then the camera video turns the cube upside down (7 s into its 12 s loop): back to the town?
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, query = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8123/' + query);
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 90000 });
  await page.evaluate(() => { window.__city.settings.shadows = false; window.__city.settings.hold = false; });
  await page.click('#go');
  await page.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 })), 50));
  await page.waitForFunction(() => window.__city.active === 'cube', null, { timeout: 30000 });
  await page.evaluate(() => window.__city.select('opstina'));
  const seq = []; const t0 = Date.now();
  while (Date.now() - t0 < 26000) {
    const s = await page.evaluate(() => ({ mode: window.__city.city$.mode, base: window.__city.T.cube.base, det: window.__city.eng.kind }));
    const last = seq[seq.length - 1];
    if (!last || last.mode !== s.mode || last.base !== s.base) { seq.push(s); console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(s)); }
    await page.waitForTimeout(150);
  }
  const modes = seq.map(s => s.mode);
  const b = modes.indexOf('building'), k = modes.indexOf('shrink', b), tw = modes.indexOf('town', k);
  const flipped = seq.slice(b).some(s => s.base === 5);
  console.log((b >= 0 ? 'ok: ' : 'FAIL: ') + 'Opština fills the cube');
  console.log((flipped && k > b && tw > k ? 'ok: ' : 'FAIL: ') + 'turning the cube upside down goes back to the town');
  console.log('RESULT:', b >= 0 && flipped && k > b && tw > k ? 'PASS' : 'FAIL');
  await browser.close();
})();
