"""Kuća Radončića – Balića (Gusinje): the house from the user's RealityScan scan, its real shape and colours.

The scan (tools/models/scans/kuca_1_samo_kuca_MALA.obj, 7 Nov 2026) is a coloured point cloud (662k points, no
surface). Here:
1. The points are put in a frame square to the walls (turned about the vertical so the walls line up with the axes,
   the ground at y = 0, the side with the red door towards +Z). Note: a proper rotation. v0.15 swapped two axes and
   so built the house mirrored.
2. A clean shell is built from measurements taken on those points (metres): the stone ground floor
   (x -6.08..6.15, z -4.88..5.37, to 2.85 m), the plastered upper floor overhanging it on the right and at the back
   (x -6.08..6.37, z -5.05..5.37, to the eaves), the small projecting bay on the upper floor at the back
   (x -0.85..1.45, out to z -5.58), the annex at the front left (x -6.05..0, out to z 6.87) with its roof sloping
   from 3.25 m at the house wall, and the hipped roof whose four slopes are fitted to the scan's roof points
   (about 40°, eaves at 5.4 m, ridge at 10.4 m). A little of the ground around it.
3. The shell is coloured from the points themselves: each part of the shell takes the colours of the scan's points
   lying on it (a blend of the nearest points across the surface, as sharp as the scan is dense: crisp on the walls,
   a smooth average on the sparser roof; points nearest to the surface count most).
   Windows, stone, wood, the red door, the shingles and the plants are the scan's own. Gaps are painted in.

python3 -I tools/models/kuca_radoncica_balica.py [--out models] [--check DIR]
"""
import os, sys
import numpy as np
import cv2
from scipy.spatial import cKDTree
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import convert as CV
from meshio import weld
from buildkit import Mesh, box, fix_winding

SCAN = os.path.join(HERE, 'scans', 'kuca_1_samo_kuca_MALA.obj')
K = (0.5, 0.5, 0.5)
ATLAS = 2048


# ---------------- the points in the house's own frame ----------------
def load_points():
    cache = os.path.join(HERE, 'tmp', 'kuca_points.npz')
    if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(SCAN):
        d = np.load(cache); return d['V'], d['C']
    lines = [l[2:] for l in open(SCAN) if l.startswith('v ')]
    A = np.loadtxt(lines, dtype=np.float64)
    V, C = A[:, :3], np.clip(A[:, 3:6], 0, 1).astype(np.float32)
    keep = (np.abs(V[:, 0]) < 20) & (np.abs(V[:, 1]) < 20)
    V, C = V[keep], C[keep]
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    np.savez(cache, V=V, C=C)
    return V, C


def house_frame(V):
    """Scan (x, y, z up) -> house frame (x right, y up, z towards the door side). A proper rotation."""
    sel = (V[:, 2] > 2.5) & (V[:, 2] < 6.5) & (np.hypot(V[:, 0], V[:, 1]) < 12)
    P = V[sel, :2]
    best = None
    for a in np.arange(30, 50, 0.25):              # the turn that makes the wall points line up sharpest
        t = np.radians(a); R = np.array([[np.cos(t), np.sin(t)], [-np.sin(t), np.cos(t)]])
        Q = P @ R.T
        sc = sum((np.histogram(Q[:, k], bins=np.arange(-14, 14, 0.1))[0].astype(float) ** 2).sum() for k in range(2))
        if best is None or sc > best[1]: best = (a, sc)
    t = np.radians(best[0]); R = np.array([[np.cos(t), np.sin(t)], [-np.sin(t), np.cos(t)]])
    Q = V[:, :2] @ R.T
    g = np.percentile(V[(np.abs(Q[:, 0]) < 9) & (np.abs(Q[:, 1]) < 9) & (V[:, 2] < 2), 2], 20)
    # (x, y, z) = (-q0, up, q1): right-handed, the red-door side towards +z
    U = np.stack([-Q[:, 0], V[:, 2] - g, Q[:, 1]], 1)
    print(f'  frame: turned {best[0]:.2f}°, ground at {g:.2f}')
    return U


def roof_planes(U):
    """The four roof slopes, fitted to the roof points (n, d with n.p = d, n pointing up and out)."""
    x, y, z = U.T
    P = U[(y > 5.9) & (x > -7.3) & (x < 7.4) & (z > -6.6) & (z < 6.8)]
    sides = {'front': P[:, 2] > np.abs(P[:, 0] - 0.3) + 0.3, 'back': -P[:, 2] > np.abs(P[:, 0] - 0.3) + 0.3,
             'right': P[:, 0] > np.abs(P[:, 2]) + 1.0, 'left': -P[:, 0] > np.abs(P[:, 2]) + 1.6}
    out = {}
    for k, s in sides.items():
        for _ in range(3):                          # fit, drop outliers, fit again
            Q = P[s]; c = Q.mean(0); n = np.linalg.svd(Q - c)[2][2]; n = n if n[1] > 0 else -n
            r = np.abs(P @ n - n @ c); s = s & (r < 0.25)
        out[k] = (n, float(n @ c))
        print(f'  roof {k}: slope {np.degrees(np.arccos(n[1])):.1f}°, {s.sum()} points')
    return out


def meet(planes):
    """The point where three planes meet."""
    A = np.array([p[0] for p in planes]); b = np.array([p[1] for p in planes])
    return np.linalg.solve(A, b)


# ---------------- the shell ----------------
def build(U):
    m = Mesh()
    yB = 2.85                                        # top of the stone ground floor / underside of the upper floor
    yE = 5.4                                         # eaves
    # the ground around the house (a ring, so no texture is spent under the house), with its edge
    gx0, gx1, gz0, gz1 = -7.6, 7.8, -6.7, 8.0
    hx0, hx1, hz0, hz1 = -6.08, 6.15, -4.88, 6.87
    for (a0, a1, b0, b1) in ((gx0, gx1, hz1, gz1), (gx0, gx1, gz0, hz0), (gx0, hx0, hz0, hz1), (hx1, gx1, hz0, hz1), (0.0, hx1, 5.37, hz1)):
        m.quad((a0, 0, b1), (a1, 0, b1), (a1, 0, b0), (a0, 0, b0), K, nrm=(0, 1, 0))
    box(m, gx0, gx1, -0.15, 0.0, gz0, gz1, K, top=False, ao=False)
    # stone ground floor
    box(m, -6.08, 6.15, 0.0, yB, -4.88, 5.37, K, top=False, ao=False)
    # upper floor (overhangs on the right and at the back), up to the roof's underside
    box(m, -6.08, 6.37, yB, yE - 0.12, -5.05, 5.37, K, top=False, bottom=True, ao=False)
    # the bay on the upper floor at the back
    box(m, -0.85, 1.45, 2.65, yE - 0.12, -5.58, -5.05, K, top=False, bottom=True, ao=False, sides='xXz')
    # annex at the front left, its roof sloping from the house wall (3.25 m) down to 2.55 m past its front
    ax0, ax1, az0, az1 = -6.05, 0.0, 5.37, 6.87
    ya = lambda zz: 5.497 - 0.418 * zz
    box(m, ax0, ax1, 0.0, 2.45, az0, az1, K, top=False, ao=False, sides='xXZ')
    for x, s in ((ax0, -1), (ax1, 1)):             # its side walls up to the sloping roof
        P = np.array([(x, 2.45, az0), (x, 2.45, az1), (x, ya(az1), az1), (x, ya(az0), az0)])
        m.add(P, [(s, 0, 0)] * 4, K, [[0, 1, 2], [0, 2, 3]] if s > 0 else [[0, 2, 1], [0, 3, 2]])
    m.quad((ax0, ya(az1), az1), (ax1, ya(az1), az1), (ax1, 2.45, az1), (ax0, 2.45, az1), K, nrm=(0, 0, 1))
    r0, r1 = az0, 7.05                               # the roof, a little past the annex's front and sides
    m.quad((ax0 - 0.1, ya(r1), r1), (ax1 + 0.1, ya(r1), r1), (ax1 + 0.1, ya(r0), r0), (ax0 - 0.1, ya(r0), r0), K)
    m.quad((ax0 - 0.1, ya(r1) - 0.08, r1), (ax0 - 0.1, ya(r0) - 0.08, r0), (ax1 + 0.1, ya(r0) - 0.08, r0), (ax1 + 0.1, ya(r1) - 0.08, r1), K, nrm=(0, -1, 0))
    # hipped roof from the fitted slopes
    pl = roof_planes(U)
    flat = (np.array([0.0, 1.0, 0.0]), yE)
    FL, FR, BR, BL = meet([pl['front'], pl['left'], flat]), meet([pl['front'], pl['right'], flat]), meet([pl['back'], pl['right'], flat]), meet([pl['back'], pl['left'], flat])
    RL, RR = meet([pl['front'], pl['back'], pl['left']]), meet([pl['front'], pl['back'], pl['right']])
    print(f'  eaves x {FL[0]:.2f}..{FR[0]:.2f}, z {BL[2]:.2f}..{FL[2]:.2f} at {yE} m; ridge {RL[0]:.2f}..{RR[0]:.2f} at {RL[1]:.2f} m')
    m.quad(FL, FR, RR, RL, K); m.add(np.array([FR, BR, RR]), [pl['right'][0]] * 3, K, [[0, 1, 2]])
    m.quad(BR, BL, RL, RR, K); m.add(np.array([BL, FL, RL]), [pl['left'][0]] * 3, K, [[0, 1, 2]])
    # fascia and the underside of the overhang
    yF = yE - 0.18
    ring = [FL, FR, BR, BL]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        m.quad((a[0], yF, a[2]), (b[0], yF, b[2]), (b[0], yE, b[2]), (a[0], yE, a[2]), K)
    w = [(-6.08, yF, 5.37), (6.37, yF, 5.37), (6.37, yF, -5.05), (-6.08, yF, -5.05)]
    for (a, b), (c, d) in zip(zip(ring, ring[1:] + ring[:1]), zip(w, w[1:] + w[:1])):
        m.quad((a[0], yF, a[2]), (c[0], yF, c[2]), (d[0], yF, d[2]), (b[0], yF, b[2]), K, nrm=(0, -1, 0))
    return m


# ---------------- colours from the points ----------------
def raster_faces(Vc, UVp, Fc, atlas):
    """3D position and face of every atlas texel covered by the shell."""
    pos = np.zeros((atlas, atlas, 3), np.float32); face = np.full((atlas, atlas), -1, np.int32)
    for f in range(len(Fc)):
        t = UVp[Fc[f]]
        x0, y0 = np.floor(t.min(0)).astype(int) - 1; x1, y1 = np.ceil(t.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, atlas - 1), min(y1, atlas - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = t
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        l0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        l1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        l2 = 1 - l0 - l1
        el = 0.75 / max(np.sqrt(abs(den)), 1e-9)
        ins = (l0 >= -el) & (l1 >= -el) & (l2 >= -el)
        if not ins.any(): continue
        L = np.stack([np.clip(l0[ins], 0, 1), np.clip(l1[ins], 0, 1), np.clip(l2[ins], 0, 1)], 1)
        L /= L.sum(1, keepdims=True)
        yy, xx = (ys[ins] - 0.5).astype(int), (xs[ins] - 0.5).astype(int)
        pos[yy, xx] = L @ Vc[Fc[f]]; face[yy, xx] = f
    return pos, face


def bake(Vc, UVp, Fc, U, C):
    pos, face = raster_faces(Vc, UVp, Fc, ATLAS)
    out = np.zeros((ATLAS, ATLAS, 3), np.float32); got = np.zeros((ATLAS, ATLAS), bool)
    fn, fa = CV.face_normals(Vc, Fc)
    # faces lying in the same plane are coloured together
    key = np.round(np.c_[fn * 50, (fn * Vc[Fc[:, 0]]).sum(1, keepdims=True) * 20]).astype(np.int64)
    _, plane_of = np.unique(key, axis=0, return_inverse=True)
    plane_of = plane_of.reshape(-1)
    texel_plane = np.where(face >= 0, plane_of[np.maximum(face, 0)], -1)
    for ci in range(plane_of.max() + 1):
        sel = texel_plane == ci
        if not sel.any(): continue
        fs = plane_of == ci
        n = (fn[fs] * fa[fs, None]).sum(0); n /= np.linalg.norm(n)
        c0 = (Vc[Fc[fs]].mean(1) * fa[fs, None]).sum(0) / fa[fs].sum()
        e1 = np.cross(n, [0, 1, 0]) if abs(n[1]) < 0.9 else np.cross(n, [0, 0, 1]); e1 /= np.linalg.norm(e1)
        e2 = np.cross(n, e1)
        Q = pos[sel].astype(float)
        qu, qv = (Q - c0) @ e1, (Q - c0) @ e2
        ground = n[1] > 0.95 and c0[1] < 0.3
        lo, hi = (-0.25, 0.35) if ground else (-0.45, 0.5)
        s = (U - c0) @ n
        pu, pv = (U - c0) @ e1, (U - c0) @ e2
        k = (s > lo) & (s < hi) & (pu > qu.min() - 0.15) & (pu < qu.max() + 0.15) & (pv > qv.min() - 0.15) & (pv < qv.max() + 0.15)
        if ground: k &= U[:, 1] < 0.6
        if k.sum() < 4: continue
        tree = cKDTree(np.c_[pu[k], pv[k]])
        # the nearest points across the surface (out to 30 cm where the scan is sparse, e.g. on the roof), blended by
        # distance; points lying off the surface count less
        # Gaussian weights whose width follows the local spacing of the points: sharp where the scan is dense
        # (walls, windows), a smooth average where it is sparse and noisy (the roof)
        reach = 0.6 if n[1] > 0.5 and not ground else 0.3
        dist, idx = tree.query(np.c_[qu, qv], k=12, distance_upper_bound=reach)
        ok = np.isfinite(dist)
        idx = np.where(ok, idx, 0)
        sk, ck = s[k], C[k]
        d3 = np.where(np.isfinite(dist[:, 3]), dist[:, 3], np.nanmax(np.where(ok, dist, np.nan), 1))
        sig = np.clip(0.8 * np.nan_to_num(d3, nan=reach), 0.02, 0.25)[:, None]
        wgt = np.where(ok, np.exp(-np.where(ok, dist, 0) ** 2 / (2 * sig ** 2)) / (1 + (sk[idx] / 0.2) ** 2), 0.0)
        tot = wgt.sum(1)
        col = (ck[idx] * wgt[..., None]).sum(1) / np.maximum(tot, 1e-12)[:, None]
        has = tot > 0
        yy, xx = np.nonzero(sel)
        out[yy[has], xx[has]] = col[has]; got[yy[has], xx[has]] = True
    inside = face >= 0
    img = (np.clip(out, 0, 1) * 255).astype(np.uint8)[:, :, ::-1]
    _, (iy, ix) = ndimage.distance_transform_edt(~got, return_indices=True)
    full = img[iy, ix]
    hole = (inside & ~got).astype(np.uint8)
    if hole.any():
        small = cv2.resize(full, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
        hs = cv2.resize(hole, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
        painted = cv2.resize(cv2.inpaint(small, hs, 6, cv2.INPAINT_TELEA), (full.shape[1], full.shape[0]), interpolation=cv2.INTER_LINEAR)
        full[hole > 0] = painted[hole > 0]
    print(f'  {100 * (1 - got[inside].mean()):.1f} % of the surface painted in (no scan points there)')
    return full


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, 'out')
    print('[kuca-radoncica-balica]')
    V, C = load_points()
    U = house_frame(V)
    mesh = build(U)
    P, N, Cc, F = mesh.arrays()
    F, _ = fix_winding(P, N, F)
    area = np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    F = F[area > 1e-8]
    Vw, Fw, _ = weld(P, F)
    CV.ATLAS = ATLAS
    comp, nc, label = CV.make_charts(Vw, Fw)
    Vc, UVp, Fc, chart_of, charts, k = CV.build_atlas(Vw, Fw, comp, nc, label)
    img = bake(Vc, UVp, Fc, U, C)
    fn, fa = CV.face_normals(Vc, Fc)
    Nn = np.zeros_like(Vc)
    for j in range(3): np.add.at(Nn, Fc[:, j], fn * fa[:, None])
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-12)
    # base centre at the origin (like the other models)
    c = np.array([(Vc[:, 0].min() + Vc[:, 0].max()) / 2, Vc[:, 1].min(), (Vc[:, 2].min() + Vc[:, 2].max()) / 2])
    os.makedirs(out, exist_ok=True)
    CV.write_bin(os.path.join(out, 'kuca-radoncica-balica.json'), Vc - c, UVp / ATLAS, Nn, Fc)
    cv2.imwrite(os.path.join(out, 'kuca-radoncica-balica.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 86])
    sz = sum(os.path.getsize(os.path.join(out, 'kuca-radoncica-balica.' + e)) for e in ('json', 'jpg'))
    print(f'  {len(Fc)} triangles, {nc} charts, {k:.0f} texels per metre, {sz / 1024:.0f} KB')
    if '--check' in sys.argv:
        np.savez(os.path.join(sys.argv[sys.argv.index('--check') + 1], 'house_frame.npz'), U=U, C=C)


if __name__ == '__main__':
    main()
