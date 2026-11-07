"""Kuća Radončića – Balića (Gusinje), rebuilt as a clean model from measurements of the user's RealityScan scan.

The scan (tools/models/scans/kuca_1_samo_kuca_MALA.obj, 7 Nov 2026) is a point cloud with colours (no surface).
Measured in a frame square to the walls (turned 35.25° from the scan, metres above the ground):
- house 12.25 x 10.35 m: stone ground floor to 2.85 m, a wooden floor band, white plastered upper floor to 5.0 m;
- steep hipped roof (about 40°) of grey, weathered shingles: eaves 13.85 x 12.3 m at 5.3 m, ridge 2.6 m long at 10.45 m;
- wooden windows on the upper floor (three at the front, four at the back, two on the left, one on the right);
- a low stone annex with a red door and a metal pent roof at the front right, a small lean-to porch at the back;
- gutters and downpipes at the corners.
Front (+Z) = the side with the red door.

python3 -I tools/models/kuca_radoncica_balica.py [--out models]
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buildkit import Mesh, box, beam, slope, window, save

PLASTER = (0.90, 0.89, 0.86)
STONE_H = (0.53, 0.51, 0.47)     # house stone (scan: 0.38-0.49 in light and shade)
MORTAR = (0.68, 0.66, 0.62)
WOOD = (0.40, 0.29, 0.21)
WOOD_L = (0.52, 0.40, 0.29)
FRAME_H = (0.36, 0.24, 0.16)
SHINGLE = (0.58, 0.56, 0.53)     # weathered shingles (scan: 0.59 0.58 0.57)
CAP = (0.44, 0.42, 0.40)
METAL = (0.36, 0.40, 0.45)       # annex roof (scan: 0.33 0.37 0.41)
GUTTER = (0.58, 0.60, 0.62)
RED = (0.62, 0.22, 0.18)
GRASS = (0.42, 0.52, 0.30)
EARTH = (0.45, 0.36, 0.27)
GRAVEL = (0.68, 0.65, 0.60)
GLASS_H = (0.10, 0.11, 0.14)


def stone_wall(m, face, u0, u1, y0, y1, wall, seed, base=STONE_H):
    """Rubble/ashlar wall: a mortar backing and slightly raised stones of varied size and shade."""
    rng = np.random.default_rng(seed)
    def P(a, y, d):
        if face == '+z': return (a, y, wall + d)
        if face == '-z': return (-a, y, wall - d)
        if face == '+x': return (wall + d, y, -a)
        return (wall - d, y, a)
    a0, a1 = (u0, u1) if face in ('+z', '-x') else (-u1, -u0)
    m.quad(P(a0, y0, 0), P(a1, y0, 0), P(a1, y1, 0), P(a0, y1, 0), MORTAR)
    y = y0
    while y < y1 - 0.05:
        h = min(rng.uniform(0.24, 0.36), y1 - y)
        x = a0 - rng.uniform(0, 0.4)
        while x < a1:
            w = rng.uniform(0.38, 0.85)
            xa, xb = max(x, a0) + 0.025, min(x + w, a1) - 0.025
            if xb - xa > 0.08:
                k = 1 + 0.15 * (rng.random() * 2 - 1)
                tint = np.array([1.0, 1.0 - 0.02 * rng.random(), 1.0 - 0.05 * rng.random()])
                col = tuple(np.clip(np.asarray(base) * k * tint, 0, 1))
                m.quad(P(xa, y + 0.025, 0.025), P(xb, y + 0.025, 0.025), P(xb, y + h - 0.025, 0.025), P(xa, y + h - 0.025, 0.025), col)
            x += w
        y += h


def plaster_wall(m, face, u0, u1, y0, y1, wall):
    def P(a, y):
        if face == '+z': return (a, y, wall)
        if face == '-z': return (-a, y, wall)
        if face == '+x': return (wall, y, -a)
        return (wall, y, a)
    a0, a1 = (u0, u1) if face in ('+z', '-x') else (-u1, -u0)
    m.quad(P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1), PLASTER, ao=False)


def door(m, face, u, w, y0, y1, wall, col, leaves=1):
    def P(a, y, d):
        if face == '+z': return (a, y, wall + d)
        if face == '-z': return (-a, y, wall - d)
        if face == '+x': return (wall + d, y, -a)
        return (wall - d, y, a)
    a = u if face in ('+z', '-x') else -u
    m.quad(P(a - w / 2 - 0.08, y0, 0.05), P(a + w / 2 + 0.08, y0, 0.05), P(a + w / 2 + 0.08, y1 + 0.08, 0.05), P(a - w / 2 - 0.08, y1 + 0.08, 0.05), FRAME_H, ao=False)
    m.quad(P(a - w / 2, y0, 0.07), P(a + w / 2, y0, 0.07), P(a + w / 2, y1, 0.07), P(a - w / 2, y1, 0.07), col, ao=False)
    dark = tuple(c * 0.7 for c in col)
    for k in range(1, leaves):                       # the gap between leaves
        x = a - w / 2 + w * k / leaves
        m.quad(P(x - 0.025, y0, 0.08), P(x + 0.025, y0, 0.08), P(x + 0.025, y1, 0.08), P(x - 0.025, y1, 0.08), dark, ao=False)
    for frac in (0.3, 0.7):                          # boards / panels
        yy = y0 + (y1 - y0) * frac
        m.quad(P(a - w / 2 + 0.08, yy - 0.03, 0.08), P(a + w / 2 - 0.08, yy - 0.03, 0.08), P(a + w / 2 - 0.08, yy + 0.03, 0.08), P(a - w / 2 + 0.08, yy + 0.03, 0.08), dark, ao=False)


def build():
    m = Mesh()
    G = 0.12                                          # a garden plot under the house
    x0, x1, z0, z1 = -6.2, 6.05, -5.0, 5.35           # walls
    yS, yB, yW = G + 2.85, G + 3.05, G + 5.0          # stone top, band top, wall top
    # ---- plot ----
    box(m, -7.7, 7.5, 0, G, -7.5, 7.8, EARTH, top=False, ao=False)
    m.quad((-7.7, G, 7.8), (7.5, G, 7.8), (7.5, G, -7.5), (-7.7, G, -7.5), GRASS, ao=False)
    m.quad((0.45, G + 0.01, 7.8), (2.95, G + 0.01, 7.8), (2.95, G + 0.01, 6.8), (0.45, G + 0.01, 6.8), GRAVEL, ao=False)
    m.quad((3.4, G + 0.01, -5.0), (4.6, G + 0.01, -5.0), (4.6, G + 0.01, -7.5), (3.4, G + 0.01, -7.5), GRAVEL, ao=False)

    # ---- stone ground floor ----
    stone_wall(m, '+z', x0, x1, G, yS, z1, 1)
    stone_wall(m, '-z', x0, x1, G, yS, z0, 2)
    stone_wall(m, '+x', z0, z1, G, yS, x1, 3)
    stone_wall(m, '-x', z0, z1, G, yS, x0, 4)
    # ---- wooden floor band and the plastered upper floor ----
    box(m, x0 - 0.08, x1 + 0.08, yS, yB, z0 - 0.08, z1 + 0.08, WOOD, top=True, bottom=True, ao=False)
    plaster_wall(m, '+z', x0, x1, yB, yW, z1)
    plaster_wall(m, '-z', x0, x1, yB, yW, z0)
    plaster_wall(m, '+x', z0, z1, yB, yW, x1)
    plaster_wall(m, '-x', z0, z1, yB, yW, x0)

    # ---- roof: soffit, fascia, shingles, ridge and hip caps, gutters ----
    ex0, ex1, ez0, ez1, yE = -7.0, 6.85, -6.1, 6.2, G + 5.3
    rx0, rx1, rz, yR = -1.5, 1.1, 0.05, G + 10.45
    yF = yE - 0.25
    m.quad((ex0, yF, ez0), (ex1, yF, ez0), (ex1, yF, ez1), (ex0, yF, ez1), WOOD_L, nrm=(0, -1, 0), ao=False)  # soffit
    box(m, ex0, ex1, yF, yE, ez0, ez1, WOOD, top=False, bottom=False, ao=False)                                # fascia
    A, B, C, D = (ex0, yE, ez1), (ex1, yE, ez1), (rx1, yR, rz), (rx0, yR, rz)
    slope(m, A, B, C, D, SHINGLE, seed=1)                                                                     # front
    slope(m, (ex1, yE, ez0), (ex0, yE, ez0), (rx0, yR, rz), (rx1, yR, rz), SHINGLE, seed=2)                 # back
    slope(m, (ex1, yE, ez1), (ex1, yE, ez0), (rx1, yR, rz), (rx1, yR, rz), SHINGLE, seed=3)                 # right hip
    slope(m, (ex0, yE, ez0), (ex0, yE, ez1), (rx0, yR, rz), (rx0, yR, rz), SHINGLE, seed=4)                 # left hip
    beam(m, (rx0 - 0.1, yR + 0.06, rz), (rx1 + 0.1, yR + 0.06, rz), 0.3, 0.16, CAP)
    for (ex, ez, rx) in ((ex0, ez0, rx0), (ex0, ez1, rx0), (ex1, ez0, rx1), (ex1, ez1, rx1)):
        beam(m, (ex, yE + 0.06, ez), (rx, yR + 0.06, rz), 0.26, 0.12, CAP)
    for (p, q) in (((ex0, yF + 0.05, ez1 + 0.08), (ex1, yF + 0.05, ez1 + 0.08)), ((ex0, yF + 0.05, ez0 - 0.08), (ex1, yF + 0.05, ez0 - 0.08)),
                   ((ex1 + 0.08, yF + 0.05, ez0), (ex1 + 0.08, yF + 0.05, ez1)), ((ex0 - 0.08, yF + 0.05, ez0), (ex0 - 0.08, yF + 0.05, ez1))):
        beam(m, p, q, 0.14, 0.14, GUTTER)
    for (cx, cz, ex, ez) in ((x0, z0, ex0, ez0), (x0, z1, ex0, ez1), (x1, z0, ex1, ez0), (x1, z1, ex1, ez1)):
        sx, sz = np.sign(cx), np.sign(cz)
        px, pz = cx + sx * 0.12, cz + sz * 0.12
        beam(m, (px, G, pz), (px, yF - 0.15, pz), 0.11, 0.11, GUTTER)                                      # downpipe
        beam(m, (px, yF - 0.15, pz), (ex - sx * 0.1, yF + 0.02, ez - sz * 0.1), 0.1, 0.1, GUTTER)          # to the gutter

    # ---- upper floor windows ----
    yw0, yw1 = G + 3.55, G + 4.6
    for u, w, mul in ((-4.35, 1.7, True), (-0.7, 0.65, False), (3.5, 1.8, True)):
        window(m, '+z', u, yw0, yw1, w, z1, mullion=mul, frame=FRAME_H, sill=WOOD)
    for u, w, mul in ((3.1, 2.2, True), (-0.25, 2.0, True), (-3.0, 0.9, False), (-4.6, 0.9, False)):
        window(m, '-z', u, yw0, yw1, w, z0, mullion=mul, frame=FRAME_H, sill=WOOD)
    window(m, '+x', -3.25, yw0, yw1, 0.9, x1, frame=FRAME_H, sill=WOOD)
    window(m, '-x', -3.9, yw0, yw1, 1.2, x0, mullion=True, frame=FRAME_H, sill=WOOD)
    window(m, '-x', 3.1, yw0, yw1, 1.8, x0, mullion=True, frame=FRAME_H, sill=WOOD)
    # small ground-floor windows
    window(m, '+z', -3.2, G + 1.45, G + 2.1, 0.6, z1, frame=FRAME_H, sill=STONE_H)
    window(m, '-z', -2.6, G + 1.45, G + 2.1, 0.6, z0, frame=FRAME_H, sill=STONE_H)
    window(m, '-x', 0.6, G + 1.45, G + 2.1, 0.6, x0, frame=FRAME_H, sill=STONE_H)

    # ---- annex at the front right: stone, red double door, metal pent roof ----
    ax0, ax1, az0, az1 = 0.0, 6.3, z1, 6.8
    stone_wall(m, '+z', ax0, ax1, G, G + 2.75, az1, 5)
    stone_wall(m, '+x', az0, az1, G, G + 2.75, ax1, 6)
    stone_wall(m, '-x', az0, az1, G, G + 2.75, ax0, 7)
    door(m, '+z', 1.7, 2.5, G, G + 2.2, az1, RED, leaves=2)
    window(m, '+z', 4.7, G + 1.25, G + 1.9, 0.7, az1, frame=FRAME_H, sill=STONE_H)
    r0, r1 = (ax0 - 0.15, G + 3.25, az0), (ax1 + 0.15, G + 3.25, az0)
    slope(m, (ax0 - 0.15, G + 2.78, az1 + 0.25), (ax1 + 0.15, G + 2.78, az1 + 0.25), r1, r0, METAL, row=0.5, vary=0.02, seed=8)
    box(m, ax0 - 0.15, ax1 + 0.15, G + 2.7, G + 2.78, az1 + 0.17, az1 + 0.25, METAL, ao=False)
    # under the pent roof, between the annex walls and the slope: close the gable triangles
    for x in (ax0, ax1):
        s = -1 if x == ax0 else 1
        P = np.array([(x, G + 2.75, az1), (x, G + 2.75, az0), (x, G + 3.25, az0)])
        n = (s, 0, 0)
        m.add(P, [n] * 3, STONE_H, [[0, 1, 2]] if s > 0 else [[0, 2, 1]])

    # ---- lean-to porch at the back over the back door ----
    door(m, '-z', 4.0, 1.0, G, G + 2.1, z0, WOOD_L)
    box(m, 3.4, 4.6, G, G + 0.15, -5.6, z0, STONE_H, ao=False)                                                  # step
    slope(m, (6.3, G + 2.8, -6.65), (1.7, G + 2.8, -6.65), (1.7, G + 3.35, z0), (6.3, G + 3.35, z0), SHINGLE, row=0.3, seed=9)
    for px in (1.95, 6.05):
        beam(m, (px, G, -6.45), (px, G + 2.86, -6.45), 0.16, 0.16, WOOD)
    beam(m, (1.75, G + 2.86, -6.45), (6.25, G + 2.86, -6.45), 0.14, 0.18, WOOD)
    return m


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    save(build(), 'kuca-radoncica-balica', out)


if __name__ == '__main__':
    main()
