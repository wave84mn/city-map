// Lens search test (tools/test-lens.cjs): needs tele.webm and main.webm in /home/claude/work/lens (seq.py --fov 23, then ffmpeg -c:v libvpx).
// Lens search test: two fake back cameras, the default one narrow (like a telephoto), the other normal.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const roots = { '/lens/': '/home/claude/work/lens/', '/': '/home/claude/city-map/' };
const T = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.webm': 'video/webm' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const k = Object.keys(roots).find(r => u.startsWith(r)); const f = path.join(roots[k], u.slice(k.length)); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(8127);
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, permissions: ['accelerometer', 'gyroscope'], hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    const cams = [
      { deviceId: 'tele', kind: 'videoinput', label: 'camera2 3, facing back', groupId: 'g', src: '/lens/tele.webm' },
      { deviceId: 'front', kind: 'videoinput', label: 'camera2 1, facing front', groupId: 'g', src: '/lens/tele.webm' },
      { deviceId: 'main', kind: 'videoinput', label: 'camera2 5, facing back', groupId: 'g', src: '/lens/main.webm' },
    ];
    window.__opened = [];
    navigator.mediaDevices.enumerateDevices = async () => cams.map(c => ({ deviceId: c.deviceId, kind: c.kind, label: c.label, groupId: c.groupId, toJSON() { return this; } }));
    navigator.mediaDevices.getUserMedia = async (c) => {
      const want = c.video && c.video.deviceId && c.video.deviceId.exact;
      const cm = cams.find(x => x.deviceId === want) || cams[0];       // like Chrome on the user's phone: the narrow one by default
      window.__opened.push(cm.deviceId);
      const v = document.createElement('video'); v.src = cm.src; v.loop = true; v.muted = true; v.playsInline = true;
      v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px'; document.body.append(v);
      await v.play();
      const st = v.captureStream(30), tr = st.getVideoTracks()[0];
      const stop = tr.stop.bind(tr);
      tr.stop = () => { stop(); v.pause(); v.remove(); };
      tr.getSettings = () => ({ deviceId: cm.deviceId, width: v.videoWidth, height: v.videoHeight });
      tr.getCapabilities = () => ({});
      Object.defineProperty(tr, 'label', { get: () => cm.label });
      return st;
    };
  });
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await p.goto('http://localhost:8127/?hands=off&debug');
  await p.waitForFunction(() => window.__city && window.__city.townInfo, null, { timeout: 90000 });
  await p.click('#go');
  await p.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 70, gamma: 0 })), 100));
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 150000) {
    const s = await p.evaluate(() => ({ cam: window.__city.cam.label, fov: window.__city.fov, opened: window.__opened.join('>'), toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '', lenses: localStorage.getItem('citymap.lenses'), camId: JSON.parse(localStorage.getItem('citymap.settings') || '{}').camId, btn: !document.getElementById('btnCam').hidden && document.getElementById('camNo').textContent }));
    const line = JSON.stringify(s);
    if (line !== last) { console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', line); last = line; }
    if (s.camId === 'main' && s.fov.source === 'learned' && s.fov.value > 50) break;
    await p.waitForTimeout(2000);
  }
  await p.screenshot({ path: 'end.png' });
  console.log(logs.slice(0, 8).join('\n'));
  await b.close(); srv.close();
})();
