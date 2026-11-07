"""Tidy the scanned building models: clean, straight geometry with each building's own façades.

The eight scans from Gusinjska kocka (models/<id>.json + .jpg) carry real photo textures, but their surfaces are
lumpy: wavy eaves and roof edges, bumpy walls, ragged bases. Here each building gets a clean shell measured on
the scan itself (walls, roofs, towers and the like as exact shapes, in a frame where the scan's largest size is
100 units), and the scan's texture is projected onto it: each part of the new shell is coloured from the scan seen
straight at it (only the scan's surface near that part and facing the same way). Windows, doors, stone, carvings and paint stay exactly as
photographed; only the geometry is straightened. Atlas 1536 px, a light sharpening of the baked texture.

python3 -I tools/models/tidy.py <id> [<id> ...] [--src models] [--out tools/models/out]
The untouched originals are kept in tools/models/orig/ (written on the first run) so re-runs always start from them.
"""
import os, shutil, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import convert as CV
import gkm
from meshio import weld
from buildkit import Mesh, box, lathe, dome, slope, beam, fix_winding, arcade_wall

ROOT = os.path.dirname(os.path.dirname(HERE))
K = (0.5, 0.5, 0.5)        # shapes need a colour; the texture replaces it


# ---------------- source ----------------
def load_source(mid, src):
    """The scan in the measuring frame: centred, base at 0, largest size 100."""
    orig = os.path.join(HERE, 'orig')
    os.makedirs(orig, exist_ok=True)
    for ext in ('json', 'jpg'):
        o = os.path.join(orig, f'{mid}.{ext}')
        if not os.path.exists(o): shutil.copy(os.path.join(src, f'{mid}.{ext}'), o)
    m = gkm.read(os.path.join(orig, f'{mid}.json')); tex = gkm.texture(os.path.join(orig, f'{mid}.jpg'))
    V = m['V']
    c = np.array([(V[:, 0].min() + V[:, 0].max()) / 2, V[:, 1].min(), (V[:, 2].min() + V[:, 2].max()) / 2])
    s = 100 / np.ptp(V, 0).max()
    return (V - c) * s, m['F'], m['UV'], tex


def samples(V, F, UV, tex, n_target=4_000_000, seed=1):
    rng = np.random.default_rng(seed)
    n, area = CV.face_normals(V, F)
    cnt = np.maximum(1, np.round(area / area.sum() * n_target)).astype(np.int64)
    fid = np.repeat(np.arange(len(F)), cnt)
    r1 = np.sqrt(rng.random(len(fid))); r2 = rng.random(len(fid))
    w = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], 1)
    P = np.einsum('ij,ijk->ik', w, V[F[fid]])
    U = np.einsum('ij,ijk->ik', w, UV[F[fid]])
    return P, n[fid], gkm.sample(tex, U)


# ---------------- shapes ----------------
def soffit_ring(m, e, w, y):
    """The underside of the eaves: only the overhang between the walls w and the eaves e (x0, x1, z0, z1)."""
    ex0, ex1, ez0, ez1 = e; wx0, wx1, wz0, wz1 = w
    for a, b, c, d in (((ex0, ez0), (ex1, ez0), (wx1, wz0), (wx0, wz0)), ((ex1, ez0), (ex1, ez1), (wx1, wz1), (wx1, wz0)),
                       ((ex1, ez1), (ex0, ez1), (wx0, wz1), (wx1, wz1)), ((ex0, ez1), (ex0, ez0), (wx0, wz0), (wx0, wz1))):
        m.quad((a[0], y, a[1]), (b[0], y, b[1]), (c[0], y, c[1]), (d[0], y, d[1]), K, nrm=(0, -1, 0), ao=False)


def hip_roof(m, ex0, ex1, ez0, ez1, yE, rx0, rx1, rz0, rz1, yR, fascia=1.6, wall=None):
    """Hipped roof from the eave rectangle (at yE) to a ridge (rx0..rx1 x rz0..rz1 at yR; a point, a line or a
    flat top). With a fascia strip and, given the walls (x0, x1, z0, z1), the underside of the overhang."""
    yF = yE - fascia
    if wall: soffit_ring(m, (ex0, ex1, ez0, ez1), wall, yF)
    box(m, ex0, ex1, yF, yE, ez0, ez1, K, top=False, ao=False)
    slope(m, (ex0, yE, ez1), (ex1, yE, ez1), (rx1, yR, rz1), (rx0, yR, rz1), K, row=1e9, vary=0)
    slope(m, (ex1, yE, ez0), (ex0, yE, ez0), (rx0, yR, rz0), (rx1, yR, rz0), K, row=1e9, vary=0)
    slope(m, (ex1, yE, ez1), (ex1, yE, ez0), (rx1, yR, rz0), (rx1, yR, rz1), K, row=1e9, vary=0)
    slope(m, (ex0, yE, ez0), (ex0, yE, ez1), (rx0, yR, rz1), (rx0, yR, rz0), K, row=1e9, vary=0)
    if rx1 - rx0 > 1e-6 and rz1 - rz0 > 1e-6:
        m.quad((rx0, yR, rz1), (rx1, yR, rz1), (rx1, yR, rz0), (rx0, yR, rz0), K, ao=False)


def gable_roof(m, ex0, ex1, ez0, ez1, yE, yR, along='x', fascia=1.4, gable_wall=None):
    """Gable roof, ridge along x (or z) over the middle of the eave rectangle. gable_wall=(x0, x1, z0, z1):
    close the triangular gables down to the walls."""
    yF = yE - fascia
    if gable_wall: soffit_ring(m, (ex0, ex1, ez0, ez1), gable_wall, yF)
    box(m, ex0, ex1, yF, yE, ez0, ez1, K, top=False, ao=False)
    if along == 'x':
        zc = (ez0 + ez1) / 2
        slope(m, (ex0, yE, ez1), (ex1, yE, ez1), (ex1, yR, zc), (ex0, yR, zc), K, row=1e9, vary=0)
        slope(m, (ex1, yE, ez0), (ex0, yE, ez0), (ex0, yR, zc), (ex1, yR, zc), K, row=1e9, vary=0)
        for x, s in ((ex0, -1), (ex1, 1)):
            P = np.array([(x, yE, ez0), (x, yE, ez1), (x, yR, zc)])
            m.add(P, [(s, 0, 0)] * 3, K, [[0, 1, 2]])
        if gable_wall:
            gx0, gx1, gz0, gz1 = gable_wall
            for x, s in ((gx0, -1), (gx1, 1)):
                P = np.array([(x, yF, gz0), (x, yF, gz1), (x, yR - (yR - yE) * 0.02, zc)])
                m.add(P, [(s, 0, 0)] * 3, K, [[0, 1, 2]])
    else:
        xc = (ex0 + ex1) / 2
        slope(m, (ex1, yE, ez1), (ex1, yE, ez0), (xc, yR, ez0), (xc, yR, ez1), K, row=1e9, vary=0)
        slope(m, (ex0, yE, ez0), (ex0, yE, ez1), (xc, yR, ez1), (xc, yR, ez0), K, row=1e9, vary=0)
        for z, s in ((ez0, -1), (ez1, 1)):
            P = np.array([(ex0, yE, z), (ex1, yE, z), (xc, yR, z)])
            m.add(P, [(0, 0, s)] * 3, K, [[0, 1, 2]])
        if gable_wall:
            gx0, gx1, gz0, gz1 = gable_wall
            for z, s in ((gz0, -1), (gz1, 1)):
                P = np.array([(gx0, yF, z), (gx1, yF, z), (xc, yR - (yR - yE) * 0.02, z)])
                m.add(P, [(0, 0, s)] * 3, K, [[0, 1, 2]])


def walls(m, x0, x1, z0, z1, y0, y1, bands=(), top=False):
    """Four walls (a box without its ends), split into horizontal bands so the texture charts stay square-ish."""
    box(m, x0, x1, y0, y1, z0, z1, K, top=top, bands=bands, ao=False)


# ---------------- the buildings (measuring frame: largest size 100, base y = 0, door towards +Z) ----------------
def kula_rasica():
    m = Mesh()
    walls(m, -35.8, 35.8, -40.8, 32.8, 0, 67.0, bands=(25, 45))
    box(m, -31.5, -11.0, 0, 2.2, 32.8, 40.5, K, ao=False)                  # entrance steps
    box(m, -29.5, -13.0, 2.2, 4.4, 32.8, 37.0, K, ao=False)
    hip_roof(m, -40.3, 40.3, -43.6, 37.6, 69.6, -1.5, 1.5, -4.5, -1.5, 99.8, fascia=2.6, wall=(-35.8, 35.8, -40.8, 32.8))
    return m


OCT = np.pi / 8                 # octagon with its sides facing the axes: start angle, and R = apothem / cos(OCT)


def oct_lathe(m, prof, cx=0.0, cz=0.0):
    """Octagonal stack from [(y, apothem), ...] bottom to top."""
    lathe(m, cx, cz, [(a / np.cos(OCT), y) for y, a in prof], K, seg=8, flat=True, t0=OCT, ao=False)


def crescent(m, cx, cy, cz, r, w=0.18, t=0.15, axis='z'):
    """A small crescent (finials): an arc of thin bars in the x-y plane (axis='z') or z-y plane."""
    ts = np.linspace(0.8 * np.pi, 2.2 * np.pi, 11)            # open at the top
    pts = [(cx + r * np.cos(a), cy + r * np.sin(a) + r, cz) if axis == 'z' else (cx, cy + r * np.sin(a) + r, cz + r * np.cos(a)) for a in ts]
    for p, q in zip(pts[:-1], pts[1:]):
        beam(m, p, q, w, t, K, up=(0, 0, 1) if axis == 'z' else (1, 0, 0))


def kula_nekovica():
    m = Mesh()
    walls(m, -33.6, 32.9, -34.0, 34.2, 0, 40.4, bands=(20,))
    box(m, -35.4, 34.6, 40.4, 42.2, -35.6, 35.8, K, top=True, bottom=True, ao=False)          # floor beams
    walls(m, -34.9, 34.2, -35.3, 35.5, 42.2, 69.4, bands=(56,))
    hip_roof(m, -39.9, 39.7, -40.7, 40.7, 70.6, -0.4, -0.4, -1.7, -1.7, 100.0, fascia=1.6, wall=(-34.9, 34.2, -35.3, 35.5))
    return m


def sahat_kula():
    m = Mesh()
    box(m, -15.4, 15.4, 0, 1.5, -15.4, 15.4, K, ao=False)                                     # platform
    walls(m, -11.65, 11.65, -11.65, 11.65, 1.5, 61.3, bands=(20, 40))
    box(m, -12.25, 12.25, 61.3, 63.2, -12.25, 12.25, K, top=True, bottom=True, ao=False)      # cornice
    walls(m, -10.1, 10.1, -10.1, 10.1, 63.2, 76.8)                                            # clock room, set back
    for sx in (-1, 1):                                                                        # corner piers
        for sz in (-1, 1):
            box(m, min(sx * 11.05, sx * 8.6), max(sx * 11.05, sx * 8.6), 63.2, 76.8, min(sz * 11.05, sz * 8.6), max(sz * 11.05, sz * 8.6), K, top=False, ao=False)
    box(m, -12.3, 12.3, 76.8, 78.6, -12.3, 12.3, K, top=True, bottom=True, ao=False)          # cornice
    hip_roof(m, -13.05, 13.05, -13.05, 13.05, 79.5, 0, 0, 0, 0, 89.6, fascia=0.9, wall=(-12.3, 12.3, -12.3, 12.3))
    lathe(m, 0, 0, [(1.3, 89.4), (1.0, 90.1), (0.45, 91.0), (0.75, 92.0), (0.9, 93.0), (0.36, 94.0), (0.7, 95.0), (0.36, 96.0), (0.3, 97.0), (0.12, 98.3)], K, seg=12, ao=False)
    crescent(m, 0, 98.3, 0, 0.75)
    return m


def opstina():
    m = Mesh()
    box(m, -50.0, 50.0, 0, 1.0, -29.4, 29.4, K, ao=False)                                     # plinth / steps
    walls(m, -48.5, 48.4, -17.0, 19.5, 1.0, 55.5, bands=(20, 41))
    walls(m, -21.2, 20.8, -27.8, -17.0, 1.0, 55.5, bands=(20, 41))                            # back wing
    for x in (-44.5, -34.5, -18.5, -8.5, 7.5, 16.5, 32.2, 44.5):                              # the giant pillars
        box(m, x - 1.6, x + 1.6, 1.0, 41.5, 23.2, 26.4, K, top=False, ao=False)
    box(m, -48.5, 48.4, 41.5, 46.5, 19.5, 27.0, K, top=True, bottom=True, ao=False)          # entablature / balcony
    box(m, -49.3, 49.2, 55.0, 56.0, -17.8, 20.3, K, top=False, bottom=True, ao=False)        # cornice
    hip_roof(m, -49.6, 49.5, -17.9, 20.6, 56.2, -34.0, 34.0, 1.3, 1.3, 58.6, fascia=0.8)
    hip_roof(m, -21.5, 21.5, -17.9, 20.6, 56.2, 0, 0, 1.3, 1.3, 60.6, fascia=0.8)
    hip_roof(m, -25.6, 24.6, -28.8, -16.0, 56.2, -0.5, -0.5, -22.0, -16.0, 59.4, fascia=0.8)
    box(m, 42.6, 44.6, 54.0, 61.0, -15.2, -13.2, K, ao=False)                                # chimney
    return m


def vezirova():
    m = Mesh()
    walls(m, -27.0, 26.6, -46.0, 47.5, 0, 20.2, bands=(10,))
    hip_roof(m, -30.0, 30.0, -49.6, 49.9, 21.2, 0.0, 0.0, -17.0, 16.0, 47.6, fascia=1.0, wall=(-27.0, 26.6, -46.0, 47.5))
    mx, mz = 3.6, 15.6
    lathe(m, mx, mz, [(4.4, 33.0), (4.35, 76.0), (4.65, 77.5), (4.7, 84.0), (5.3, 85.2), (5.3, 88.2), (4.0, 89.6), (2.2, 93.0), (0.5, 96.4)], K, seg=16, ao=False)
    return m


def cekica():
    m = Mesh()
    walls(m, -21.8, 21.6, -40.0, 40.0, 0, 20.0, bands=(10,))
    hip_roof(m, -26.5, 26.5, -42.0, 42.0, 20.8, 0.0, 0.0, -16.0, 14.5, 43.7, fascia=0.9, wall=(-21.8, 21.6, -40.0, 40.0))
    gable_roof(m, -11.2, 11.2, 28.0, 42.6, 20.8, 29.6, along='z', fascia=0.6)                # the gable over the entrance
    mx, mz = 3.9, 11.85
    lathe(m, mx, mz, [(4.75, 30.0), (4.7, 70.5), (5.0, 71.5), (5.0, 76.5), (5.6, 77.5), (5.0, 79.0), (5.0, 82.0), (5.9, 83.3), (4.8, 85.0), (2.7, 88.0), (1.6, 90.5), (0.9, 92.3), (0.45, 93.5), (0.75, 95.0), (0.6, 97.0), (0.15, 98.0)], K, seg=16, ao=False)
    crescent(m, mx, 98.0, mz, 0.9, axis='x')
    return m


def sv_djordje():
    m = Mesh()
    zc = -23.0                                                                               # the apse's centre
    walls(m, -26.1, 25.9, zc, 49.2, 0, 33.0, bands=(16,))
    # apse: half cylinder and half cone
    th = np.linspace(np.pi / 2, 3 * np.pi / 2, 13)                                          # behind the nave (towards -z)
    p = lambda t, r, y: (r * np.sin(t), y, zc + r * np.cos(t))
    for t0, t1 in zip(th[:-1], th[1:]):                                                      # t0 -> t1 runs left to right seen from outside
        m.quad(p(t0, 26.0, 0), p(t1, 26.0, 0), p(t1, 26.0, 33.0), p(t0, 26.0, 33.0), K, ao=False)
        m.quad(p(t0, 28.2, 34.6), p(t1, 28.2, 34.6), p(t1, 0.0, 56.5), p(t0, 0.0, 56.5), K, ao=False)   # cone (apex on the ridge)
        m.quad(p(t0, 28.2, 33.4), p(t1, 28.2, 33.4), p(t1, 26.0, 33.4), p(t0, 26.0, 33.4), K, nrm=(0, -1, 0), ao=False)
        m.quad(p(t0, 28.2, 33.4), p(t1, 28.2, 33.4), p(t1, 28.2, 34.6), p(t0, 28.2, 34.6), K, ao=False)
    # nave roof: gable along z from the front to the apse
    yE, yR = 34.6, 56.5
    slope(m, (28.2, yE, 49.9), (28.2, yE, zc), (0.0, yR, zc), (0.0, yR, 49.9), K, row=1e9, vary=0)
    slope(m, (-28.2, yE, zc), (-28.2, yE, 49.9), (0.0, yR, 49.9), (0.0, yR, zc), K, row=1e9, vary=0)
    for x0, x1 in ((-28.2, -26.1), (25.9, 28.2)):
        m.quad((x0, 33.4, zc), (x1, 33.4, zc), (x1, 33.4, 49.9), (x0, 33.4, 49.9), K, nrm=(0, -1, 0), ao=False)
    box(m, -28.2, 28.2, 33.4, yE, zc, 49.9, K, top=False, ao=False, sides='xXZ')
    P = np.array([(-28.2, yE, 49.9), (28.2, yE, 49.9), (0.0, yR, 49.9)]); m.add(P, [(0, 0, 1)] * 3, K, [[0, 1, 2]])  # front gable
    P = np.array([(-26.1, 33.0, 49.2), (25.9, 33.0, 49.2), (0.0, yR - 0.6, 49.2)]); m.add(P, [(0, 0, 1)] * 3, K, [[0, 1, 2]])
    # bell gable over the front: two open arches with bells, a cornice, one open arch above, a cross on top
    box(m, -9.0, 9.0, 47.0, 55.6, 45.0, 49.5, K, ao=False)
    arcade_wall(m, -9.0, 9.0, 66.4, 49.5, 4.5, [(-3.75, 3.4, 59.2), (3.45, 3.4, 59.2)], K, y0=55.6)
    box(m, -9.0, 9.0, 66.0, 66.4, 45.0, 49.5, K, top=False, ao=False)
    box(m, -9.6, 9.6, 66.4, 67.6, 44.6, 49.9, K, ao=False)
    box(m, -4.6, 5.0, 67.6, 70.2, 45.4, 49.1, K, ao=False)
    arcade_wall(m, -4.6, 5.0, 79.4, 49.1, 3.7, [(0.2, 3.2, 74.6)], K, y0=70.2)
    box(m, -5.2, 5.6, 79.4, 80.4, 45.0, 49.5, K, ao=False)
    for bx, by in ((-3.75, 56.2), (3.45, 56.2)):                                              # the bells
        lathe(m, bx, 47.3, [(1.45, by), (1.3, by + 0.5), (0.95, by + 1.6), (0.85, by + 2.6), (0.55, by + 3.1), (0.0, by + 3.3)], K, seg=14, cap_bot=True, ao=False)
        beam(m, (bx, by + 3.3, 47.3), (bx, 60.6, 47.3), 0.25, 0.25, K)
    beam(m, (0.2, 80.4, 47.3), (0.2, 87.5, 47.3), 0.7, 0.7, K)
    beam(m, (-1.8, 85.2, 47.3), (2.2, 85.2, 47.3), 0.6, 0.6, K)
    return m


def sebilj():
    m = Mesh()
    oct_lathe(m, [(0.0, 18.6), (12.3, 18.6), (12.3, 19.3), (14.3, 19.3), (14.3, 15.8), (58.4, 15.8), (58.6, 25.0),
                  (59.4, 33.8), (62.5, 34.3), (69.0, 16.6), (74.5, 16.8), (75.0, 15.6)])
    for sx in (-1, 1):                                                                         # the low benches either side
        box(m, min(sx * 17.6, sx * 25.5), max(sx * 17.6, sx * 25.5), 0, 5.6, -6.0, 8.0, K, ao=False)
    for k in range(8):                                                                         # carved brackets at the corners
        t = OCT + k * np.pi / 4
        d = np.array([np.sin(t), 0, np.cos(t)]); R = 15.8 / np.cos(OCT)
        beam(m, d * (R - 0.4) + (0, 44.5, 0), d * 25.0 + (0, 58.3, 0), 1.3, 1.3, K)
        beam(m, d * (R - 0.4) + (0, 57.6, 0), d * 25.0 + (0, 57.6, 0), 1.2, 1.4, K)
    lathe(m, 0, 0, [(16.4, 75.0), (16.0, 76.5), (15.0, 78.0), (14.2, 80.0), (13.4, 82.0), (12.2, 84.0), (10.7, 86.0),
                    (8.6, 87.6), (6.0, 89.0), (3.5, 90.2), (0.8, 91.0)], K, seg=32, ao=False)
    lathe(m, 0, 0, [(0.5, 91.0), (0.9, 95.0), (0.55, 96.0), (0.3, 97.0), (0.1, 99.8)], K, seg=10, ao=False)
    return m


BUILD = {'kula-rasica': kula_rasica, 'kula-nekovica': kula_nekovica, 'sahat-kula': sahat_kula, 'opstina': opstina,
         'vezirova-dzamija': vezirova, 'cekica-dzamija': cekica, 'sv-djordje': sv_djordje, 'sebilj': sebilj}


# ---------------- bake ----------------
def raster(Vc, UVp, Fc, chart_of_vert, atlas):
    """3D position, chart and normal of every atlas texel covered by the new shell."""
    pos = np.zeros((atlas, atlas, 3), np.float32); chart = np.full((atlas, atlas), -1, np.int32)
    n, _ = CV.face_normals(Vc, Fc)
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
        pos[yy, xx] = L @ Vc[Fc[f]]; chart[yy, xx] = chart_of_vert[Fc[f, 0]]
    return pos, chart


def ortho(V, F, UV, tex, e1, e2, d, x0, y0, W, H, r, order=None):
    """The scan's faces F seen straight along -d (from the +d side), e1 right and e2 down, r px per unit, drawn
    in the given order (later on top; default: far first). Returns the picture and where it is covered."""
    img = np.zeros((H, W, 3), np.uint8); cov = np.zeros((H, W), np.uint8)
    sx, sy = (V @ e1 - x0) * r, (V @ e2 - y0) * r
    th, tw = tex.shape[:2]
    for i in (F[order] if order is not None else F[np.argsort((V[F].mean(1)) @ d)]):
        dst = np.float32(np.stack([sx[i], sy[i]], 1))
        bx0, by0 = np.floor(dst.min(0)).astype(int); bx1, by1 = np.ceil(dst.max(0)).astype(int) + 2
        bx0, by0 = max(bx0, 0), max(by0, 0); bx1, by1 = min(bx1, W), min(by1, H)
        if bx1 <= bx0 or by1 <= by0: continue
        m = np.zeros((by1 - by0, bx1 - bx0), np.uint8)
        cv2.fillConvexPoly(m, np.int32(np.round((dst - [bx0, by0]) * 4)), 1, cv2.LINE_8, 2)
        m = cv2.dilate(m, np.ones((2, 2), np.uint8))     # no cracks between neighbouring triangles
        src = np.float32(UV[i] * [tw, th])
        try: M = cv2.getAffineTransform(src, dst - np.float32([bx0, by0]))
        except cv2.error: continue
        patch = cv2.warpAffine(tex, M, (bx1 - bx0, by1 - by0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        reg = img[by0:by1, bx0:bx1]; reg[m > 0] = patch[m > 0]; cov[by0:by1, bx0:bx1][m > 0] = 1
    return img, cov


def project(pos, chart, charts, V0, F0, UV0, tex, k, slab=3.0):
    """Colour each texel from the scan, chart by chart, looking at the scan straight along the chart's direction."""
    from scipy.spatial import cKDTree
    H, W = chart.shape
    out = np.zeros((H, W, 3), np.uint8); got = np.zeros((H, W), bool)
    n0, _ = CV.face_normals(V0, F0); c0 = V0[F0].mean(1)
    r = max(4.0, k * 1.6)
    for ci, ch in enumerate(charts):
        sel = chart == ci
        if not sel.any(): continue
        Q = pos[sel].astype(float)
        d = np.asarray(ch['d'], float); d /= np.linalg.norm(d)
        e1 = np.cross(d, [0, 1, 0]) if abs(d[1]) < 0.9 else np.cross(d, [0, 0, 1]); e1 /= np.linalg.norm(e1)
        e2 = np.cross(d, e1)
        # the scan's faces near this chart and facing roughly the same way
        # (distance of a scan triangle = the nearest of its corners, edge middles and centre: big triangles count too)
        sub = Q[:: max(1, len(Q) // 40000)]
        tree = cKDTree(sub)
        pts = np.concatenate([V0[F0], (V0[F0] + V0[F0][:, [1, 2, 0]]) / 2, c0[:, None]], 1)       # (nf, 7, 3)
        dist, _ = tree.query(pts.reshape(-1, 3), distance_upper_bound=slab + 4.0)
        dist = dist.reshape(len(F0), 7).min(1)
        fs = np.nonzero(np.isfinite(dist) & (n0 @ d > 0.15))[0]
        if not len(fs): continue
        order = np.argsort(-dist[fs])                     # the scan's surface nearest to the new shell ends on top
        u, v = Q @ e1, Q @ e2
        x0, y0 = u.min() - 2, v.min() - 2
        Wp, Hp = int((u.max() - x0 + 2) * r) + 2, int((v.max() - y0 + 2) * r) + 2
        img, cov = ortho(V0, F0[fs], UV0, tex, e1, e2, d, x0, y0, Wp, Hp, r, order)
        px = np.clip(((u - x0) * r).astype(np.float32), 0, Wp - 1); py = np.clip(((v - y0) * r).astype(np.float32), 0, Hp - 1)
        nq = len(px); Wq = 2048; rows = (nq + Wq - 1) // Wq
        mx = np.zeros(rows * Wq, np.float32); my = np.zeros(rows * Wq, np.float32); mx[:nq] = px; my[:nq] = py
        col = cv2.remap(img, mx.reshape(rows, Wq), my.reshape(rows, Wq), cv2.INTER_LINEAR).reshape(-1, 3)[:nq]
        ok = cov[py.astype(int), px.astype(int)] > 0
        yy, xx = np.nonzero(sel)
        out[yy[ok], xx[ok]] = col[ok]; got[yy[ok], xx[ok]] = True
    # the scan's own holes (pure white in its texture) count as missing too
    white = got & (out.min(2) >= 247)
    white = cv2.morphologyEx(white.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    got &= ~white
    # holes inside the shell: painted in from around (no streaks); gutters: nearest coloured texel
    from scipy import ndimage
    inside = chart >= 0
    _, (iy, ix) = ndimage.distance_transform_edt(~got, return_indices=True)
    full = out[iy, ix]
    hole = (inside & ~got).astype(np.uint8)
    if hole.any():
        small = cv2.resize(full, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
        hs = cv2.resize(hole, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
        painted = cv2.resize(cv2.inpaint(small, hs, 6, cv2.INPAINT_TELEA), (full.shape[1], full.shape[0]), interpolation=cv2.INTER_LINEAR)
        full[hole > 0] = painted[hole > 0]
    return full, got, inside


def bake_model(mid, mesh, src, out, atlas=1536, sharpen=0.5):
    V0, F0, UV0, tex = load_source(mid, src)
    P, N, C, F = mesh.arrays()
    F, _ = fix_winding(P, N, F)
    area = np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    F = F[area > 1e-8]
    Vw, Fw, _ = weld(P, F)
    CV.ATLAS = atlas
    comp, nc, label = CV.make_charts(Vw, Fw)
    Vc, UVp, Fc, chart_of, charts, k = CV.build_atlas(Vw, Fw, comp, nc, label)
    pos, chart = raster(Vc, UVp, Fc, chart_of, atlas)
    img, got, inside = project(pos, chart, charts, V0, F0, UV0, tex, k)
    if sharpen:
        blur = cv2.GaussianBlur(img, (0, 0), 1.3)
        img = cv2.addWeighted(img, 1 + sharpen, blur, -sharpen, 0)
    fn, fa = CV.face_normals(Vc, Fc)
    Nn = np.zeros_like(Vc)
    for j in range(3): np.add.at(Nn, Fc[:, j], fn * fa[:, None])
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-12)
    os.makedirs(out, exist_ok=True)
    CV.write_bin(os.path.join(out, f'{mid}.json'), Vc, UVp / atlas, Nn, Fc)
    cv2.imwrite(os.path.join(out, f'{mid}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 86])
    sz = os.path.getsize(os.path.join(out, f'{mid}.json')) + os.path.getsize(os.path.join(out, f'{mid}.jpg'))
    miss = 1 - got[inside].mean()
    print(f'{mid}: {len(Fc)} triangles, {nc} charts, {k:.1f} texels per unit, {sz / 1024:.0f} KB, {100 * miss:.1f} % of the shell filled from neighbours')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = sys.argv[sys.argv.index('--src') + 1] if '--src' in sys.argv else os.path.join(ROOT, 'models')
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, 'out')
    args = [a for a in args if a not in (src, out)]
    for mid in args or BUILD:
        bake_model(mid, BUILD[mid](), src, out)


if __name__ == '__main__':
    main()
