"""Read the app's GKM1 models (models/<id>.json + .jpg): positions, UVs or colours, normals, triangles."""
import base64, json, struct
import numpy as np
import cv2


def read(path):
    b = base64.b64decode(json.load(open(path))['data'])
    hl = struct.unpack('<I', b[4:8])[0]; h = json.loads(b[8:8 + hl]); off = 8 + hl
    def take(dt, n, size):
        nonlocal off
        a = np.frombuffer(b, dt, n, off); off += -(-n * size // 4) * 4; return a
    qp = take('<u2', h['nv'] * 3, 2).reshape(-1, 3)
    qu = None if h.get('col') else take('<u2', h['nv'] * 2, 2).reshape(-1, 2)
    qc = take('u1', h['nv'] * 4, 1).reshape(-1, 4) if h.get('col') else None
    qn = take('i1', h['nv'] * 4, 1).reshape(-1, 4)
    idx = take('<u4' if h['idx32'] else '<u2', h['nf'] * 3, 4 if h['idx32'] else 2).reshape(-1, 3).astype(np.int64)
    lo = np.array(h['min']); hi = np.array(h['max'])
    V = lo + qp / 65535 * (hi - lo)
    UV = None if qu is None else qu / 65535
    C = None if qc is None else qc[:, :3] / 255
    N = qn[:, :3] / 127
    return dict(V=V, UV=UV, C=C, N=N, F=idx, head=h)


def texture(path):
    """BGR uint8 atlas (top row first, as the app uses it: uv (0,0) = top-left)."""
    return cv2.imread(path)


def sample(img, uv):
    """RGB 0..1 at atlas uv (u right, v down from the top, like the app's flipY=false)."""
    h, w = img.shape[:2]
    x = (uv[:, 0] * w - 0.5).astype(np.float32); y = (uv[:, 1] * h - 0.5).astype(np.float32)
    n = len(x); W = 2048; rows = (n + W - 1) // W
    mx = np.zeros(rows * W, np.float32); my = np.zeros(rows * W, np.float32); mx[:n] = x; my[:n] = y
    out = cv2.remap(img, mx.reshape(rows, W), my.reshape(rows, W), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(-1, 3)[:n][:, ::-1].astype(np.float32) / 255


VIEWS = {   # name: (right, up, towards the viewer)
    'front': ((1, 0, 0), (0, 1, 0), (0, 0, 1)), 'right': ((0, 0, -1), (0, 1, 0), (1, 0, 0)),
    'back': ((-1, 0, 0), (0, 1, 0), (0, 0, -1)), 'left': ((0, 0, 1), (0, 1, 0), (-1, 0, 0)),
    'top': ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
}


def render(V, F, UV, tex, view, px_per_unit, grid=None, light=True, C=None):
    """Orthographic textured picture (painter's algorithm, one affine warp per triangle). grid: spacing in units."""
    r, u, d = (np.array(a, float) for a in VIEWS[view])
    X, Y, Z = V @ r, V @ u, V @ d
    pad = 0.04 * max(np.ptp(X), np.ptp(Y))
    x0, x1, y0, y1 = X.min() - pad, X.max() + pad, Y.min() - pad, Y.max() + pad
    W, H = int((x1 - x0) * px_per_unit), int((y1 - y0) * px_per_unit)
    img = np.full((H, W, 3), 236, np.uint8)
    sx, sy = (X - x0) * px_per_unit, (y1 - Y) * px_per_unit
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    vis = n @ d > 0.02
    lt = np.array([-0.35, 0.8, 0.5]); lt /= np.linalg.norm(lt)
    shade = 0.62 + 0.38 * np.clip(n @ lt, 0, 1) if light else np.ones(len(F))
    th, tw = (tex.shape[:2] if tex is not None else (1, 1))
    for i in np.argsort(Z[F].mean(1)):
        if not vis[i]: continue
        dst = np.float32(np.stack([sx[F[i]], sy[F[i]]], 1))
        bx0, by0 = np.floor(dst.min(0)).astype(int); bx1, by1 = np.ceil(dst.max(0)).astype(int) + 1
        bx0, by0 = max(bx0, 0), max(by0, 0); bx1, by1 = min(bx1, W), min(by1, H)
        if bx1 <= bx0 or by1 <= by0: continue
        mask = np.zeros((by1 - by0, bx1 - bx0), np.uint8)
        cv2.fillConvexPoly(mask, np.int32(np.round((dst - [bx0, by0]) * 4)), 1, cv2.LINE_8, 2)
        if tex is not None:
            src = np.float32(UV[F[i]] * [tw, th])
            M = cv2.getAffineTransform(src, dst - np.float32([bx0, by0]))
            patch = cv2.warpAffine(tex, M, (bx1 - bx0, by1 - by0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        else:
            patch = np.empty((by1 - by0, bx1 - bx0, 3), np.uint8); patch[:] = (np.clip(C[F[i]].mean(0)[::-1], 0, 1) * 255).astype(np.uint8)
        patch = np.clip(patch * shade[i], 0, 255).astype(np.uint8)
        reg = img[by0:by1, bx0:bx1]; reg[mask > 0] = patch[mask > 0]
    if grid:
        for g in np.arange(np.ceil(x0 / grid) * grid, x1, grid):
            X_ = int((g - x0) * px_per_unit); major = abs(g / grid) % 5 < 1e-6
            cv2.line(img, (X_, 0), (X_, H), (0, 0, 230) if major else (190, 190, 250), 1)
            if major: cv2.putText(img, f'{g:g}', (X_ + 2, 12), 0, 0.38, (0, 0, 200), 1)
        for g in np.arange(np.ceil(y0 / grid) * grid, y1, grid):
            Y_ = int((y1 - g) * px_per_unit); major = abs(g / grid) % 5 < 1e-6
            cv2.line(img, (0, Y_), (W, Y_), (0, 0, 230) if major else (190, 190, 250), 1)
            if major: cv2.putText(img, f'{g:g}', (2, Y_ - 2), 0, 0.38, (0, 0, 200), 1)
    return img
