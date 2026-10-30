"""QR cards for Mapa Gusinja: a QR code with the Xplore Prokletije logo in the middle and the program name below.
usage: PYTHONPATH=<segno> python3 qr_cards.py OUTDIR [LOGO.png]   (default logo: ../img/xplore-prokletije-light.png)
Writes mapa-gusinja-qr-android.png / -windows.png (300 dpi: about 14 x 18 cm at full size; scale down freely). Error correction H (30 %), so the centre label can cover part of the code.
"""
import os, sys
import segno
from PIL import Image, ImageDraw, ImageFont

BASE = 'https://wave84mn.github.io/city-map/'
CARDS = [
    {'id': 'android', 'url': BASE + '?p=android', 'platform': 'Android · Chrome'},
    {'id': 'windows', 'url': BASE + '?p=windows', 'platform': 'Windows · Edge / Chrome'},
]
NAME = 'Mapa Gusinja'
INK = (23, 33, 42)            # logo's dark slate: QR modules and text
ACCENT = (1, 92, 248)         # logo's blue
MUTED = (104, 112, 122)
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img', 'xplore-prokletije-light.png')
FONT = '/usr/share/fonts/opentype/inter/Inter-{}.otf'
font = lambda w, s: ImageFont.truetype(FONT.format(w), s)


def tracked(draw, xy, text, f, fill, spacing, anchor='mm'):
    """text with extra letter spacing, centred on xy"""
    widths = [draw.textlength(ch, font=f) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=f, fill=fill, anchor='lm')
        x += w + spacing


def mountain(draw, cx, cy, w, h):
    """simple peak glyph, like the one on the start screen"""
    x0, y0 = cx - w / 2, cy - h / 2
    P = lambda u, v: (x0 + u / 40 * w, y0 + v / 18 * h)
    draw.polygon([P(1, 17), P(13, 3), P(19, 10), P(24, 5), P(39, 17)], fill=ACCENT)
    draw.polygon([P(13, 3), P(16.2, 6.7), P(14, 5.8), P(12.4, 7.4), P(10.8, 6)], fill=(255, 255, 255))


def card(c, out, logo_path=LOGO):
    qr = segno.make(c['url'], error='h', micro=False, boost_error=False)
    n = qr.symbol_size(border=0)[0]
    mod = 34                                  # px per module
    quiet = 4
    W = (n + 2 * quiet) * mod
    H = W + 470
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    for r, row in enumerate(qr.matrix):
        for col, v in enumerate(row):
            if v:
                x, y = (col + quiet) * mod, (r + quiet) * mod
                d.rectangle([x, y, x + mod - 1, y + mod - 1], fill=INK)
    # centre: whole modules cleared, white rounded box with the logo
    bw, bh = 19, 9                            # modules (odd, so it is centred on the middle module)
    c0, r0 = quiet + (n - bw) // 2, quiet + (n - bh) // 2
    bx0, by0, bx1, by1 = c0 * mod, r0 * mod, (c0 + bw) * mod, (r0 + bh) * mod
    d.rectangle([bx0, by0, bx1 - 1, by1 - 1], fill='white')
    pad = mod * 0.4
    soft = tuple(int(255 - 0.22 * (255 - v)) for v in ACCENT)     # the blue, faded: a quiet frame
    d.rounded_rectangle([bx0 + pad, by0 + pad, bx1 - pad, by1 - pad], radius=mod * 1.2, outline=soft, width=max(3, mod // 9), fill='white')
    logo = Image.open(logo_path).convert('RGBA')
    iw, ih = (bw - 1.7) * mod, (bh - 1.7) * mod                 # room inside the frame
    k = min(iw / logo.width, ih / logo.height)
    logo = logo.resize((round(logo.width * k), round(logo.height * k)), Image.LANCZOS)
    img.paste(logo, (round((bx0 + bx1 - logo.width) / 2), round((by0 + by1 - logo.height) / 2)), logo)
    # below: program name, platform, link
    y = W + 20
    d.text((W / 2, y + 95), NAME, font=font('ExtraBold', 150), fill=INK, anchor='mm')
    d.text((W / 2, y + 235), c['platform'], font=font('SemiBold', 78), fill=ACCENT, anchor='mm')
    d.text((W / 2, y + 345), c['url'].replace('https://', ''), font=font('Medium', 48), fill=MUTED, anchor='mm')
    os.makedirs(out, exist_ok=True)
    png = os.path.join(out, f"mapa-gusinja-qr-{c['id']}.png")
    img.save(png, dpi=(300, 300))
    return png, qr.version, n, (bw * bh) / (n * n)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'qr'
    logo = sys.argv[2] if len(sys.argv) > 2 else LOGO
    for c in CARDS:
        png, ver, n, cover = card(c, out, logo)
        print(png, f'version {ver} ({n}x{n}), label covers {cover:.1%} of the code')
