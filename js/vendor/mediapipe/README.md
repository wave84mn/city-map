# MediaPipe Tasks Vision (hand tracking)

Used by `js/hand-worker.js` for "Ruka u zraku / Hand in the air". Apache License 2.0 (see `LICENSE`), © Google LLC.

- `vision_bundle.mjs`: @mediapipe/tasks-vision **0.10.35** (ES module).
- `wasm/vision_wasm_module_internal.js` + `.wasm`: the module build of its WebAssembly runtime (works inside a module worker).
- `../../../models/hand_landmarker.task`: MediaPipe Hand Landmarker model, float16, version 1 (palm detector + 21-point hand landmarks).

The npm registry and Google's model storage were not reachable from the build machine, so the files were taken from
public GitHub projects that ship the same package, and checked by hash: the script and WebAssembly files are identical in
at least three independent copies, and the model matches the SHA-256 recorded for it by 39 other repositories.

| File | SHA-256 |
|---|---|
| vision_bundle.mjs | 55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe |
| wasm/vision_wasm_module_internal.js | 1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44 |
| wasm/vision_wasm_module_internal.wasm | 617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756 |
| models/hand_landmarker.task | fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1 |

To replace them with copies straight from the source: `npm pack @mediapipe/tasks-vision@0.10.35` (files under `package/`)
and https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
