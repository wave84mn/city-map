# Mapa Gusinja – Gusinje city map on the AR cube

Hold the printed AR cube in front of your phone and the town of Gusinje stands on it. Aim the ring at a building and hold still, or tap its dot, and the building rises out of the map and grows until it fills the cube. Turn the cube upside down (or tap **Grad / Town**) to go back to the map.

**Open:** https://wave84mn.github.io/city-map/ (Chrome on Android, Safari on iPhone; the page must be opened over https for the camera).

## How it plays
- **Town on the cube.** The town is the 3D Gusinje jigsaw map (1:4500, ground ×2.5, landmarks ×2.5), about twice as wide as the cube by default (*Settings → Town size*). Its south edge turns towards you when the cube is first found. Whichever cube face points up carries the town (phone tilt sensor).
- **Dots.** Gold dots are buildings with a detailed model; white dots are other landmarks (name only, model later).
- **Choosing.** The ring in the middle snaps to the nearest dot and shows its name. Hold the cube steady with a gold dot inside the ring for 1.4 s and the building is chosen. Holding only counts while the cube is still; there is a 2 s pause after the town appears, and the building you just left can't be chosen again until the ring has moved off it. You can also tap a dot or a name in the list at the bottom. *Settings → Choose by holding still* turns holding off.
- **Building.** The town sinks into the cube while the building rises from its spot and grows to fill the cube, door towards you. Buttons: back to town, turn 90°, face me, about (names in all three languages and its jigsaw piece code; the short story comes later).
- **Back.** Turn the cube upside down (two quarter-rolls within 2.5 s count too), or tap the back button. Turning it over during the grow reverses it.
- **Languages:** Montenegrin/Bosnian, Albanian, English (ME / SQ / EN). The first visit follows the phone's language.
- Works with the printed 70 mm cube, the 60 mm paper cube or the flat paper card (same marker codes as ar-cube).

## Buildings on the map
| Dot (jigsaw piece) | Model |
|---|---|
| Kula Rašića (E4) | kula-rasica |
| Sahat kula (E2) | sahat-kula |
| Kula Nekovića (E3), across the bridge from Sahat kula | kula-nekovica |
| Opština (E4) | opstina |
| Vezirova džamija (D4) | vezirova-dzamija |
| Sebilj (D4), on the little square beside Vezirova | sebilj |
| Čekića džamija (F6) | cekica-dzamija |
| Crkva sv. Đorđa (C5) | sv-djordje |
| Radončića džamija (F4), Balića kuća (E3), Groblje (B3), Sportski tereni (D2), Titex (D2) | name only, no model yet |

Crkva sv. Antona is outside the map area (west, towards Grebaje), so it has no dot.

## Files
- `index.html`, `css/app.css`, `js/app.js`: the app. `js/i18n.js`: all texts in three languages.
- `js/cv/`: marker detector, pose solver and tracker from **ar-cube** (wave84mn/ar-cube), unchanged. `data/layout.json`: the cube's marker layout (same as ar-cube).
- `data/town.glb`: the 64 jigsaw pieces from **Slagalica Gusinje** (wave84mn/gusinje-slagalica, `data/pieces.glb`): millimetres, Y up, −Z north, vertex colours (alpha 128 marks water), meshopt-compressed, about 0.27 M triangles.
- `data/city.json`: the 11 landmarks (names in three languages, jigsaw piece, position on the map in mm) and which model belongs to each.
- `models/<id>.json` + `.jpg`: building models from **Gusinjska kocka** (bertiscus/gusinjska-kocka), GKM1 format (quantized mesh as base64 JSON) with a 1024 px baked texture; Y up, base at y = 0, door towards +Z.
- `print/`: the cube print files and the paper cube/card PDF (from ar-cube).
- `js/vendor/three`: three.js r184 (MIT).

## Adding a building
1. Make the model with Gusinjska kocka's `tools/convert.py` and copy `<id>.json` and `<id>.jpg` into `models/`.
2. In `data/city.json`, add `"model": "<id>"` to its landmark (or add a new landmark with `id`, `piece`, `name` {me, sq, en} and `pos` [x, y, z] in map millimetres; x east, z south, y a little above the roof).

## Tests (tools/)
Run from a working folder that has ar-cube's `build/` (layout and face images, from `layout.py`):
- `seq.py still|flip|orbit OUT.y4m`: synthetic camera video of the cube (uses `synth.py` from ar-cube).
- `e2e.cjs VIDEO.y4m OUT dwell|nohold|select|flip`: runs the app in Chromium with that video as the camera and a simulated tilt sensor: hold-to-choose, tapping a dot, the list + back button + language switch, and turning the cube upside down.
- `frames.cjs VIDEO.y4m OUT <landmark>`: screenshots of the grow animation frozen at 0–100 %.
- `topview.html?cx=&cz=&w=` (with `topshot.cjs OUT.png cx cz w`): the map from above with a millimetre grid and the dots, for finding where a new landmark goes. In the app, `__city.probe(x, z)` gives the map height and jigsaw piece at a spot.
Serve the folder first, e.g. `python3 -m http.server 8123`.

Map data © OpenStreetMap contributors (ODbL). Terrain: Copernicus DEM. three.js (MIT); marker pipeline adapted from js-aruco / js-aruco2 (MIT).
