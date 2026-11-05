// From Gusinjska kocka (bertiscus/gusinjska-kocka, src/ar/calib.js), unchanged.
// Camera field of view learned from the cube itself, and pose quality judged relative to the cube's size.
// Phones differ a lot: some give the browser a cropped (zoomed) camera picture, some a wide one.
// When two or more faces are visible, the right field of view is the one that makes the rigid cube fit best.
import { refinePose, reprojErrors } from './pose.js';

export const FOV_MIN = 15, FOV_MAX = 90;

export function intrinsicsFor(fov, vw, vh) {
  const f = (Math.max(vw, vh) / 2) / Math.tan(fov * Math.PI / 360);
  return { fx: f, fy: f, cx: vw / 2, cy: vh / 2, vw, vh };
}

// RMS reprojection error (px) of the best pose for one field of view, starting from a pose found with K0.
export function rmsForFov(fov, R, t, K0, obj, img) {
  const K = intrinsicsFor(fov, K0.vw, K0.vh), s = K.fx / K0.fx;
  const p = refinePose(R, [t[0] * s, t[1] * s, t[2] * s], obj, img, K, { iters: 12 });
  const e = reprojErrors(p.R, p.t, K, obj, img);
  return Math.sqrt(e.reduce((a, x) => a + x * x, 0) / e.length);
}

// Field of view (degrees) that fits these correspondences best, or null when the fit is not informative.
export function estimateFov(R, t, K0, obj, img) {
  let lo = FOV_MIN, hi = FOV_MAX;
  const g = 0.381966;
  let a = lo + g * (hi - lo), b = hi - g * (hi - lo);
  let fa = rmsForFov(a, R, t, K0, obj, img), fb = rmsForFov(b, R, t, K0, obj, img);
  for (let i = 0; i < 18; i++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = lo + g * (hi - lo); fa = rmsForFov(a, R, t, K0, obj, img); }
    else { lo = a; a = b; fa = fb; b = hi - g * (hi - lo); fb = rmsForFov(b, R, t, K0, obj, img); }
  }
  const fov = (lo + hi) / 2;
  if (fov < FOV_MIN + 1 || fov > FOV_MAX - 1) return null;          // ran into the limits: not trustworthy
  return { fov, rms: Math.min(fa, fb) };
}

// Is a solved pose good enough to show? Close up, a few pixels of error are invisible, so the limit
// grows with the size of the cube on screen.
export function poseIsGood(p, sizeMm, K) {
  if (!p || p.ambiguous) return false;
  const sizePx = sizeMm * K.fx / Math.max(50, p.t[2]);
  return p.rms < 3.5 || p.rms < (p.n >= 2 ? 0.045 : 0.02) * sizePx;
}

export const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
