"""Xplore Prokletije logo: remove the white background and make a version for dark screens.
usage: python3 logo_prep.py SOURCE.png OUTDIR
Each pixel is split into dark ink + blue ink + white paper (least squares), so the edges stay smooth and
white areas (background, windows, gaps in the QR face) become transparent.
Writes xplore-prokletije-light.png (original colours, for white paper) and
xplore-prokletije-dark.png (dark ink -> warm white, blue a touch lighter, for the app's dark screens).
"""
import os, sys
import cv2, numpy as np

src, out = sys.argv[1], sys.argv[2]
im = cv2.imread(src, cv2.IMREAD_COLOR).astype(np.float32)[..., ::-1]   # RGB
h, w = im.shape[:2]
corners = np.concatenate([im[:20, :20], im[:20, -20:], im[-20:, :20], im[-20:, -20:]]).reshape(-1, 3)
WHITE = corners.mean(0)
DARK = np.array([23, 33, 42], np.float32)       # measured medians
BLUE = np.array([1, 92, 248], np.float32)

M = np.stack([DARK - WHITE, BLUE - WHITE], 1)   # 3x2
P = (im - WHITE).reshape(-1, 3)
ab = P @ np.linalg.pinv(M).T                    # least squares: p - W = a (D - W) + b (B - W)
a, b = np.clip(ab[:, 0], 0, 1), np.clip(ab[:, 1], 0, 1)
s = a + b
over = s > 1
a[over] /= s[over]; b[over] /= s[over]
a = a.reshape(h, w); b = b.reshape(h, w)
alpha = np.clip(a + b, 0, 1)
alpha[alpha < 0.04] = 0                         # paper noise
alpha[alpha > 0.93] = 1                         # solid fills: no speckle
mix = b / np.maximum(a + b, 1e-6)               # share of blue in the ink: snap near-pure areas
b = np.where(mix > 0.9, alpha, np.where(mix < 0.1, 0, b * alpha / np.maximum(a + b, 1e-6)))
a = alpha - b

ys, xs = np.nonzero(alpha > 0.1)
m = int(0.02 * (xs.max() - xs.min()))
x0, x1, y0, y1 = max(0, xs.min() - m), min(w, xs.max() + m + 1), max(0, ys.min() - m), min(h, ys.max() + m + 1)


def render(dark_rgb, blue_rgb, name):
    dk, bl = np.array(dark_rgb, np.float32), np.array(blue_rgb, np.float32)
    al = alpha[..., None]
    rgb = (a[..., None] * dk + b[..., None] * bl) / np.maximum(al, 1e-6)
    rgba = np.concatenate([rgb, al * 255], 2)[y0:y1, x0:x1]
    rgba = np.clip(np.round(rgba), 0, 255).astype(np.uint8)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, name)
    cv2.imwrite(path, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    return path, rgba.shape


print(render(DARK, BLUE, 'xplore-prokletije-light.png'))
print(render((243, 241, 236), (47, 123, 255), 'xplore-prokletije-dark.png'))
