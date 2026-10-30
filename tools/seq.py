"""Synthetic camera videos of the AR cube for the city-map tests (run from a folder with build/, see ar-cube).
usage: python3 seq.py still|flip|orbit OUT.y4m [--size 720x1280] [--secs 12]
 still: cube held still, top face tilted towards the camera.
 flip:  still, then at 7 s the cube is turned upside down (180 deg about the camera's x axis) in 1 s, then still.
 orbit: the cube slowly turns about its vertical axis.
"""
import math, os, subprocess, sys, tempfile
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth

def Rx(a): c, s = math.cos(a), math.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def Ry(a): c, s = math.cos(a), math.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
D = np.diag([1., -1., -1.])          # cube upright (its +Y up in the image), front face towards the camera

def main():
    kind, out = sys.argv[1], sys.argv[2]
    W, H = (int(x) for x in (sys.argv[sys.argv.index('--size') + 1] if '--size' in sys.argv else '720x1280').split('x'))
    secs = float(sys.argv[sys.argv.index('--secs') + 1]) if '--secs' in sys.argv else 12
    fps = 30; N = int(secs * fps)
    rng = np.random.default_rng(5)
    f = 0.78 * max(W, H); K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    S = synth.S
    planes = [(synth.faces_tex[i], np.array(fc['U'], float), np.array(fc['V'], float), np.array(fc['N'], float),
               np.array(fc['N'], float) * S / 2, S / 2, synth.FACE_PPMM) for i, fc in enumerate(synth.lay['faces'])]
    bg = synth.background(rng, W, H)
    tmp = tempfile.mkdtemp()
    for i in range(N):
        tt = i / fps
        a, yaw, z, ty = math.radians(38), math.radians(28), 300.0, 30.0
        if kind == 'flip' and tt >= 7.0:
            s = min(1.0, (tt - 7.0) / 1.0); s = s * s * (3 - 2 * s)
            a += math.pi * s
        if kind == 'orbit':
            yaw += tt * 0.5
        R = Rx(a) @ D @ Ry(yaw)
        t = np.array([0.0, ty, z])
        img = bg.copy()
        light = np.array([0.3, 0.8, 0.5]); light /= np.linalg.norm(light)
        synth.render_planes(img, planes, R, t, K, np.random.default_rng(i), -light)
        img = synth.finish_video(img, rng)
        cv2.imwrite(os.path.join(tmp, f'{i:04d}.png'), img)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(tmp, '%04d.png'), '-pix_fmt', 'yuv420p', out], check=True)
    print('wrote', out, N, 'frames')

if __name__ == '__main__':
    main()
