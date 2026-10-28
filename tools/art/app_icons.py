"""
Build the home-screen app icons from the favicon.

    python tools/art/app_icons.py

The 32x32 pixel-art favicon is scaled up by whole pixels (no smoothing) onto the warm wood
background, with enough margin that Android's round/squircle masks never crop it. Writes
client/public/icons/{icon-192,icon-512,apple-touch-icon}.png. Needs Python 3 + Pillow.
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'client', 'public', 'assets', 'ui', 'favicon.png')
OUT = os.path.join(ROOT, 'client', 'public', 'icons')
BACKGROUND = (75, 53, 39, 255)  # --ink, matches the manifest's theme colour

# (file, size): the art fills about 60% of the icon, inside the maskable safe zone.
ICONS = [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]


def build(art: Image.Image, size: int) -> Image.Image:
    scale = max(1, int(size * 0.6) // art.width)
    big = art.resize((art.width * scale, art.height * scale), Image.NEAREST)
    icon = Image.new('RGBA', (size, size), BACKGROUND)
    icon.alpha_composite(big, ((size - big.width) // 2, (size - big.height) // 2))
    return icon.convert('RGB')


def main() -> None:
    art = Image.open(SRC).convert('RGBA')
    os.makedirs(OUT, exist_ok=True)
    for name, size in ICONS:
        build(art, size).save(os.path.join(OUT, name), optimize=True)
        print('wrote', name)


if __name__ == '__main__':
    main()
