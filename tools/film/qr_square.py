"""QR code square for the end of the showcase video: the app's link with the Xplore Prokletije logo in the middle.
usage: PYTHONPATH=<segno> python3 qr_square.py OUT.png
Same drawing as ../qr_cards.py (error correction H, logo box 19 x 9 modules), without the text below.
"""
import os, sys
import segno
from PIL import Image, ImageDraw

URL = 'https://wave84mn.github.io/city-map/'
INK, ACCENT = (23, 33, 42), (1, 92, 248)
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'img', 'xplore-prokletije-light.png')

qr = segno.make(URL, error='h', micro=False, boost_error=False)
n = qr.symbol_size(border=0)[0]
mod, quiet = 24, 2
W = (n + 2 * quiet) * mod
img = Image.new('RGB', (W, W), 'white')
d = ImageDraw.Draw(img)
for r, row in enumerate(qr.matrix):
    for c, v in enumerate(row):
        if v:
            x, y = (c + quiet) * mod, (r + quiet) * mod
            d.rectangle([x, y, x + mod - 1, y + mod - 1], fill=INK)
bw, bh = 19, 9
c0, r0 = quiet + (n - bw) // 2, quiet + (n - bh) // 2
bx0, by0, bx1, by1 = c0 * mod, r0 * mod, (c0 + bw) * mod, (r0 + bh) * mod
d.rectangle([bx0, by0, bx1 - 1, by1 - 1], fill='white')
pad = mod * 0.4
soft = tuple(int(255 - 0.22 * (255 - v)) for v in ACCENT)
d.rounded_rectangle([bx0 + pad, by0 + pad, bx1 - pad, by1 - pad], radius=mod * 1.2, outline=soft, width=max(3, mod // 9), fill='white')
logo = Image.open(LOGO).convert('RGBA')
k = min((bw - 1.7) * mod / logo.width, (bh - 1.7) * mod / logo.height)
logo = logo.resize((round(logo.width * k), round(logo.height * k)), Image.LANCZOS)
img.paste(logo, (round((bx0 + bx1 - logo.width) / 2), round((by0 + by1 - logo.height) / 2)), logo)
img.save(sys.argv[1])
print(sys.argv[1], f'version {qr.version} ({n}x{n}), {W}px')
