/* Xplore Prokletije: the button back to the main page, https://gsgsgs84.github.io/xplore-prokletije/
   The same file in every Xplore Prokletije app (source: gsgsgs84/xplore-prokletije, shared/xplore-home.js).
   Put <a class="xp-home"></a> where the button should be (add class "xp-float" to pin it to the top-left corner
   of its container); this script draws it, styles it and keeps the link in the page's language
   (<html lang>, else ?lang=). */
(() => {
  const HOME = 'https://gsgsgs84.github.io/xplore-prokletije/';
  const LABEL = { me: 'Sve aplikacije Xplore Prokletije', sq: 'Të gjitha aplikacionet Xplore Prokletije', en: 'All Xplore Prokletije apps' };
  const EMBLEM = '<svg class="xp-emb" viewBox="6 6 526 462" aria-hidden="true"><path fill="#1d1f22" fill-rule="evenodd" d="M327 295 316 298 310 305 307 314 308 381 342 370 342 311 336 300ZM420 232 417 235 417 248 424 249 424 234ZM369 228 367 230 367 244 374 246 374 232 372 228ZM303 222 300 225 300 240 307 241 308 225ZM411 160 408 163 408 176 414 178 415 163ZM356 150 354 153 354 169 362 170 362 154 360 150ZM296 140 293 144 293 158 302 161 303 144ZM252 89 252 392 262 396 282 388 282 315 284 303 296 280 314 269 328 268 336 270 346 276 356 288 363 312 364 364 458 336 452 128ZM418 222 425 223 431 231 430 259 410 256 410 232 412 226ZM367 217 376 219 381 225 381 255 359 253 359 226ZM299 210 308 211 316 218 316 252 290 249 290 220ZM406 149 416 150 422 158 422 189 399 185 399 158ZM352 139 362 139 370 147 372 156 371 181 345 177 345 149ZM292 128 304 130 312 139 313 173 283 168 283 140 286 132ZM474 121 275 10 78 130 245 74Z"/><path fill="#1a66f0" fill-rule="evenodd" d="M295 428 260 427 259 462 294 462ZM11 342 243 444 242 420 54 342 85 328 86 311ZM526 335 467 311 467 327 497 340 497 342 310 420 310 445 526 349ZM96 306 95 335 118 344 119 310ZM137 257 136 288 161 291 162 304 160 307 158 307 131 302 131 348 161 360 162 323 182 326 183 368 234 386 235 336 184 326 183 294 161 290 161 257ZM98 252 96 289 124 292 126 252ZM204 209 204 244 173 247 174 278 203 282 204 316 234 320 235 265 205 263 204 246 234 244 234 208ZM156 153 120 162 120 207 157 201ZM233 145 194 156 194 197 234 191ZM182 114 99 140 97 238 182 232ZM170 134 170 216 108 222 110 150ZM233 96 202 106 202 140 234 131Z"/></svg>';
  const CSS = '.xp-home{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 13px 0 8px;border-radius:999px;' +
    'background:rgba(255,255,255,.95);color:#17222a;text-decoration:none;font:700 15px/1 "Golos Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'letter-spacing:.01em;box-shadow:0 6px 18px -6px rgba(0,0,0,.4),0 0 0 1px rgba(23,34,42,.08);-webkit-tap-highlight-color:transparent;' +
    'transition:transform .2s ease,box-shadow .2s ease;white-space:nowrap;flex:none;pointer-events:auto}' +
    '.xp-home:hover{transform:translateY(-1px);box-shadow:0 10px 22px -8px rgba(0,0,0,.45),0 0 0 1px rgba(23,34,42,.1)}.xp-home:active{transform:scale(.96)}' +
    '.xp-home:focus-visible{outline:3px solid #005af7;outline-offset:2px}' +
    '.xp-home .xp-chev{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}' +
    '.xp-home .xp-emb{width:29px;height:26px;display:block}' +
    '.xp-float{position:absolute;z-index:30;top:calc(var(--xp-top,12px) + env(safe-area-inset-top,0px));left:calc(var(--xp-left,12px) + env(safe-area-inset-left,0px))}';
  const lang = () => {
    const h = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    const q = (new URLSearchParams(location.search).get('lang') || '').toLowerCase();
    for (const v of [h, q]) { if (v.startsWith('sq')) return 'sq'; if (v.startsWith('en')) return 'en'; if (/^(me|sr|bs|hr|cnr)/.test(v)) return 'me'; }
    return 'me';
  };
  const update = () => {
    const l = lang();
    for (const a of document.querySelectorAll('a.xp-home')) { a.href = HOME + '?lang=' + l; a.setAttribute('aria-label', LABEL[l]); a.title = LABEL[l]; }
  };
  const init = () => {
    if (!document.getElementById('xp-home-css')) {
      const st = document.createElement('style'); st.id = 'xp-home-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    for (const a of document.querySelectorAll('a.xp-home')) {
      if (!a.dataset.xpDone) {
        a.innerHTML = '<svg class="xp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' + EMBLEM + '<span>Xplore</span>';
        a.dataset.xpDone = '1'; a.hidden = false;
      }
    }
    update();
    new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
