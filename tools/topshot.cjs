// usage: node tools/topshot.cjs OUT.png cx cz w
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
(async () => {
  const [out, cx = 0, cz = 0, w = 280] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 1400 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8123/tools/topview.html?cx=${cx}&cz=${cz}&w=${w}`);
  await p.waitForFunction(() => window.__done, null, { timeout: 120000 });
  await p.screenshot({ path: out }); await b.close();
})();
