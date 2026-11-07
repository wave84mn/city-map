// Hand tracking in a worker, so the camera picture and the map keep their frame rate.
// MediaPipe Hand Landmarker (tasks-vision 0.10.35, vendored in js/vendor/mediapipe; model in models/).
// Messages in:  {type:'init', wasm, model, delegate}  {type:'frame', bitmap, t, id}
// Messages out: {type:'ready', delegate}  {type:'error', msg}  {type:'result', id, t, ms, hands:[{lm, wl, side, score}]}
import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

let hl = null, lastT = -1;

async function create(fileset, model, delegate) {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numHands: 2,
    // a little below the defaults: a found hand stays tracked while part of it leaves the picture
    minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.35,
  });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const fileset = await FilesetResolver.forVisionTasks(m.wasm, true);    // module build: works inside a module worker
      let delegate = m.delegate === 'CPU' ? 'CPU' : 'GPU';
      try { hl = await create(fileset, m.model, delegate); } catch { delegate = 'CPU'; hl = await create(fileset, m.model, 'CPU'); }
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', msg: String((err && err.message) || err) });
    }
  } else if (m.type === 'frame') {
    const t0 = performance.now();
    let hands = [];
    try {
      const t = Math.max(m.t, lastT + 1); lastT = t;                         // timestamps must keep rising
      const r = hl.detectForVideo(m.bitmap, t);
      hands = r.landmarks.map((lm, i) => ({
        lm: lm.map(p => [p.x, p.y, p.z]),
        wl: (r.worldLandmarks[i] || []).map(p => [p.x, p.y, p.z]),
        side: r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].categoryName : '',
        score: r.handedness[i] && r.handedness[i][0] ? r.handedness[i][0].score : 0,
      }));
    } catch (err) {
      self.postMessage({ type: 'error', msg: String((err && err.message) || err) });
    }
    m.bitmap.close();
    self.postMessage({ type: 'result', id: m.id, t: m.t, ms: performance.now() - t0, hands });
  }
};
