// usage: node tools/recover.cjs VIDEO.y4m [query]   (serve the folder on port 8123 first)
// The camera picture stops (Safari pausing the video; the camera ended in the background): does the app recover?
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, query = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['camera'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 200)); });
  await page.goto('http://localhost:8123/' + query);
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 90000 });
  await page.evaluate(() => { window.__city.settings.shadows = false; window.__city.settings.hold = false; });
  await page.click('#go');
  await page.waitForFunction(() => window.__city.active && window.__city.eng.cv === 'ready', null, { timeout: 30000 });
  const st = () => page.evaluate(() => ({ t: (performance.now()/1000).toFixed(1), fps: window.__city.fps.toFixed(1), active: window.__city.active, n: window.__city.eng.n, det: window.__city.eng.kind, paused: document.getElementById('cam').paused, stall: !document.getElementById('stall').hidden, loop: window.__city.eng.loop }));
  let ok = true; const expect = (c, m) => { console.log((c ? 'ok: ' : 'FAIL: ') + m); if (!c) ok = false; };
  // 1) the browser pauses the video
  const s0 = await st(); console.log('before', JSON.stringify(s0)); const n0 = s0.n;
  await page.evaluate(() => document.getElementById('cam').pause());
  await page.waitForTimeout(4000);
  const s1 = await st();
  expect(!s1.paused && s1.n > n0 + 2 && !s1.stall, `paused video is restarted by itself (${JSON.stringify(s1)})`);
  // 2) the camera track ends (phone stopped it while the page was in the background)
  await page.evaluate(() => { const v = document.getElementById('cam'); for (const t of v.srcObject.getTracks()) { t.stop(); t.dispatchEvent(new Event('ended')); } });
  await page.waitForTimeout(5000);
  const s2 = await st();
  const live = await page.evaluate(() => document.getElementById('cam').srcObject.getVideoTracks()[0].readyState);
  expect(live === 'live' && s2.active === 'cube', `ended camera is reopened and the cube found again (${live}, ${JSON.stringify(s2)})`);
  // 3) coming back to the page
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2500);
  const s3 = await st();
  expect(s3.active === 'cube' && !s3.stall, `returning to the page keeps tracking (${JSON.stringify(s3)})`);
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  await browser.close();
})();
