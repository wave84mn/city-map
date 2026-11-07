"""Nova džamija (Gusinje), rebuilt as a clean model from measurements of the user's RealityScan scan.

The scan (tools/models/scans/, 7 Nov 2026) is a drone photogrammetry mesh: good proportions, but lumpy walls,
holes, blotchy colour and a ragged base, which looked like a ruin once cut out and shrunk for the cube. Here the
mosque is built again from simple, exact shapes with the scan's sizes (metres, measured on orthographic views of
the levelled scan): prayer hall with a dome on an octagonal drum, the arcaded porch, the side wing, the open
pavilion with the small dome, and the minaret with its balcony and lead cone. Colours from the scan.

python3 -I tools/models/nova_dzamija.py [--out models]     (shapes and colours: buildkit.py)
Output: <out>/nova-dzamija.json (GKM1 with per-vertex colours, no texture). Y up, base at y = 0, porch towards +Z.
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buildkit import *          # Mesh, shapes, colours, save


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


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    save(build(), 'nova-dzamija', out)


if __name__ == '__main__':
    main()
