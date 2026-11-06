// ArUco marker detection with OpenCV.js (Apache 2.0, https://opencv.org), the same open-source detector
// that OpenCV uses in Python and C++. It runs as WebAssembly, so it behaves the same in Safari on iPhone
// and in Chrome on Android. From Gusinjska kocka (bertiscus/gusinjska-kocka, src/ar/cvdetect.js); the
// loader here also works inside a module worker, where the app runs it so the camera picture stays smooth.
//
// Same interface as MarkerDetector.detect(): markers [{ id, corners: [{x, y} x4], hamming, refined }],
// corners in OpenCV's order (top-left, top-right, bottom-right, bottom-left of the marker), which is the
// corner order of data/layout.json.

let loading = null;

// Loads opencv.js once and resolves to the ready `cv` object (or rejects).
// In a page: a <script> tag. In a worker (module workers have no importScripts): fetch the text and run it
// as a classic script with an indirect eval, so it sets globalThis.cv like a script tag would.
export function loadOpenCv(url, timeoutMs = 90000) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const done = (cv) => { clearTimeout(timer); resolve(cv); };
    const fail = (e) => { clearTimeout(timer); loading = null; reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('opencv timeout')), timeoutMs);
    const settle = () => {
      const cv = globalThis.cv;
      if (!cv) return fail(new Error('opencv missing'));
      if (typeof cv.then === 'function') {            // modern builds hand back a promise of the module
        cv.then((m) => { delete m.then; globalThis.cv = m; done(m); }, fail);
        return;
      }
      if (cv.Mat && cv.aruco_ArucoDetector) return done(cv);
      cv.onRuntimeInitialized = () => done(globalThis.cv);
    };
    if (globalThis.cv) { settle(); return; }
    if (typeof document !== 'undefined') {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = settle;
      s.onerror = () => fail(new Error('opencv download failed'));
      document.head.appendChild(s);
    } else {
      fetch(url).then((r) => { if (!r.ok) throw new Error('opencv download ' + r.status); return r.text(); })
        .then((src) => { (0, eval)(src + '\n//# sourceURL=' + url); settle(); })
        .catch(fail);
    }
  });
  return loading;
}

export class CvDetector {
  // cv: the ready OpenCV.js module; ids: the marker ids this app knows (others are ignored)
  constructor(cv, ids) {
    this.cv = cv;
    this.known = new Set(ids);
    this.dict = cv.getPredefinedDictionary(cv.DICT_ARUCO_MIP_36h12);
    this.det = new Map();         // 'search' | 'track' -> ArucoDetector
    this.det.set('search', this._make(5, 21, 8));
    this.det.set('track', this._make(3, 23, 5));
    this.mat = null; this.w = 0; this.h = 0;
    this.corners = new cv.MatVector(); this.ids = new cv.Mat(); this.rej = new cv.MatVector();
    this.stats = { candidates: 0 };
  }

  _make(winMin, winMax, winStep) {
    const cv = this.cv, p = new cv.aruco_DetectorParameters();
    // Threshold windows from fine to coarse: small windows keep the 4 mm gaps between the cube's
    // markers apart, large ones survive dim light and soft focus.
    p.adaptiveThreshWinSizeMin = winMin; p.adaptiveThreshWinSizeMax = winMax; p.adaptiveThreshWinSizeStep = winStep;
    p.minMarkerPerimeterRate = 0.02;       // markers down to ~3 % of the image (cube far away)
    p.minMarkerDistanceRate = 0.025;       // neighbouring markers on one face are close together
    p.minDistanceToBorder = 1;
    p.errorCorrectionRate = 0.6;
    p.perspectiveRemovePixelPerCell = 4;
    p.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX;
    p.cornerRefinementWinSize = 3;
    return new cv.aruco_ArucoDetector(this.dict, p, new cv.aruco_RefineParameters(10, 3, true));
  }

  _alloc(w, h) {
    if (this.mat && w === this.w && h === this.h) return;
    if (this.mat) this.mat.delete();
    this.mat = new this.cv.Mat(h, w, this.cv.CV_8UC1);
    this.w = w; this.h = h;
  }

  // rgba: Uint8ClampedArray (w*h*4). opts.mode: 'search' (whole picture) or 'track' (crop around the cube)
  detect(rgba, w, h, opts = {}) {
    this._alloc(w, h);
    const g = this.mat.data;
    for (let i = 0, j = 0, n = w * h; j < n; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return this._run(opts.mode === 'track' ? 'track' : 'search', opts.scale);
  }

  detectGray(gray, w, h, opts = {}) {
    this._alloc(w, h);
    this.mat.data.set(gray);
    return this._run(opts.mode === 'track' ? 'track' : 'search', opts.scale);
  }

  // scale: processing px per video px. OpenCV puts pixel centres on whole numbers; the caller maps
  // corners back with x0 + x / scale, so shift them by half a pixel to land on the same centres.
  _run(mode, scale = 1) {
    const sh = 0.5 - 0.5 * scale;
    this.det.get(mode).detectMarkers(this.mat, this.corners, this.ids, this.rej);
    const n = this.ids.rows * this.ids.cols, out = [], seen = new Set();
    for (let i = 0; i < n; i++) {
      const id = this.ids.data32S[i];
      if (!this.known.has(id) || seen.has(id)) continue;
      seen.add(id);
      const c = this.corners.get(i), d = c.data32F;
      out.push({ id, hamming: 0, refined: true, corners: [0, 1, 2, 3].map((k) => ({ x: d[2 * k] + sh, y: d[2 * k + 1] + sh })) });
      c.delete();
    }
    this.stats = { candidates: n + this.rej.size(), mode };
    return out;
  }
}
