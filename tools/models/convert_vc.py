"""Turn a scan with vertex colours (no texture; e.g. a RealityScan OBJ export with `v x y z r g b`)
into a game model, the same GKM1 + baked JPG as tools/models/convert.py (from Gusinjska kocka).

python3 -I tools/models/convert_vc.py tools/models/models.json <id> [--out models] [--preview-only]

Config (paths relative to the config file):
  obj        the OBJ file (raw scans are not committed)
  up         "z" when the scan stands on Z (RealityScan); default Y
  keep       optional polygon [[x, z], ...] in the scan's own units after `up`: faces whose centre lies outside
             are dropped (cuts the street, cars and trees around a building); `keep_margin` widens it
  level      straighten a tilted scan and turn its walls square to the axes
  front      [x, z]: the outward direction of the façade with the main door, in the same frame as `keep`;
             the model is turned so that it faces +Z (the app turns +Z towards the viewer)
  target     triangles in the game version
Output in --out (default tools/models/out): <id>.json and <id>.jpg; check sheet in tools/models/tmp/<id>/.
"""
import json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from meshio import weld, render_views
from convert import (rot_from_to, rot_y, face_normals, clean, normalize, decimate, make_charts, build_atlas,
                     bake, write_bin, ATLAS)


def load_obj_vc(path):
    """OBJ with per-vertex colour (v x y z r g b). Returns V (n, 3), C (n, 3) in 0..1, F (m, 3)."""
    vs, fs = [], []
    with open(path, 'r', errors='replace') as fh:
        for line in fh:
            if line.startswith('v '):
                vs.append(line[2:])
            elif line.startswith('f '):
                idx = [int(q.split('/')[0]) for q in line.split()[1:]]
                for k in range(1, len(idx) - 1):
                    fs.append((idx[0], idx[k], idx[k + 1]))
    A = np.loadtxt(vs, dtype=np.float64)
    if A.shape[1] < 6:
        raise SystemExit('this OBJ has no vertex colours: use convert.py with its texture')
    V, C = A[:, :3], np.clip(A[:, 3:6], 0, 1)
    if C.max() > 1.5:
        C = C / 255.0
    F = np.array(fs, np.int64)
    F = np.where(F < 0, F + len(V) + 1, F) - 1
    return V, C, F


def inside_poly(P, poly):
    """Even-odd test, P (n, 2), poly (k, 2)."""
    x, y = P[:, 0], P[:, 1]
    ins = np.zeros(len(P), bool)
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % len(poly)]
        cross = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1)
        ins ^= cross
    return ins


def grow_poly(poly, d):
    """Move each edge of a convex polygon outwards by d."""
    poly = np.asarray(poly, float)
    c = poly.mean(0)
    out = []
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        t = (b - a) / np.linalg.norm(b - a); nrm = np.array([t[1], -t[0]])
        if nrm @ (a - c) < 0: nrm = -nrm
        lines.append((a + nrm * d, t))
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        M = np.array([t1, -t2]).T
        s = np.linalg.solve(M, p2 - p1)
        out.append(p1 + t1 * s[0])
    return np.array(out)


def level_and_face(V, F, front):
    """Fix the tilt from the walls, then turn the scan so its walls are square to the axes and `front` points to +Z."""
    u = np.array([0, 1.0, 0])
    n, area = face_normals(V, F)
    for _ in range(6):
        wall = np.abs(n @ u) < 0.35
        M = (n[wall] * area[wall, None]).T @ n[wall]
        w, E = np.linalg.eigh(M)
        u2 = E[:, 0]
        if u2 @ u < 0: u2 = -u2
        u = u2
    R1 = rot_from_to(u, np.array([0, 1.0, 0]))
    V = V @ R1.T
    tilt = np.degrees(np.arccos(np.clip(u[1], -1, 1)))
    n, area = face_normals(V, F)
    wall = np.abs(n[:, 1]) < 0.3
    phi = np.arctan2(n[wall, 0], n[wall, 2])
    theta = np.degrees(np.angle((area[wall] * np.exp(4j * phi)).sum()) / 4)
    f = R1 @ np.array([front[0], 0, front[1]]); f[1] = 0; f /= np.linalg.norm(f)
    best = None
    for k in range(4):
        yaw = -theta + 90 * k
        g = rot_y(yaw) @ f
        if best is None or g[2] > best[1]: best = (yaw, g[2])
    yaw = best[0]
    V = V @ rot_y(yaw).T
    print(f'  levelled: tilt {tilt:.2f}°, turned {yaw:.1f}° (façade to +Z, {np.degrees(np.arccos(min(1, best[1]))):.1f}° off)')
    return V


def dense_samples_vc(V, F, C, n_target=3_000_000, seed=1):
    rng = np.random.default_rng(seed)
    n, area = face_normals(V, F)
    cnt = np.maximum(1, np.round(area / area.sum() * n_target)).astype(np.int64)
    fid = np.repeat(np.arange(len(F)), cnt)
    r1 = np.sqrt(rng.random(len(fid))); r2 = rng.random(len(fid))
    w0, w1, w2 = 1 - r1, r1 * (1 - r2), r1 * r2
    P = V[F[fid, 0]] * w0[:, None] + V[F[fid, 1]] * w1[:, None] + V[F[fid, 2]] * w2[:, None]
    Cs = C[F[fid, 0]] * w0[:, None] + C[F[fid, 1]] * w1[:, None] + C[F[fid, 2]] * w2[:, None]
    return P, n[fid], Cs.astype(np.float32)


def main():
    cfg_path, mid = sys.argv[1], sys.argv[2]
    preview_only = '--preview-only' in sys.argv
    cfg = json.load(open(cfg_path))[mid]
    root = os.path.dirname(os.path.abspath(cfg_path))
    outdir = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(root, 'out')
    os.makedirs(outdir, exist_ok=True)
    tmpdir = os.path.join(root, 'tmp', mid); os.makedirs(tmpdir, exist_ok=True)
    t0 = time.time()
    print(f'[{mid}]')
    V, C, F = load_obj_vc(os.path.join(root, cfg['obj']))
    print(f'  scan: {len(V)} vertices, {len(F)} triangles')
    if cfg.get('up') == 'z':
        V = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1)
    if cfg.get('max_edge'):
        E = np.stack([np.linalg.norm(V[F[:, i]] - V[F[:, (i + 1) % 3]], axis=1) for i in range(3)], 1).max(1)
        print(f'  dropped {(E > cfg["max_edge"]).sum()} long sliver triangles')
        F = F[E <= cfg['max_edge']]
    if cfg.get('keep'):
        poly = grow_poly(cfg['keep'], cfg.get('keep_margin', 0))
        cen = V[F].mean(1)
        ins = inside_poly(cen[:, [0, 2]], poly)
        print(f'  kept {ins.sum()} of {len(F)} triangles inside the outline')
        F = F[ins]
    F, _ = clean(V, F, F.copy(), cfg)
    if cfg.get('level'):
        V = level_and_face(V, F, cfg.get('front', [0, 1]))
    elif cfg.get('yaw'):
        V = V @ rot_y(cfg['yaw']).T
    if preview_only:
        np.savez(os.path.join(tmpdir, 'levelled.npz'), V=V, C=C, F=F)
    if cfg.get('box') or cfg.get('ground_below') is not None:
        # second cut, in the levelled frame: a box around the building, and flat ground below a height
        cen = V[F].mean(1); n, _ = face_normals(V, F)
        keep = np.ones(len(F), bool)
        if cfg.get('box'):
            x0, z0, x1, z1 = cfg['box']
            keep &= (cen[:, 0] > x0) & (cen[:, 0] < x1) & (cen[:, 2] > z0) & (cen[:, 2] < z1)
        if cfg.get('ground_below') is not None:
            keep &= ~((cen[:, 1] < cfg['ground_below']) & (np.abs(n[:, 1]) > 0.6))
        print(f'  building cut: kept {keep.sum()} of {len(F)} triangles')
        F = F[keep]
        F, _ = clean(V, F, F.copy(), cfg)
    used = np.unique(F)
    remap = np.full(len(V), -1); remap[used] = np.arange(len(used))
    V, C, F = V[used], C[used], remap[F]
    V = normalize(V, F)
    face_rgb = C[F].mean(1)
    if preview_only:
        render_views(V, F, face_rgb, os.path.join(tmpdir, f'{mid}_orient.png'), size=320, title=f'{mid} oriented ({len(F)} triangles)')
        print('  preview written:', os.path.join(tmpdir, f'{mid}_orient.png')); return
    samples = dense_samples_vc(V, F, C)
    Vw, Fw, _ = weld(V, F)
    Vd, Fd = decimate(Vw, Fw, cfg.get('target', 12000), tmpdir)
    comp, nc, label = make_charts(Vd, Fd)
    Vc, UVp, Fc, chart_of, charts, k = build_atlas(Vd, Fd, comp, nc, label)
    print(f'  {nc} charts, {k:.1f} texels per unit')
    col, mask = bake(Vc, UVp, Fc, samples)
    fn, fa = face_normals(Vc, Fc)
    N = np.zeros_like(Vc)
    for j in range(3):
        np.add.at(N, Fc[:, j], fn * fa[:, None])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    write_bin(os.path.join(outdir, f'{mid}.json'), Vc, UVp / ATLAS, N, Fc)
    jpg = (np.clip(col, 0, 1) * 255).astype(np.uint8)[:, :, ::-1]
    cv2.imwrite(os.path.join(outdir, f'{mid}.jpg'), jpg, [cv2.IMWRITE_JPEG_QUALITY, 86])
    uvc = UVp[Fc].mean(1).astype(int).clip(0, ATLAS - 1)
    game_rgb = col[uvc[:, 1], uvc[:, 0]]
    a = os.path.join(tmpdir, 'a.png'); b = os.path.join(tmpdir, 'b.png')
    render_views(V, F, face_rgb, a, size=260, title=f'{mid}: scan {len(F)} triangles')
    render_views(Vc, Fc, game_rgb, b, size=260, title=f'{mid}: game version {len(Fc)} triangles')
    cv2.imwrite(os.path.join(tmpdir, f'{mid}_check.png'), np.concatenate([cv2.imread(a), cv2.imread(b)], 0))
    sz = os.path.getsize(os.path.join(outdir, f'{mid}.json')) + os.path.getsize(os.path.join(outdir, f'{mid}.jpg'))
    print(f'  done in {time.time() - t0:.0f} s, {len(Vc)} verts, {len(Fc)} tris, files {sz / 1024:.0f} KB')


if __name__ == '__main__':
    main()
