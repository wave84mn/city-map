// Cube tracking off the main thread: OpenCV's ArUco detector + the pose solver, in a module worker.
// The page sends one camera crop at a time and keeps showing that exact frame until its pose comes back,
// so the town never swims against the picture, while the 3D drawing, touches and the hand tracker keep
// the main thread to themselves.
//
// in:  { type: 'init', layout, cvUrl, useCv }
//      { type: 'frame', id, buf (RGBA ArrayBuffer), w, h, roi: {x0, y0, scale}, K, time, hint: {mode, radius} }
// out: { type: 'state', cv: 'off' | 'loading' | 'ready' | 'failed', err?, loadMs? }
//      { type: 'result', id, res, buf }    (buf is handed back to be reused for the next frame)
//      { type: 'error', id, err }
import { Tracker } from './tracker.js';
import { CvDetector, loadOpenCv } from './cvdetect.js';

let tracker = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    tracker = new Tracker(m.layout);
    if (!m.useCv) { self.postMessage({ type: 'state', cv: 'off' }); return; }
    self.postMessage({ type: 'state', cv: 'loading' });
    const t0 = performance.now();
    loadOpenCv(m.cvUrl).then((cv) => {
      tracker.setDetector(new CvDetector(cv, tracker.ids));
      // one empty run, so the first real frame does not pay for OpenCV's first-use setup
      try { tracker.detector.detect(new Uint8ClampedArray(64 * 64 * 4), 64, 64, {}); } catch { /* ignore */ }
      self.postMessage({ type: 'state', cv: 'ready', loadMs: Math.round(performance.now() - t0) });
    }).catch((err) => {
      self.postMessage({ type: 'state', cv: 'failed', err: String((err && err.message) || err) });
    });
    return;
  }
  if (m.type === 'frame') {
    if (!tracker) { self.postMessage({ type: 'error', id: m.id, err: 'not ready' }, [m.buf]); return; }
    try {
      const res = tracker.process(new Uint8ClampedArray(m.buf), m.w, m.h, m.roi, m.K, m.time, m.hint || {});
      res.stats.detector = tracker.detector === tracker.own ? 'own' : 'opencv';
      self.postMessage({ type: 'result', id: m.id, res, buf: m.buf }, [m.buf]);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, err: String((err && err.message) || err), buf: m.buf }, [m.buf]);
    }
  }
};
