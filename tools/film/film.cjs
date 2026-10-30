// Showcase video of Mapa Gusinja: films the real app, frame by frame, in headless Chromium.
// usage: node tools/film/film.cjs OUTDIR            -> OUTDIR/frames/<segment>/00000.jpg ... (1080x1920, 30 fps)
//        SHOTS="B-town:60,C-choose:120" node ...    -> only those frames, as OUTDIR/preview/<segment>_<frame>.jpg
// Then tools/film/encode.sh OUTDIR joins the segments and adds the music.
// The page is served from the repository folder by a tiny built-in server (port 8124).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'film-out');
const SHOTS = (process.env.SHOTS || '').split(',').filter(Boolean).map(s => { const [n, f] = s.split(':'); return { n, f: +f }; });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8124);

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, hasTouch: true, isMobile: true, locale: 'sr-Latn-ME' });
  await ctx.addInitScript(() => {
    // virtual clock for the app: the director sets it once per frame
    const real = performance.now.bind(performance); let vt = null;
    performance.now = () => (vt == null ? real() : vt);
    performance.__setVT = ms => { vt = ms; };
    try { localStorage.setItem('citymap.lang', 'me'); } catch { /* */ }
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8124/');
  await page.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 120000 });
  await page.addStyleTag({ path: path.join(__dirname, 'film.css') });
  await page.addScriptTag({ type: 'module', url: '/tools/film/director.js' });
  await page.waitForFunction(() => window.__film, null, { timeout: 60000 });
  await page.evaluate(() => window.__film.init());
  const segs = await page.evaluate(() => window.__film.segments);
  const last = SHOTS.length ? Math.max(...SHOTS.map(s => segs.findIndex(g => g.name === s.n))) : segs.length - 1;
  fs.mkdirSync(path.join(OUT, SHOTS.length ? 'preview' : 'frames'), { recursive: true });
  const t0 = Date.now();
  // what happens when, in video time: segment starts and app state changes (for the sound track)
  const events = { segments: [], changes: [] };
  let vframe = 0, prev = '';
  for (let si = 0; si <= last; si++) {
    if (segs[si].capture) events.segments.push({ name: segs[si].name, t: +(vframe / 30).toFixed(3), dur: segs[si].frames / 30 });
    const sg = segs[si], ts = Date.now();
    const dir = path.join(OUT, 'frames', `${String(si).padStart(2, '0')}-${sg.name}`);
    if (!SHOTS.length && sg.capture) fs.mkdirSync(dir, { recursive: true });
    let info;
    for (let i = 0; i < sg.frames; i++) {
      const want = SHOTS.length ? SHOTS.some(s => s.n === sg.name && s.f === i) : sg.capture;
      info = await page.evaluate(([s, k, w]) => window.__film.step(s, k, w), [si, i, want]);
      if (sg.capture) {
        const key = `${info.active}|${info.mode}|${info.sel}`;
        if (key !== prev) { events.changes.push({ t: +(vframe / 30).toFixed(3), seg: sg.name, active: info.active, mode: info.mode, sel: info.sel }); prev = key; }
        vframe++;
      }
      if (!want) continue;
      const file = SHOTS.length ? path.join(OUT, 'preview', `${sg.name}_${i}.jpg`) : path.join(dir, `${String(i).padStart(5, '0')}.jpg`);
      const s0 = Date.now();
      await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
      if (SHOTS.length) console.log('shot', path.basename(file), JSON.stringify(info), 'screenshot', Date.now() - s0, 'ms');
    }
    console.log(`${sg.name}: ${sg.frames} frames${sg.capture ? '' : ' (not filmed)'} in ${((Date.now() - ts) / 1000).toFixed(1)} s · ${JSON.stringify(info)}`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${vframe} frames (${(vframe / 30).toFixed(2)} s)`);
  if (!SHOTS.length) fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1));
  if (process.env.BENCH) {
    // a few drawn frames under different settings, continuing from where the shots stopped
    const si = last, sg = segs[si];
    let k = Math.max(...SHOTS.map(s => s.f)) + 1;
    const run = async label => {
      const ts = [];
      for (let j = 0; j < 4; j++, k++) {
        const a = Date.now(); await page.evaluate(([s, i]) => window.__film.step(s, i, true), [si, k]);
        const b = Date.now(); await page.screenshot({ path: path.join(OUT, 'preview', `bench_${label}_${j}.jpg`), type: 'jpeg', quality: 92 });
        ts.push([b - a, Date.now() - b]);
      }
      console.log(label, JSON.stringify(ts));
    };
    await run('base');
    await page.addStyleTag({ content: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' });
    await run('noblur');
    await page.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { get: () => 2, configurable: true }); window.dispatchEvent(new Event('resize')); });
    await run('dpr2');
    await page.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { get: () => 1.5, configurable: true }); window.dispatchEvent(new Event('resize')); });
    await run('dpr1.5');
  }
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
