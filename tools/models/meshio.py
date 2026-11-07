"""Shared helpers: OBJ loading, texture sampling, quick preview renders."""
import numpy as np
import cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None


def load_obj(path):
    vs, vts, fv, ft = [], [], [], []
    with open(path, 'r', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                p = line.split(); vs.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith('vt '):
                p = line.split(); vts.append((float(p[1]), float(p[2])))
            elif line.startswith('f '):
                idx = [q.split('/') for q in line.split()[1:]]
                vv = [int(a[0]) for a in idx]
                tt = [int(a[1]) if len(a) > 1 and a[1] else 0 for a in idx]
                for k in range(1, len(vv) - 1):
                    fv.append((vv[0], vv[k], vv[k + 1])); ft.append((tt[0], tt[k], tt[k + 1]))
    V = np.array(vs, np.float64)
    VT = np.array(vts, np.float64) if vts else np.zeros((1, 2))
    F = np.array(fv, np.int64); FT = np.array(ft, np.int64)
    F = np.where(F < 0, F + len(V) + 1, F) - 1
    FT = np.where(FT < 0, FT + len(VT) + 1, FT) - 1
    return V, VT, F, FT


def load_texture(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)  # BGR uint8
    if img is None:
        img = np.array(Image.open(path).convert('RGB'))[:, :, ::-1].copy()
    return img


def sample_texture(img, uv):
    """Bilinear sample BGR texture at OBJ uv (v up). Returns float32 RGB 0..1."""
    h, w = img.shape[:2]
    x = (uv[:, 0] % 1.0) * w - 0.5
    y = (1.0 - (uv[:, 1] % 1.0)) * h - 0.5
    n = len(x); W = 2048
    rows = (n + W - 1) // W
    mx = np.zeros(rows * W, np.float32); my = np.zeros(rows * W, np.float32)
    mx[:n] = x; my[:n] = y
    chunks = []
    step = 8192  # rows per remap call (< SHRT_MAX)
    mx = mx.reshape(rows, W); my = my.reshape(rows, W)
    for s in range(0, rows, step):
        c = cv2.remap(img, mx[s:s + step], my[s:s + step], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
        chunks.append(c.reshape(-1, 3))
    out = np.concatenate(chunks)[:n].astype(np.float32)[:, ::-1] / 255.0
    return out


def weld(V, F, tol_rel=1e-7):
    """Merge vertices at (nearly) the same position."""
    ext = np.ptp(V, axis=0).max() or 1.0
    key = np.round(V / (ext * tol_rel)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    V2 = V[first]
    F2 = inv[F]
    keep = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])
    return V2, F2[keep], keep


def render_views(V, F, face_rgb, out_path, size=360, title=None):
    """Orthographic painter's-algorithm views: front(+Z), right(+X), back(-Z), left(-X), top(+Y).
    Y is up. Face colours shaded by a simple light."""
    views = {
        'front +Z': (np.array([0, 0, 1.]), np.array([0, 1., 0])),
        'right +X': (np.array([1., 0, 0]), np.array([0, 1., 0])),
        'back -Z': (np.array([0, 0, -1.]), np.array([0, 1., 0])),
        'left -X': (np.array([-1., 0, 0]), np.array([0, 1., 0])),
        'top +Y': (np.array([0, 1., 0]), np.array([0, 0, -1.])),
    }
    c = (V.min(0) + V.max(0)) / 2
    R = np.linalg.norm(V.max(0) - V.min(0)) / 2 * 1.05
    a, b, cc = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, cc - a); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    light = np.array([-0.4, 0.8, 0.45]); light /= np.linalg.norm(light)
    shade = 0.55 + 0.45 * np.clip(n @ light, 0, 1)
    col = np.clip(face_rgb * shade[:, None], 0, 1)
    tiles = []
    for name, (d, up) in views.items():
        right = np.cross(up, d); right /= np.linalg.norm(right)
        up2 = np.cross(d, right)
        P = V - c
        x = (P @ right / R * 0.5 + 0.5) * size
        y = (0.5 - P @ up2 / R * 0.5) * size
        z = P @ d
        fz = z[F].mean(1)
        order = np.argsort(fz)  # far first (smaller along view dir = further from viewer)
        img = np.full((size, size, 3), 235, np.uint8)
        pts = np.stack([x[F], y[F]], -1)
        for i in order:
            if n[i] @ d <= 0:
                continue
            cv2.fillConvexPoly(img, np.round(pts[i] * 4).astype(np.int32), tuple(int(v * 255) for v in col[i][::-1]), lineType=cv2.LINE_AA, shift=2)
        cv2.putText(img, name, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1, cv2.LINE_AA)
        tiles.append(img)
    sheet = np.concatenate(tiles, axis=1)
    if title:
        bar = np.full((34, sheet.shape[1], 3), 255, np.uint8)
        cv2.putText(bar, title, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 20, 20), 1, cv2.LINE_AA)
        sheet = np.concatenate([bar, sheet], axis=0)
    cv2.imwrite(out_path, sheet)
