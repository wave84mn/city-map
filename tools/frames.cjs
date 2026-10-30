// Screenshots of the grow animation frozen at several points (needs the fake camera, like e2e.cjs).
// usage: node tools/frames.cjs VIDEO.y4m OUTPREFIX BUILDING_ID
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, out, id = 'kula'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`,
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, permissions: ['camera', 'accelerometer', 'gyroscope'] });
  const page = await ctx.newPage();
  const logs = []; page.on('pageerror', e => logs.push(e.message));
  await page.goto('http://localhost:8123/?lang=me');
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 60000 });
  await page.evaluate(() => { window.__city.settings.hold = false; });
  await page.click('#go');
  await page.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 })), 50));
  await page.waitForFunction(() => window.__city.active === 'cube', null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  for (const a of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    await page.evaluate(([id, a]) => window.__city.freeze(id, a), [id, a]);
    await page.waitForTimeout(2500);   // a few (slow) frames
    await page.screenshot({ path: `${out}_${String(a * 100).padStart(3, '0')}.png` });
  }
  console.log(logs.join('\n') || 'no page errors');
  await browser.close();
})();
