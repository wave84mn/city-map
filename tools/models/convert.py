"""Turn a scanned building (OBJ + photo texture) into a light game model.

python3 -I tools/convert.py tools/models.json <id> [--out models] [--preview-only]

Source paths in models.json are relative to tools/. Raw scans go in scans/ (not committed).
Output: <id>.json (mesh, GKM1 binary as base64) and <id>.jpg (1024 px texture) in --out (default: out/),
plus <id>_check.png (scan vs game version, five views) in tmp/<id>/.
"""
import json, os, struct, subprocess, sys, time
import numpy as np
import cv2
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from meshio import load_obj, load_texture, sample_texture, weld, render_views

ATLAS = 1024
PAD = 3


def rot_from_to(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(a @ b)
    if c < -0.999999:
        ax = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0]); ax /= np.linalg.norm(ax)
        return 2 * np.outer(ax, ax) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def rot_y(deg):
    t = np.radians(deg); c, s = np.cos(t), np.sin(t)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    a = np.linalg.norm(n, axis=1)
    return n / np.maximum(a[:, None], 1e-30), a / 2


def orient(V, F, cfg):
    up = cfg.get('up', 'y')
    if up == 'z':
        V = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1)
    if cfg.get('level'):
        u = np.array([0, 1.0, 0])
        n, area = face_normals(V, F)
        for _ in range(6):
            wall = np.abs(n @ u) < 0.35
            M = (n[wall] * area[wall, None]).T @ n[wall]
            w, E = np.linalg.eigh(M)
            u2 = E[:, 0]
            if u2 @ u < 0: u2 = -u2
            u = u2
        V = V @ rot_from_to(u, np.array([0, 1.0, 0])).T
        n, area = face_normals(V, F)
        wall = np.abs(n[:, 1]) < 0.3
        phi = np.arctan2(n[wall, 0], n[wall, 2])
        z = (area[wall] * np.exp(4j * phi)).sum()
        theta = np.degrees(np.angle(z) / 4)
        V = V @ rot_y(-theta).T
        print(f'  levelled: tilt fixed, walls rotated by {-theta:.1f}°')
    if cfg.get('yaw'):
        V = V @ rot_y(cfg['yaw']).T
    return V


def clean(V, F, FT, cfg):
    # drop small floating pieces
    nF = len(F)
    ext = np.ptp(V, axis=0).max()
    key = np.round(V / (ext * 1e-7)).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    Fw = inv.reshape(-1)[F]
    rows = np.repeat(np.arange(nF), 3); cols = Fw.reshape(-1)
    G = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nF, inv.max() + 1)).tocsr()
    A = G @ G.T
    ncomp, lab = connected_components(A, directed=False)
    _, area = face_normals(V, F)
    comp_area = np.bincount(lab, weights=area, minlength=ncomp)
    keep = comp_area[lab] >= cfg.get('min_part', 0.003) * area.sum()
    if 'cut_below' in cfg:
        ymin = V[:, 1].min()
        cut = ymin + cfg['cut_below'] * np.ptp(V[:, 1])
        keep &= V[F].max(1)[:, 1] > cut
    if cfg.get('crop_to_roof'):
        H = np.ptp(V[:, 1]); y0 = V[:, 1].min()
        lo_y, hi_y = cfg['crop_to_roof']
        band = (V[:, 1] > y0 + lo_y * H) & (V[:, 1] < y0 + hi_y * H)
        lo, hi = V[band][:, [0, 2]].min(0), V[band][:, [0, 2]].max(0)
        m = 0.01 * (hi - lo).max()
        cen = V[F].mean(1)[:, [0, 2]]
        keep &= np.all((cen > lo - m) & (cen < hi + m), axis=1)
    if cfg.get('trim_walls'):
        n, area = face_normals(V, F)
        cen = V[F].mean(1)
        roof = (n[:, 1] > 0.4) & keep
        eave = np.percentile(cen[roof, 1], 5)
        margin = 0.015 * np.ptp(V[:, [0, 2]], axis=0).max()
        for ax, col in ((0, 0), (2, 2)):
            for sgn in (1, -1):
                facing = (n[:, ax] * sgn > 0.8) & keep & (cen[:, 1] < eave)
                w = np.average(cen[facing, col], weights=area[facing]) if facing.any() else None
                if w is None:
                    continue
                med = np.median(cen[facing, col])
                outside = (cen[:, col] * sgn > med * sgn + margin) & (cen[:, 1] < eave)
                keep &= ~outside
    dropped = (~keep).sum()
    if dropped:
        print(f'  removed {dropped} stray triangles')
    return F[keep], FT[keep]


def normalize(V, F):
    used = np.unique(F)
    lo, hi = V[used].min(0), V[used].max(0)
    c = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    return V - c


def dense_samples(V, F, FT, VT, img, n_target=3_000_000, seed=1):
    rng = np.random.default_rng(seed)
    n, area = face_normals(V, F)
    cnt = np.maximum(1, np.round(area / area.sum() * n_target)).astype(np.int64)
    fid = np.repeat(np.arange(len(F)), cnt)
    r1 = np.sqrt(rng.random(len(fid))); r2 = rng.random(len(fid))
    w0, w1, w2 = 1 - r1, r1 * (1 - r2), r1 * r2
    P = V[F[fid, 0]] * w0[:, None] + V[F[fid, 1]] * w1[:, None] + V[F[fid, 2]] * w2[:, None]
    UV = VT[FT[fid, 0]] * w0[:, None] + VT[FT[fid, 1]] * w1[:, None] + VT[FT[fid, 2]] * w2[:, None]
    C = sample_texture(img, UV)
    return P, n[fid], C


def decimate(Vw, Fw, target, tmpdir):
    inp = os.path.join(tmpdir, 'dec_in.bin'); outp = os.path.join(tmpdir, 'dec_out.bin')
    with open(inp, 'wb') as fh:
        fh.write(struct.pack('<II', len(Vw), len(Fw)))
        fh.write(np.ascontiguousarray(Vw, '<f8').tobytes()); fh.write(np.ascontiguousarray(Fw, '<i4').tobytes())
    r = subprocess.run(['node', os.path.join(HERE, 'decimate.mjs'), inp, outp, str(target)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    print('  decimate:', r.stdout.strip())
    b = open(outp, 'rb').read()
    nv, nf = struct.unpack('<II', b[:8])
    V = np.frombuffer(b, '<f8', nv * 3, 8).reshape(nv, 3).copy()
    F = np.frombuffer(b, '<i4', nf * 3, 8 + nv * 24).reshape(nf, 3).astype(np.int64)
    return V, F


# 18 projection directions: 6 axes + 12 edge diagonals
DIRS = []
for a in range(3):
    for s in (1, -1):
        d = np.zeros(3); d[a] = s; DIRS.append(d)
for a, b in ((0, 1), (0, 2), (1, 2)):
    for sa in (1, -1):
        for sb in (1, -1):
            d = np.zeros(3); d[a] = sa; d[b] = sb; DIRS.append(d / np.sqrt(2))
DIRS = np.array(DIRS)


def make_charts(V, F):
    n, area = face_normals(V, F)
    label = np.argmax(n @ DIRS.T, axis=1)
    # face adjacency through edges
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fidx = np.tile(np.arange(len(F)), 3)
    e.sort(1)
    key = e[:, 0] * (len(V) + 1) + e[:, 1]
    order = np.argsort(key)
    ks, fs = key[order], fidx[order]
    same = ks[1:] == ks[:-1]
    pa, pb = fs[:-1][same], fs[1:][same]
    # smooth labels: a face takes the area-weighted majority label of its neighbours when it still faces it
    nd = len(DIRS)
    for _ in range(8):
        votes = np.zeros((len(F), nd))
        np.add.at(votes, (pa, label[pb]), area[pb]); np.add.at(votes, (pb, label[pa]), area[pa])
        votes[np.arange(len(F)), label] += area * 1.01
        cand = votes.argmax(1)
        ok = np.einsum('ij,ij->i', n, DIRS[cand]) > 0.35
        new = np.where(ok, cand, label)
        if (new == label).all():
            break
        label = new
    for _ in range(3):  # merge tiny regions into a neighbour's direction
        conn = label[pa] == label[pb]
        G = coo_matrix((np.ones(conn.sum()), (pa[conn], pb[conn])), shape=(len(F), len(F)))
        nc, comp = connected_components(G, directed=False)
        carea = np.bincount(comp, weights=area, minlength=nc)
        small = carea[comp] < area.sum() * 0.0015
        if not small.any():
            break
        # adopt the label of the largest-area neighbouring component whose direction is still facing
        changed = 0
        for x, y in ((pa, pb), (pb, pa)):
            m = small[x] & ~small[y] & (label[x] != label[y])
            cand = y[m]; xs = x[m]
            ok = np.einsum('ij,ij->i', n[xs], DIRS[label[cand]]) > 0.35
            label[xs[ok]] = label[cand[ok]]; changed += ok.sum()
        if not changed:
            break
    conn = label[pa] == label[pb]
    G = coo_matrix((np.ones(conn.sum()), (pa[conn], pb[conn])), shape=(len(F), len(F)))
    nc, comp = connected_components(G, directed=False)
    return comp, nc, label


def build_atlas(V, F, comp, nc, label):
    """Planar projection per chart, shelf packing, returns per-corner uv (pixels) and chart info."""
    charts = []
    for c in range(nc):
        fi = np.nonzero(comp == c)[0]
        d = DIRS[label[fi[0]]]
        e1 = np.cross(d, [0, 1, 0]) if abs(d[1]) < 0.9 else np.cross(d, [0, 0, 1])
        e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
        vids = np.unique(F[fi])
        P = V[vids]
        uv = np.stack([P @ e1, -(P @ e2)], 1)
        lo, hi = uv.min(0), uv.max(0)
        charts.append(dict(faces=fi, vids=vids, uv=uv, lo=lo, size=hi - lo, d=d))

    def pack(k):
        items = sorted(range(nc), key=lambda i: -(charts[i]['size'][1] * k))
        x = y = shelf_h = 0
        place = {}
        for i in items:
            w = int(np.ceil(charts[i]['size'][0] * k)) + 2 * PAD + 1
            h = int(np.ceil(charts[i]['size'][1] * k)) + 2 * PAD + 1
            if w > ATLAS:
                return None
            if x + w > ATLAS:
                y += shelf_h; x = 0; shelf_h = 0
            if y + h > ATLAS:
                return None
            place[i] = (x, y, w, h); x += w; shelf_h = max(shelf_h, h)
        return place

    lo_k, hi_k = 1e-6, 1e6
    total = sum(c['size'][0] * c['size'][1] for c in charts)
    k = np.sqrt(ATLAS * ATLAS * 0.6 / max(total, 1e-12))
    lo_k, hi_k = k * 0.05, k * 3
    best = None
    for _ in range(30):
        mid = np.sqrt(lo_k * hi_k)
        p = pack(mid)
        if p: best, lo_k = (mid, p), mid
        else: hi_k = mid
    k, place = best
    # per chart vertex arrays (vertices duplicated across charts)
    out_v, out_uv, out_f, chart_of_vert = [], [], [], []
    base = 0
    for i, c in enumerate(charts):
        x, y, w, h = place[i]
        loc = {v: j for j, v in enumerate(c['vids'])}
        uvp = (c['uv'] - c['lo']) * k + PAD + np.array([x, y]) + 0.5
        out_v.append(V[c['vids']]); out_uv.append(uvp)
        out_f.append(np.vectorize(loc.get)(F[c['faces']]) + base)
        chart_of_vert.append(np.full(len(c['vids']), i))
        c['rect'] = place[i]
        base += len(c['vids'])
    return np.concatenate(out_v), np.concatenate(out_uv), np.concatenate(out_f), np.concatenate(chart_of_vert), charts, k


def bake(Vc, UVp, Fc, samples):
    P_s, N_s, C_s = samples
    tree = cKDTree(P_s)
    H = W = ATLAS
    posbuf = np.zeros((H, W, 3)); nbuf = np.zeros((H, W, 3)); mask = np.zeros((H, W), bool)
    n, _ = face_normals(Vc, Fc)
    for f in range(len(Fc)):
        t = UVp[Fc[f]]
        x0, y0 = np.floor(t.min(0)).astype(int) - 1; x1, y1 = np.ceil(t.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = t
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        l1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        l2 = 1 - l0 - l1
        # inside, with half a texel of slack so edges are covered
        el = 0.75 / max(np.sqrt(abs(den)), 1e-9)
        ins = (l0 >= -el) & (l1 >= -el) & (l2 >= -el)
        if not ins.any():
            continue
        L = np.stack([np.clip(l0[ins], 0, 1), np.clip(l1[ins], 0, 1), np.clip(l2[ins], 0, 1)], 1)
        L /= L.sum(1, keepdims=True)
        p = L @ Vc[Fc[f]]
        yy, xx = (ys[ins] - 0.5).astype(int), (xs[ins] - 0.5).astype(int)
        posbuf[yy, xx] = p; nbuf[yy, xx] = n[f]; mask[yy, xx] = True
    q = posbuf[mask]; qn = nbuf[mask]
    dist, idx = tree.query(q, k=6, workers=-1)
    agree = np.einsum('ijk,ik->ij', N_s[idx], qn) > 0.1
    first = np.where(agree.any(1), agree.argmax(1), 0)
    pick = idx[np.arange(len(idx)), first]
    col = np.zeros((H, W, 3), np.float32)
    col[mask] = C_s[pick]
    # fill gutters with the nearest baked colour
    _, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    col = col[iy, ix]
    return col, mask


def write_bin(path, V, UV01, N, F):
    lo, hi = V.min(0), V.max(0)
    span = np.maximum(hi - lo, 1e-12)
    qp = np.round((V - lo) / span * 65535).astype('<u2')
    qu = np.round(np.clip(UV01, 0, 1) * 65535).astype('<u2')
    qn = np.zeros((len(N), 4), np.int8); qn[:, :3] = np.round(np.clip(N, -1, 1) * 127)
    big = len(V) > 65535
    idx = F.astype('<u4' if big else '<u2')
    head = json.dumps({'nv': len(V), 'nf': len(F), 'min': lo.round(6).tolist(), 'max': hi.round(6).tolist(), 'idx32': big}).encode()
    head += b' ' * ((4 - len(head) % 4) % 4)
    parts = [b'GKM1', struct.pack('<I', len(head)), head]
    for arr in (qp, qu, qn, idx):
        bts = arr.tobytes(); parts.append(bts + b'\0' * ((4 - len(bts) % 4) % 4))
    import base64
    with open(path, 'w') as fh:
        json.dump({'format': 'GKM1', 'data': base64.b64encode(b''.join(parts)).decode()}, fh)


def main():
    cfg_path, mid = sys.argv[1], sys.argv[2]
    preview_only = '--preview-only' in sys.argv
    allcfg = json.load(open(cfg_path))
    cfg = allcfg[mid]
    root = os.path.dirname(os.path.abspath(cfg_path))
    obj = os.path.join(root, cfg['obj']); tex = os.path.join(root, cfg['tex'])
    outdir = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(root, 'out')
    os.makedirs(outdir, exist_ok=True)
    tmpdir = os.path.join(root, 'tmp', mid); os.makedirs(tmpdir, exist_ok=True)
    t0 = time.time()
    print(f'[{mid}]')
    V, VT, F, FT = load_obj(obj)
    img = load_texture(tex)
    V = orient(V, F, cfg)
    F, FT = clean(V, F, FT, cfg)
    V = normalize(V, F)
    face_rgb = sample_texture(img, VT[FT].mean(1))
    if preview_only:
        render_views(V, F, face_rgb, os.path.join(tmpdir, f'{mid}_orient.png'), size=300, title=f'{mid} oriented')
        print('  preview written'); return
    samples = dense_samples(V, F, FT, VT, img)
    Vw, Fw, _ = weld(V, F)
    Vd, Fd = decimate(Vw, Fw, cfg.get('target', 12000), tmpdir)
    comp, nc, label = make_charts(Vd, Fd)
    Vc, UVp, Fc, chart_of, charts, k = build_atlas(Vd, Fd, comp, nc, label)
    print(f'  {nc} charts, {k:.1f} texels per unit')
    col, mask = bake(Vc, UVp, Fc, samples)
    # smooth normals inside each chart
    fn, fa = face_normals(Vc, Fc)
    N = np.zeros_like(Vc)
    for j in range(3):
        np.add.at(N, Fc[:, j], fn * fa[:, None])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    UV01 = UVp / ATLAS
    write_bin(os.path.join(outdir, f'{mid}.json'), Vc, UV01, N, Fc)
    jpg = (np.clip(col, 0, 1) * 255).astype(np.uint8)[:, :, ::-1]
    cv2.imwrite(os.path.join(outdir, f'{mid}.jpg'), jpg, [cv2.IMWRITE_JPEG_QUALITY, 86])
    # check sheet: original (face colours) vs game version (colour from baked atlas at face centre)
    uvc = UVp[Fc].mean(1).astype(int).clip(0, ATLAS - 1)
    game_rgb = col[uvc[:, 1], uvc[:, 0]]
    a = os.path.join(tmpdir, 'a.png'); b = os.path.join(tmpdir, 'b.png')
    render_views(V, F, face_rgb, a, size=240, title=f'{mid}: scan {len(F)} triangles')
    render_views(Vc, Fc, game_rgb, b, size=240, title=f'{mid}: game version {len(Fc)} triangles')
    sheet = np.concatenate([cv2.imread(a), cv2.imread(b)], 0)
    cv2.imwrite(os.path.join(tmpdir, f'{mid}_check.png'), sheet)
    sz = os.path.getsize(os.path.join(outdir, f'{mid}.json')) + os.path.getsize(os.path.join(outdir, f'{mid}.jpg'))
    print(f'  done in {time.time() - t0:.0f} s, {len(Vc)} verts, {len(Fc)} tris, files {sz / 1024:.0f} KB')


if __name__ == '__main__':
    main()
