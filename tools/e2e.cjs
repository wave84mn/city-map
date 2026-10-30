// End-to-end test of the city map in Chromium with a fake camera fed from a y4m file.
// usage: node tools/e2e.cjs VIDEO.y4m OUTPREFIX SCRIPT [url-query]
// SCRIPT: 'dwell'  - wait; the ring should choose the building nearest the centre by itself
//         'nohold' - hold-to-choose off: nothing gets chosen; then tap a pin
//         'select' - choose Sahat kula from the list, then the Town button takes you back
//         'flip'   - choose Opština, then the video turns the cube upside down -> back to town
// A steady "phone held upright" tilt reading is sent, as a phone would.
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, out, script = 'dwell', query = ''] = process.argv.slice(2);
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`,
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const vp = (process.env.VP || '390x844').split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: +(process.env.DPR || 1.5), permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://localhost:8123/${query}`);
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 60000 });
  await page.screenshot({ path: `${out}_start.png` });
  if (process.env.NOSHADOW) await page.evaluate(() => { window.__city.settings.shadows = false; });
  if (script === 'nohold') await page.evaluate(() => { window.__city.settings.hold = false; });
  await page.click('#go');
  await page.evaluate(() => {
    setInterval(() => { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 })); }, 50);
  });
  const t0 = Date.now();
  const el = () => (Date.now() - t0) / 1000;
  const state = () => page.evaluate(() => {
    const a = window.__city, c = a.city$;
    const st = a.active ? a.T[a.active] : null;
    return { active: a.active, mode: c.mode, sel: c.sel && c.sel.id, target: c.target && c.target.id, dwell: +c.dwellP.toFixed(2),
      base: a.T.cube.base, sensor: a.sensor.ok, fps: +a.fps.toFixed(1), n: st && st.raw ? st.raw.n : 0,
      pins: a.pins().filter(p => !p.hidden).length, ring: !document.getElementById('ring').hidden, hint: document.getElementById('dockHint').textContent,
      status: document.getElementById('statusText').textContent };
  });
  const samples = [];
  const log = async tag => { const s = await state(); samples.push({ t: el().toFixed(1), tag, ...s }); return s; };
  const shot = async name => page.screenshot({ path: `${out}_${name}.png` });
  const waitMode = async (m, max = 15) => { const e0 = el(); while (el() - e0 < max) { const s = await state(); if (s.mode === m) return true; await page.waitForTimeout(150); } return false; };

  // the town should appear
  for (let i = 0; i < 40; i++) { const s = await state(); if (s.active) break; await page.waitForTimeout(250); }
  await page.waitForTimeout(900);
  await log('town'); await shot('town');
  let ok = true;
  const expect = (cond, msg) => { if (!cond) { ok = false; console.log('FAIL:', msg); } else console.log('ok:', msg); };

  if (script === 'dwell') {
    const s0 = samples[0];                 // recorded before the (slow) screenshot
    expect(s0.active === 'cube' && s0.mode === 'town', 'town shown on the cube');
    expect(s0.pins >= 4, `landmark dots visible (${s0.pins})`);
    expect(s0.ring && !!s0.target, `ring is on a landmark (${s0.target})`);
    const grew = (await state()).mode !== 'town' || await waitMode('grow', 8);
    await log('grow');
    expect(grew, 'holding still on a landmark chooses it');
    await page.waitForTimeout(600); await shot('mid'); await log('mid');
    const done = await waitMode('building', 4); await page.waitForTimeout(400);
    await log('building'); await shot('building');
    expect(done, 'building fills the cube');
  } else if (script === 'nohold') {
    await page.waitForTimeout(4500);
    const s = await log('after 4.5 s');
    expect(s.mode === 'town', 'with hold-to-choose off, nothing is chosen by itself');
    // tap the dot of Vezirova džamija
    const tf = await page.evaluate(() => window.__city.pins().find(p => p.id === 'vezirova'));
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tf.tf || '');
    expect(m && !tf.hidden, 'Vezirova dot is on screen');
    if (m) console.log('element at the dot:', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '#' + e.id + '.' + e.className + ' parent ' + (e.parentElement && (e.parentElement.id || e.parentElement.className)) : null; }, [+m[1], +m[2]]));
    if (m) await page.touchscreen.tap(+m[1], +m[2]);
    const grew = await waitMode('building', 5); await page.waitForTimeout(400);
    const s2 = await log('after tap'); await shot('tapped');
    expect(grew && s2.sel === 'vezirova', 'tapping a dot chooses that building');
    // a dot without a model only shows a note
  } else if (script === 'select') {
    // hold-to-choose is tested in 'dwell'; off here, because this slow test browser would trigger it while waiting
    await page.evaluate(() => { window.__city.settings.hold = false; });
    await page.click('#chips .chip[data-id="sahat"]');
    await page.waitForTimeout(500); await shot('mid'); await log('mid');
    const done = await waitMode('building', 5); await page.waitForTimeout(500);
    const s = await log('building'); await shot('building');
    expect(done && s.sel === 'sahat', 'Sahat kula chosen from the list');
    expect(/E2/.test(s.status), 'status shows the name and jigsaw piece');
    await page.click('#btnInfo'); await page.waitForTimeout(500); await shot('info'); await page.click('#scrim', { position: { x: 20, y: 60 } });
    await page.waitForTimeout(400);
    await page.click('#btnBack');
    await page.waitForTimeout(450); await shot('back_mid');
    const back = await waitMode('town', 4); await page.waitForTimeout(300);
    await log('back'); await shot('back');
    expect(back, 'the Town button goes back to the map');
    // switch language and choose again
    await page.evaluate(() => window.__city.setLang('sq'));
    await page.waitForTimeout(300); await shot('sq');
    const s3 = await log('sq');
    expect(/Gucia/.test(s3.status), 'Albanian status text');
  } else if (script === 'flip') {
    await page.evaluate(() => { window.__city.settings.hold = false; window.__city.select('opstina'); });
    const done = await waitMode('building', 5); await page.waitForTimeout(400);
    const s = await log('building'); await shot('building');
    expect(done && s.sel === 'opstina', 'Opština fills the cube');
    // the video turns the cube upside down at 7 s after the camera started
    const back = await waitMode('shrink', 12);
    await log('flipped'); await page.waitForTimeout(350); await shot('flip_mid');
    const town = await waitMode('town', 4); await page.waitForTimeout(800);
    await log('town again'); await shot('town_again');
    expect(back && town, 'turning the cube upside down goes back to the town');
  }
  console.log(samples.map(s => JSON.stringify(s)).join('\n'));
  const errs = logs.filter(l => /error|pageerror/i.test(l));
  console.log('--- console (' + logs.length + ') ---\n' + logs.slice(0, 25).join('\n'));
  console.log(ok && !errs.length ? 'RESULT: PASS' : 'RESULT: FAIL');
  await browser.close();
})();
