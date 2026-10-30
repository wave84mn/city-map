"""Soft music and small sound effects for the showcase video, timed to what happens on screen.
usage: python3 music.py EVENTS.json OUT.wav
EVENTS.json comes from film.cjs (segment start times and the app's state changes, in video seconds).
Everything is synthesised here (no samples): a warm pad in D major, a light plucked arpeggio, a soft bass,
bell notes when the cube is found and when the language changes, whooshes when a building grows, shrinks or
the cube is turned over, a tap click, and a final chord under the QR code.
"""
import json, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
ev = json.load(open(sys.argv[1]))
seg = {s['name']: s for s in ev['segments']}
END = ev['segments'][-1]['t'] + ev['segments'][-1]['dur']
N = int(END * SR) + SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def add(sig, t0, gain=1.0, pan=0.0, dry=None):
    """mix a mono signal at t0 (s); pan -1..1 (equal power)"""
    i = int(round(t0 * SR))
    if i >= N: return
    sig = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i:i + len(sig)] += sig * np.cos(a); R[i:i + len(sig)] += sig * np.sin(a)


def env_adsr(n, a, r, sus=1.0):
    e = np.full(n, sus)
    na, nr = min(int(a * SR), n), min(int(r * SR), n)
    e[:na] = np.linspace(0, 1, na) ** 1.6 * sus if na else e[:na]
    if nr: e[n - nr:] *= np.linspace(1, 0, nr) ** 1.4
    return e


def pad_note(m, dur, a=1.4, r=1.8):
    n = int((dur + r) * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.zeros(n)
    for h in range(1, 8):
        if f * h > 9000: break
        for det in (-0.0011, 0.0011):
            s += np.sin(2 * np.pi * f * h * (1 + det) * t + rng.uniform(0, 2 * np.pi)) / h ** 1.7
    s *= 1 + 0.06 * np.sin(2 * np.pi * rng.uniform(0.15, 0.3) * t)
    return s * env_adsr(n, a, r)


def pluck(m, tau=0.55):
    n = int(tau * 6 * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.42 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (tau * 0.4)) + 0.14 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / (tau * 0.25)) + 0.05 * np.sin(2 * np.pi * 4.02 * f * t) * np.exp(-t / (tau * 0.15))
    e = np.exp(-t / tau); e[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return s * e


def bell(m, tau=1.4):
    n = int(tau * 5 * SR); t = np.arange(n) / SR; f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (tau * d)) for k, a, d in ((1, 1, 1), (2.0, 0.35, 0.6), (2.76, 0.18, 0.35), (5.4, 0.06, 0.15)))
    s[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return s


def noise_sweep(dur, f0, f1, shape='swell'):
    """band-passed noise whose centre glides f0 -> f1 (block-wise filter)"""
    n = int(dur * SR); x = rng.standard_normal(n); y = np.zeros(n); B = 512; zi = None
    for b in range(0, n, B):
        k = b / max(1, n - 1); fc = f0 * (f1 / f0) ** k
        sos = butter(2, [fc / 1.6, min(fc * 1.6, SR / 2 - 100)], btype='band', fs=SR, output='sos')
        if zi is None: zi = np.zeros((sos.shape[0], 2))
        y[b:b + B], zi = sosfilt(sos, x[b:b + B], zi=zi)
    t = np.linspace(0, 1, n)
    e = np.sin(np.pi * t) ** 1.5 if shape == 'swell' else (t ** 2 if shape == 'up' else (1 - t) ** 2)
    return y * e / (np.abs(y).max() + 1e-9)


def thud(f0=95, f1=55, dur=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** (t / dur)) / SR
    return np.sin(ph) * np.exp(-t / 0.09)


def click():
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = 0.6 * np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.012) + 0.5 * rng.standard_normal(n) * np.exp(-t / 0.004)
    return sosfilt(butter(2, 5000, fs=SR, output='sos'), s)


# ---------------- events ----------------
ch = ev['changes']
def first(cond, after=0.0):
    for c in ch:
        if c['t'] >= after and cond(c): return c['t']
    return None
t_found = first(lambda c: c['active'] == 'cube')
C, D1, E, F, G = seg['C-choose']['t'], seg['D1-list']['t'], seg['E-flip']['t'], seg['F-lang']['t'], seg['G-outro']['t']
t_grow = first(lambda c: c['mode'] == 'grow', C)
t_built = first(lambda c: c['mode'] == 'building', t_grow)
t_tap = first(lambda c: c['mode'] == 'shrink', D1)
t_grow2 = first(lambda c: c['mode'] == 'grow', t_tap)
t_back = first(lambda c: c['mode'] == 'shrink', E)
print('found', t_found, 'grow', t_grow, 'built', t_built, 'tap', t_tap, 'grow2', t_grow2, 'flip back', t_back, 'outro', G, 'end', END)

# ---------------- music ----------------
BAR = G / 10                                      # the final chord lands on the outro
CH = {'D': ([50, 57, 61, 64, 66], 38), 'Bm': ([54, 59, 62, 66, 69], 35), 'G': ([55, 59, 62, 66, 69], 43),
      'D/F#': ([54, 57, 62, 64, 69], 42), 'Asus': ([52, 57, 62, 64, 69], 45), 'Em': ([52, 55, 59, 62, 66], 40)}
prog = ['D', 'D', 'Bm', 'G', 'D/F#', 'Asus', 'Bm', 'G', 'Em', 'Asus', 'D']
pad_bus = np.zeros(N)
for b, name in enumerate(prog):
    notes, root = CH[name]
    t0 = b * BAR
    dur = BAR * (1.0 if b < len(prog) - 1 else (END - t0))
    if b == 1: continue                           # bar 0 holds through bar 1
    if b == 0: dur = 2 * BAR
    for m in notes:
        s = pad_note(m, dur + 0.15, a=1.6 if b == 0 else 0.9, r=2.2 if b == len(prog) - 1 else 1.4)
        i = int(t0 * SR); pad_bus[i:i + len(s)] += s[: N - i] * 0.03
    if 2 <= b < len(prog) - 1:                    # a quiet high layer for some air
        for m in notes[-2:]:
            s = pad_note(m + 12, dur + 0.15, a=0.9, r=1.4)
            i = int(t0 * SR); pad_bus[i:i + len(s)] += s[: N - i] * 0.03
    if b >= 2:                                    # soft bass from the third bar
        n = int((dur + 0.6) * SR); t = np.arange(n) / SR; f = hz(root)
        bs = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * env_adsr(n, 0.25, 0.6)
        add(bs, t0, 0.05)
pad_bus = sosfilt(butter(2, [150, 3200], btype='band', fs=SR, output='sos'), pad_bus)   # leave the lows to the bass, keep it from getting muddy
add(pad_bus, 0, 1.0)

# plucked arpeggio: from the moment the cube is found until the outro; 8 notes a bar
pat = [0, 2, 4, 2, 1, 3, 4, 3]
eighth = BAR / 8
k0 = int(np.ceil((t_found + 0.05) / eighth))
for k in range(k0, int(G / eighth)):
    t = k * eighth; b = int(t // BAR); notes, _ = CH[prog[min(b, len(prog) - 1)]]
    m = notes[pat[k % 8]] + 12
    vel = 0.55 + 0.25 * (k % 2 == 0) + 0.2 * (k % 8 == 0)
    ramp = min(1.0, (t - t_found) / 2.5)
    add(pluck(m), t, 0.11 * vel * (0.45 + 0.55 * ramp), pan=0.28 if k % 2 else -0.28)

# ---------------- effects ----------------
add(bell(81, 1.1), t_found, 0.07, -0.15); add(bell(86, 1.2), t_found + 0.09, 0.06, 0.15)      # cube found
for tg, tb in ((t_grow, t_built), (t_grow2, t_grow2 + 1.35)):                                 # building grows
    if tg is None: continue
    add(noise_sweep(1.5, 350, 3800, 'swell'), tg - 0.1, 0.05, 0.0)
    add(thud(140, 70, 0.6), tb, 0.10); add(bell(74, 1.6), tb, 0.05, 0.1); add(bell(78, 1.6), tb + 0.04, 0.035, -0.1)
add(click(), t_tap, 0.16, 0.0)                                                                # tap on the list
add(noise_sweep(1.1, 2600, 400, 'swell'), t_tap + 0.02, 0.035)                                 # shrink
for s in ('D2-kula', 'D3-opstina', 'E-flip'):                                                 # cuts
    add(noise_sweep(0.22, 1800, 900, 'down'), seg[s]['t'], 0.03)
add(noise_sweep(1.2, 500, 2600, 'swell'), E + 1.1, 0.05)                                       # cube turned over
add(thud(), E + 2.48, 0.22)                                                                   # ... and set down
if t_back: add(noise_sweep(1.1, 2600, 380, 'swell'), t_back, 0.04)                            # back to the town
for i, tl in enumerate((F + 1.2, F + 2.4)):                                                   # language changes
    add(bell(86 if i == 0 else 88, 0.9), tl, 0.05, 0.2 if i else -0.2)
for i, m in enumerate((74, 78, 81, 86)):                                                      # outro chord
    add(bell(m, 2.2), G + 0.6 + 0.07 * i, 0.045, -0.3 + 0.2 * i)

# ---------------- room, level, fades ----------------
ir_n = int(2.4 * SR); t = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-t / 0.55); irR = rng.standard_normal(ir_n) * np.exp(-t / 0.55)
lp = butter(1, 4000, fs=SR, output='sos'); irL = sosfilt(lp, irL); irR = sosfilt(lp, irR)
irL /= np.sqrt((irL ** 2).sum()); irR /= np.sqrt((irR ** 2).sum())
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
L, R = L + 0.32 * wetL, R + 0.32 * wetR
hp = butter(2, 35, btype='high', fs=SR, output='sos'); L = sosfilt(hp, L); R = sosfilt(hp, R)
n_end = int(END * SR); L, R = L[:n_end], R[:n_end]
fade = np.ones(n_end); fi, fo = int(0.25 * SR), int(1.6 * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
L *= fade; R *= fade
rms = np.sqrt(np.mean(np.concatenate([L, R]) ** 2))
g = 10 ** (-19 / 20) / rms                         # about -19 dBFS RMS: soft background music
L *= g; R *= g
peak = max(np.abs(L).max(), np.abs(R).max())
if peak > 0.89: L *= 0.89 / peak; R *= 0.89 / peak
out = np.stack([L, R], 1).astype(np.float32)
wavfile.write(sys.argv[2], SR, out)
print(sys.argv[2], f'{END:.2f} s, peak {20 * np.log10(np.abs(out).max()):.1f} dBFS, rms {20 * np.log10(np.sqrt(np.mean(out ** 2))):.1f} dBFS')
