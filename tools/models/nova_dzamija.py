"""Nova džamija (Gusinje), rebuilt as a clean model from measurements of the user's RealityScan scan.

The scan (tools/models/scans/, 7 Nov 2026) is a drone photogrammetry mesh: good proportions, but lumpy walls,
holes, blotchy colour and a ragged base, which looked like a ruin once cut out and shrunk for the cube. Here the
mosque is built again from simple, exact shapes with the scan's sizes (metres, measured on orthographic views of
the levelled scan): prayer hall with a dome on an octagonal drum, the arcaded porch, the side wing, the open
pavilion with the small dome, and the minaret with its balcony and lead cone. Colours from the scan.

python3 -I tools/models/nova_dzamija.py [--out models] [--check DIR]
Output: <out>/nova-dzamija.json (GKM1 with per-vertex colours, no texture). Y up, base at y = 0, porch towards +Z.
"""
import base64, json, os, struct, sys
import numpy as np

# ---------------- colours (sRGB 0..1) ----------------
WALL = (0.86, 0.855, 0.84)        # white plaster (scan: minaret 0.83, walls 0.70 in shade)
TRIM = (0.80, 0.795, 0.78)        # cornices
STONE = (0.62, 0.60, 0.57)        # plinth course
PAVE = (0.70, 0.68, 0.64)         # platform and steps
LEAD = (0.25, 0.28, 0.335)        # domes and the minaret cone (scan: 0.25 0.28 0.33)
LEAD_D = (0.19, 0.21, 0.255)
FRAME = (0.43, 0.29, 0.20)        # window frames, door
GLASS = (0.09, 0.10, 0.13)
SHADE = (0.55, 0.54, 0.53)        # porch ceiling
GOLD = (0.78, 0.64, 0.30)         # finials


class Mesh:
    def __init__(self):
        self.P, self.N, self.C, self.F = [], [], [], []
        self.n = 0

    def add(self, P, N, C, F):
        P = np.asarray(P, float); N = np.asarray(N, float); C = np.asarray(C, float)
        if C.ndim == 1: C = np.tile(C, (len(P), 1))
        self.P.append(P); self.N.append(N); self.C.append(C); self.F.append(np.asarray(F, int) + self.n)
        self.n += len(P)

    def quad(self, a, b, c, d, col, nrm=None, ao=True):
        """a b c d counter-clockwise seen from outside."""
        P = np.array([a, b, c, d], float)
        n = np.cross(P[1] - P[0], P[2] - P[0]) if nrm is None else np.asarray(nrm, float)
        n = n / np.linalg.norm(n)
        self.add(P, np.tile(n, (4, 1)), shade(P, col, ao), [[0, 1, 2], [0, 2, 3]])

    def arrays(self):
        return np.concatenate(self.P), np.concatenate(self.N), np.concatenate(self.C), np.concatenate(self.F)


def shade(P, col, ao=True):
    """Colour per vertex, a little darker near the ground (soft contact shadow baked in)."""
    c = np.tile(np.asarray(col, float), (len(P), 1))
    if ao:
        y = np.clip(P[:, 1] / 2.2, 0, 1)
        c *= (0.80 + 0.20 * (y * y * (3 - 2 * y)))[:, None]
    return c


def box(m, x0, x1, y0, y1, z0, z1, col, top=True, bottom=False, bands=(), ao=True, sides='xXzZ'):
    """Axis box; side faces split at heights `bands` so the ground shading stays near the ground."""
    ys = [y0] + [b for b in bands if y0 < b < y1] + [y1]
    for k in range(len(ys) - 1):
        a, b = ys[k], ys[k + 1]
        if 'Z' in sides: m.quad((x0, a, z1), (x1, a, z1), (x1, b, z1), (x0, b, z1), col, ao=ao)
        if 'z' in sides: m.quad((x1, a, z0), (x0, a, z0), (x0, b, z0), (x1, b, z0), col, ao=ao)
        if 'X' in sides: m.quad((x1, a, z1), (x1, a, z0), (x1, b, z0), (x1, b, z1), col, ao=ao)
        if 'x' in sides: m.quad((x0, a, z0), (x0, a, z1), (x0, b, z1), (x0, b, z0), col, ao=ao)
    if top: m.quad((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), col, ao=False)
    if bottom: m.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), col, ao=False)


def ring_box(m, x0, x1, z0, z1, y0, y1, out, col):
    """A cornice or plinth course round a rectangle, `out` beyond it."""
    box(m, x0 - out, x1 + out, y0, y1, z0 - out, z1 + out, col, top=True, bottom=True, ao=False)


def lathe(m, cx, cz, prof, col, seg=48, flat=False, cap_top=False, cap_bot=False, ao=True):
    """Surface of revolution through profile [(r, y), ...] bottom to top. flat: faceted (one normal per side)."""
    prof = np.asarray(prof, float)
    th = np.linspace(0, 2 * np.pi, seg + 1)
    if flat:
        for i in range(seg):
            for j in range(len(prof) - 1):
                (r0, y0), (r1, y1) = prof[j], prof[j + 1]
                t0, t1 = th[i], th[i + 1]
                a = (cx + r0 * np.sin(t0), y0, cz + r0 * np.cos(t0)); b = (cx + r0 * np.sin(t1), y0, cz + r0 * np.cos(t1))
                c = (cx + r1 * np.sin(t1), y1, cz + r1 * np.cos(t1)); d = (cx + r1 * np.sin(t0), y1, cz + r1 * np.cos(t0))
                if r0 < 1e-6 and r1 < 1e-6: continue
                m.quad(a, b, c, d, col, ao=ao) if r1 > 1e-6 or r0 > 1e-6 else None
    else:
        # smooth: normal from the profile's slope
        P, N = [], []
        for j, (r, y) in enumerate(prof):
            if j == 0: dr, dy = prof[1] - prof[0]
            elif j == len(prof) - 1: dr, dy = prof[j] - prof[j - 1]
            else: dr, dy = prof[j + 1] - prof[j - 1]
            nr, ny = dy, -dr
            l = np.hypot(nr, ny) or 1; nr, ny = nr / l, ny / l
            for t in th:
                P.append((cx + r * np.sin(t), y, cz + r * np.cos(t))); N.append((nr * np.sin(t), ny, nr * np.cos(t)))
        F = []
        W = seg + 1
        for j in range(len(prof) - 1):
            for i in range(seg):
                a, b, c, d = j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i
                F += [[a, b, c], [a, c, d]]
        P = np.array(P)
        m.add(P, N, shade(P, col, ao), F)
    for cap, (r, y), up in ((cap_top, prof[-1], 1), (cap_bot, prof[0], -1)):
        if not cap or r < 1e-6: continue
        P = [(cx, y, cz)] + [(cx + r * np.sin(t), y, cz + r * np.cos(t)) for t in th[:-1]]
        F = [[0, 1 + i, 1 + (i + 1) % seg] if up > 0 else [0, 1 + (i + 1) % seg, 1 + i] for i in range(seg)]
        m.add(P, [(0, up, 0)] * len(P), col, F)


def dome(m, cx, cz, y0, a, b, col, seg=64, rings=18):
    """Upper half of an ellipsoid (radius a, height b), smooth."""
    prof = [(a * np.cos(t), y0 + b * np.sin(t)) for t in np.linspace(0, np.pi / 2, rings + 1)]
    prof[-1] = (0.0, y0 + b)
    P, N, F = [], [], []
    th = np.linspace(0, 2 * np.pi, seg + 1)
    for (r, y) in prof:
        for t in th:
            x, z = r * np.sin(t), r * np.cos(t)
            n = np.array([x / a ** 2, (y - y0) / b ** 2, z / a ** 2]); n /= np.linalg.norm(n)
            P.append((cx + x, y, cz + z)); N.append(n)
    W = seg + 1
    for j in range(rings):
        for i in range(seg):
            p, q, r_, s = j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i
            F += [[p, q, r_], [p, r_, s]]
    P = np.array(P)
    # lead sheets: faint seams every 15°
    C = np.tile(np.asarray(col, float), (len(P), 1))
    ang = np.arctan2(P[:, 0] - cx, P[:, 2] - cz)
    seam = np.cos(ang * 24) > 0.93
    C[seam] *= 0.86
    m.add(P, N, C, F)


def finial(m, cx, cz, y0, s=1.0):
    lathe(m, cx, cz, [(0.05 * s, y0), (0.05 * s, y0 + 0.18 * s)], GOLD, seg=10, ao=False)
    lathe(m, cx, cz, [(0.0, y0 + 0.14 * s)] + [(0.16 * s * np.sin(t), y0 + 0.30 * s - 0.16 * s * np.cos(t)) for t in np.linspace(0.15, np.pi - 0.15, 9)] + [(0.0, y0 + 0.46 * s)], GOLD, seg=14, ao=False)
    lathe(m, cx, cz, [(0.04 * s, y0 + 0.44 * s), (0.0, y0 + 0.75 * s)], GOLD, seg=10, ao=False)


def window(m, face, u, y0, y1, w, wall, arch=False):
    """A framed window on a wall. face: '+x' '-x' '+z' '-z'; u: position along the wall; wall: the wall's coordinate."""
    out = {'+x': (1, 0), '-x': (-1, 0), '+z': (0, 1), '-z': (0, -1)}[face]
    def P(a, y, d):            # a along the wall (left to right seen from outside), d outwards
        if face == '+z': return (a, y, wall + d)
        if face == '-z': return (-a, y, wall - d)
        if face == '+x': return (wall + d, y, -a)
        return (wall - d, y, a)
    a = u if face in ('+z', '-x') else -u          # u: x on the z walls, z on the x walls
    n = (out[0], 0, out[1])
    fr, d = 0.09, 0.07
    # frame (four bars) and the pane slightly behind the frame's face
    for (a0, a1, b0, b1) in ((a - w / 2, a + w / 2, y0, y0 + fr), (a - w / 2, a + w / 2, y1 - fr, y1),
                             (a - w / 2, a - w / 2 + fr, y0, y1), (a + w / 2 - fr, a + w / 2, y0, y1)):
        m.quad(P(a0, b0, d), P(a1, b0, d), P(a1, b1, d), P(a0, b1, d), FRAME, nrm=n, ao=False)
    m.quad(P(a - w / 2 + fr, y0 + fr, 0.03), P(a + w / 2 - fr, y0 + fr, 0.03), P(a + w / 2 - fr, y1 - fr, 0.03), P(a - w / 2 + fr, y1 - fr, 0.03), GLASS, nrm=n, ao=False)
    # sill
    m.quad(P(a - w / 2 - 0.06, y0 - 0.02, 0.14), P(a + w / 2 + 0.06, y0 - 0.02, 0.14), P(a + w / 2 + 0.06, y0 - 0.02, 0.0), P(a - w / 2 - 0.06, y0 - 0.02, 0.0), TRIM, nrm=(0, 1, 0), ao=False)
    m.quad(P(a - w / 2 - 0.06, y0 - 0.14, 0.14), P(a + w / 2 + 0.06, y0 - 0.14, 0.14), P(a + w / 2 + 0.06, y0 - 0.02, 0.14), P(a - w / 2 - 0.06, y0 - 0.02, 0.14), TRIM, nrm=n, ao=False)
    if arch:      # a round head over the window
        r = w / 2
        ts = np.linspace(0, np.pi, 13)
        pts = [P(a + r * np.cos(t), y1 + r * np.sin(t), 0.03) for t in ts]
        c = P(a, y1, 0.03)
        Pm = np.array([c] + pts)
        Fm = [[0, i + 1, i + 2] for i in range(len(ts) - 1)]
        m.add(Pm, [n] * len(Pm), GLASS, Fm)


def arcade_wall(m, x0, x1, H, z_out, t, openings, col):
    """A wall in the plane z = z_out (outside face, facing +Z), thickness t, with round-headed openings
    [(cx, w, spring_y)] from the floor."""
    zi = z_out - t
    xs = sorted(openings)
    edges = [x0]
    for cx, w, ys in xs: edges += [cx - w / 2, cx + w / 2]
    edges.append(x1)
    for k in range(0, len(edges), 2):           # piers
        a, b = edges[k], edges[k + 1]
        if b - a < 1e-6: continue
        for y_a, y_b in ((0, 2.2), (2.2, H)):
            m.quad((a, y_a, z_out), (b, y_a, z_out), (b, y_b, z_out), (a, y_b, z_out), col)
            m.quad((b, y_a, zi), (a, y_a, zi), (a, y_b, zi), (b, y_b, zi), SHADE_W)
    for cx, w, ys in xs:
        r = w / 2
        ts = np.linspace(np.pi, 0, 15)            # left to right along the arch
        arc = [(cx + r * np.cos(tt), ys + r * np.sin(tt)) for tt in ts]
        for (ax, ay), (bx, by) in zip(arc[:-1], arc[1:]):      # spandrels, front and back
            m.quad((ax, ay, z_out), (bx, by, z_out), (bx, H, z_out), (ax, H, z_out), col)
            m.quad((bx, by, zi), (ax, ay, zi), (ax, H, zi), (bx, H, zi), SHADE_W)
            # the arch's underside, facing the opening's middle
            mx, my = (ax + bx) / 2 - cx, (ay + by) / 2 - ys
            m.quad((bx, by, z_out), (ax, ay, z_out), (ax, ay, zi), (bx, by, zi), TRIM, nrm=(-mx, -my, 0), ao=False)
        for sx in (-1, 1):                         # jambs
            x = cx + sx * r
            if sx < 0: m.quad((x, 0, zi), (x, 0, z_out), (x, ys, z_out), (x, ys, zi), TRIM, nrm=(1, 0, 0))
            else: m.quad((x, 0, z_out), (x, 0, zi), (x, ys, zi), (x, ys, z_out), TRIM, nrm=(-1, 0, 0))
    # wall ends
    m.quad((x0, 0, zi), (x0, 0, z_out), (x0, H, z_out), (x0, H, zi), col, nrm=(-1, 0, 0))
    m.quad((x1, 0, z_out), (x1, 0, zi), (x1, H, zi), (x1, H, z_out), col, nrm=(1, 0, 0))


SHADE_W = (0.74, 0.735, 0.72)     # inside faces of the porch walls


def build():
    m = Mesh()
    B = 0.3                                          # everything stands on a 30 cm stone platform
    # ---- platform and steps ----
    box(m, -9.7, 9.0, 0, B, -9.6, 10.7, PAVE, ao=False)
    box(m, -3.0, 0.5, 0, 0.15, 10.7, 11.35, PAVE, ao=False)

    # ---- prayer hall: x -6.6..4.2, z -8.9..6.5, walls to 8.5 ----
    hx0, hx1, hz0, hz1, hH = -6.6, 4.2, -8.9, 6.5, 8.5
    box(m, hx0, hx1, B, B + hH, hz0, hz1, WALL, bands=(B + 1.2, B + 2.5))
    ring_box(m, hx0, hx1, hz0, hz1, B, B + 0.45, 0.06, STONE)
    ring_box(m, hx0, hx1, hz0, hz1, B + hH - 0.05, B + hH + 0.22, 0.16, TRIM)
    # roof hatch on the flat front part
    box(m, -2.2, -0.8, B + hH + 0.22, B + hH + 0.6, 2.4, 3.4, TRIM, ao=False)

    # ---- drum (octagon) and the main dome ----
    dcx, dcz = -1.2, -3.8
    yD = B + hH + 0.22
    lathe(m, dcx, dcz, [(4.62, yD), (4.62, yD + 1.0)], WALL, seg=8, flat=True, cap_top=True, ao=False)
    lathe(m, dcx, dcz, [(4.70, yD + 1.0), (4.70, yD + 1.12)], TRIM, seg=8, flat=True, cap_top=True, ao=False)
    for k in range(8):                                # one small window per side of the drum
        t = (k + 0.5) * 2 * np.pi / 8
        ap = 4.62 * np.cos(np.pi / 8) + 0.02
        cxw, czw = dcx + ap * np.sin(t), dcz + ap * np.cos(t)
        tx, tz = np.cos(t), -np.sin(t)
        w, y0, y1 = 0.75, yD + 0.35, yD + 0.72
        P = [(cxw - tx * w / 2, y0, czw - tz * w / 2), (cxw + tx * w / 2, y0, czw + tz * w / 2), (cxw + tx * w / 2, y1, czw + tz * w / 2), (cxw - tx * w / 2, y1, czw - tz * w / 2)]
        m.quad(*P, GLASS, nrm=(np.sin(t), 0, np.cos(t)), ao=False)
    dome(m, dcx, dcz, yD + 1.12, 4.25, 4.0, LEAD)
    lathe(m, dcx, dcz, [(4.3, yD + 1.12), (4.3, yD + 1.24)], LEAD_D, seg=64, ao=False)
    finial(m, dcx, dcz, yD + 5.08, 1.1)

    # ---- side wing (left of the hall's front part) ----
    box(m, -8.4, hx0, B, B + 4.6, 1.2, 6.5, WALL, bands=(B + 1.2, B + 2.5), sides='xzZ')
    ring_box(m, -8.4, hx0 + 0.01, 1.2, 6.5, B, B + 0.45, 0.06, STONE)
    ring_box(m, -8.4, hx0 + 0.01, 1.2, 6.5, B + 4.6 - 0.05, B + 4.6 + 0.2, 0.14, TRIM)

    # ---- porch: x -9.0..4.9, z 6.5..10.0, roof at 4.9, five arches in front, one at the side ----
    px0, px1, pz0, pz1, pH = -9.0, 4.9, 6.5, 10.0, 4.6
    arches = [(-6.45, 1.9, B + 2.1), (-3.85, 1.9, B + 2.1), (-1.25, 2.0, B + 2.15), (1.35, 1.9, B + 2.1), (3.9, 1.8, B + 2.1)]
    arcade_wall(m, px0, px1, B + pH, pz1, 0.45, arches, WALL)
    # side wall (x = -9.0) with one arch: build it as an arcade wall turned by 90°
    side = Mesh()
    arcade_wall(side, pz0, pz1, B + pH, 0.0, 0.45, [(8.25, 1.7, B + 2.0)], WALL)
    P, N, C, F = side.arrays()
    R = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float)      # (x, y, z) -> (-z, y, x): the wall faces -X
    P = P @ R.T; N = N @ R.T; P[:, 0] += px0
    m.add(P, N, C, F)
    box(m, px0, px1, B + pH, B + pH + 0.3, pz0, pz1, TRIM, bottom=True, ao=False)     # roof slab (underside in shade)
    box(m, px0 - 0.15, px1 + 0.15, B + pH + 0.3, B + pH + 0.42, pz0, pz1 + 0.15, TRIM, bottom=True, ao=False)
    ring_box(m, px0, px1, pz1 - 0.45, pz1, B, B + 0.45, 0.06, STONE)
    # under the porch: the hall's door and two windows
    box(m, -2.0, -0.5, B, B + 2.5, hz1, hz1 + 0.06, FRAME, ao=False)
    lathe_arch = [(-1.25 + 0.75 * np.cos(tt), B + 2.5 + 0.75 * np.sin(tt)) for tt in np.linspace(0, np.pi, 13)]
    Pm = np.array([(-1.25, B + 2.5, hz1 + 0.06)] + [(x, y, hz1 + 0.06) for x, y in lathe_arch])
    m.add(Pm, [(0, 0, 1)] * len(Pm), FRAME, [[0, i + 1, i + 2] for i in range(12)])
    for wx in (-4.2, 1.8):
        window(m, '+z', wx, B + 1.0, B + 2.3, 0.9, hz1)

    # ---- hall windows ----
    for z in (-5.3, -2.3):
        for (y0, y1) in ((B + 2.4, B + 3.8), (B + 5.9, B + 7.3)):
            window(m, '-x', z, y0, y1, 0.95, hx0)
            window(m, '+x', z, y0, y1, 0.95, hx1)
    for z in (0.5, 2.5, 4.4):
        window(m, '-x', z, B + 5.9, B + 7.1, 0.85, hx0, arch=True)
    for x in (-4.0, 2.0):
        for (y0, y1) in ((B + 2.4, B + 3.8), (B + 5.9, B + 7.3)):
            window(m, '-z', x, y0, y1, 0.95, hz0)
    for x in (-4.2, -1.3, 1.8):
        window(m, '+z', x, B + 6.0, B + 7.3, 0.95, hz1)
    window(m, '-x', 3.8, B + 1.6, B + 2.9, 0.9, -8.4)

    # ---- open pavilion with the small dome (front right) ----
    qx0, qx1, qz0, qz1 = 3.9, 8.5, 3.2, 10.0
    box(m, qx0, qx1, B + pH, B + pH + 0.3, qz0, qz1, TRIM, bottom=True, ao=False)
    box(m, qx0 - 0.15, qx1 + 0.15, B + pH + 0.3, B + pH + 0.42, qz0 - 0.15, qz1 + 0.15, TRIM, bottom=True, ao=False)
    for (cx, cz) in ((8.2, 3.5), (8.2, 6.6), (8.2, 9.7), (6.6, 9.7), (5.25, 9.7), (5.25, 3.5)):
        lathe(m, cx, cz, [(0.26, B), (0.26, B + 0.35)], STONE, seg=16, cap_top=True, ao=False)
        lathe(m, cx, cz, [(0.17, B + 0.35), (0.15, B + pH - 0.3), (0.24, B + pH)], WALL, seg=16, ao=True)
    lathe(m, 6.2, 6.0, [(0.9, B + 0.6), (0.0, B + 0.6)], STONE, seg=24)                     # fountain basin rim
    lathe(m, 6.2, 6.0, [(0.9, B), (0.9, B + 0.6)], STONE, seg=24)
    lathe(m, 6.2, 6.0, [(0.82, B + 0.62), (0.0, B + 0.62)], (0.30, 0.42, 0.50), seg=24, ao=False)
    lathe(m, 6.2, 5.5, [(2.3, B + pH + 0.42), (2.3, B + pH + 0.6)], TRIM, seg=48, cap_top=True, ao=False)
    dome(m, 6.2, 5.5, B + pH + 0.6, 2.25, 2.1, LEAD, seg=48, rings=14)
    finial(m, 6.2, 5.5, B + pH + 2.65, 0.75)

    # ---- minaret at (6.2, 0.15): square base to 5.2, 12-sided shaft, balcony at 17.8, lead cone to 26.9 ----
    mx, mz = 6.2, 0.15
    box(m, mx - 1.2, mx + 1.2, B, B + 4.9, mz - 1.2, mz + 1.2, WALL, bands=(B + 1.2, B + 2.5))
    ring_box(m, mx - 1.2, mx + 1.2, mz - 1.2, mz + 1.2, B, B + 0.45, 0.06, STONE)
    ring_box(m, mx - 1.2, mx + 1.2, mz - 1.2, mz + 1.2, B + 4.75, B + 4.95, 0.12, TRIM)
    lathe(m, mx, mz, [(1.2, B + 4.95), (1.08, B + 5.6)], WALL, seg=12, flat=True, ao=False)
    lathe(m, mx, mz, [(1.08, B + 5.6), (1.08, B + 13.8)], WALL, seg=12, flat=True, ao=False)
    lathe(m, mx, mz, [(1.15, B + 13.8), (1.15, B + 14.05)], TRIM, seg=12, flat=True, cap_top=True, cap_bot=True, ao=False)
    lathe(m, mx, mz, [(1.07, B + 14.05), (1.07, B + 16.8)], WALL, seg=12, flat=True, ao=False)
    lathe(m, mx, mz, [(1.07, B + 16.8), (1.22, B + 17.25), (1.5, B + 17.6)], TRIM, seg=12, flat=True, ao=False)   # corbel
    lathe(m, mx, mz, [(1.58, B + 17.6), (1.58, B + 17.72)], TRIM, seg=24, cap_top=True, cap_bot=True, ao=False)  # balcony floor
    lathe(m, mx, mz, [(1.52, B + 17.72), (1.52, B + 18.75)], WALL, seg=24, ao=False)                            # parapet out
    lathe(m, mx, mz, [(1.40, B + 18.75), (1.40, B + 17.72)], WALL, seg=24, ao=False)                            # parapet in
    lathe(m, mx, mz, [(1.56, B + 18.75), (1.40, B + 18.75)], TRIM, seg=24, ao=False)                            # coping
    lathe(m, mx, mz, [(1.56, B + 18.75), (1.56, B + 18.85), (1.38, B + 18.85)], TRIM, seg=24, ao=False)
    lathe(m, mx, mz, [(0.78, B + 17.72), (0.78, B + 21.9)], WALL, seg=12, flat=True, ao=False)                  # upper shaft
    for k in range(4):                                                                                           # door onto the balcony and small windows
        t = k * np.pi / 2 + np.pi / 12
        ap = 0.78 * np.cos(np.pi / 12) + 0.01
        cxw, czw = mx + ap * np.sin(t), mz + ap * np.cos(t)
        tx, tz = np.cos(t), -np.sin(t)
        w, y0, y1 = 0.32, B + 18.9 + (0 if k == 0 else 1.2), B + 20.0 + (0 if k == 0 else 0.6)
        m.quad((cxw - tx * w / 2, y0, czw - tz * w / 2), (cxw + tx * w / 2, y0, czw + tz * w / 2), (cxw + tx * w / 2, y1, czw + tz * w / 2), (cxw - tx * w / 2, y1, czw - tz * w / 2), GLASS, nrm=(np.sin(t), 0, np.cos(t)), ao=False)
    lathe(m, mx, mz, [(0.92, B + 21.9), (0.92, B + 22.15)], TRIM, seg=12, flat=True, cap_bot=True, ao=False)
    lathe(m, mx, mz, [(0.9, B + 22.15), (0.0, B + 26.6)], LEAD, seg=24, ao=False)                               # lead cone
    finial(m, mx, mz, B + 26.45, 0.9)
    return m


def fix_winding(P, N, F):
    """Every triangle must face the way its normals point (the app draws both sides and darkens the back)."""
    g = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    n = N[F].sum(1)
    bad = np.einsum('ij,ij->i', g, n) < 0
    F = F.copy(); F[bad] = F[bad][:, [0, 2, 1]]
    return F, int(bad.sum())


def write_gkm(path, P, N, C, F):
    lo, hi = P.min(0), P.max(0)
    span = np.maximum(hi - lo, 1e-12)
    qp = np.round((P - lo) / span * 65535).astype('<u2')
    qc = np.zeros((len(P), 4), np.uint8); qc[:, :3] = np.round(np.clip(C, 0, 1) * 255); qc[:, 3] = 255
    qn = np.zeros((len(N), 4), np.int8); qn[:, :3] = np.round(np.clip(N, -1, 1) * 127)
    big = len(P) > 65535
    idx = F.astype('<u4' if big else '<u2')
    head = json.dumps({'nv': len(P), 'nf': len(F), 'min': lo.round(6).tolist(), 'max': hi.round(6).tolist(), 'idx32': big, 'col': True}).encode()
    head += b' ' * ((4 - len(head) % 4) % 4)
    parts = [b'GKM1', struct.pack('<I', len(head)), head]
    for arr in (qp, qc, qn, idx):
        b = arr.tobytes(); parts.append(b + b'\0' * ((4 - len(b) % 4) % 4))
    with open(path, 'w') as fh:
        json.dump({'format': 'GKM1', 'data': base64.b64encode(b''.join(parts)).decode()}, fh)


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    os.makedirs(out, exist_ok=True)
    m = build()
    P, N, C, F = m.arrays()
    F, flipped = fix_winding(P, N, F)
    area = np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
    F = F[area > 1e-10]
    if flipped: print(f'  turned {flipped} triangles to face their normals')
    # base centre at the origin (like the other models)
    c = np.array([(P[:, 0].min() + P[:, 0].max()) / 2, P[:, 1].min(), (P[:, 2].min() + P[:, 2].max()) / 2])
    P = P - c
    write_gkm(os.path.join(out, 'nova-dzamija.json'), P, N, C, F)
    print(f'nova-dzamija: {len(P)} vertices, {len(F)} triangles, size {np.ptp(P, 0).round(2)} m, '
          f'{os.path.getsize(os.path.join(out, "nova-dzamija.json")) / 1024:.0f} KB')
    if '--check' in sys.argv:
        np.savez(os.path.join(sys.argv[sys.argv.index('--check') + 1], 'nova_rebuilt.npz'), P=P, N=N, C=C, F=F)


if __name__ == '__main__':
    main()
