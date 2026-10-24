"""Generate notebook app icons. Run: server/.venv/bin/python app/ios/make-app-icon.py.

Keeps native launch images separate. SVG is the editable master; PNGs use
the same geometry with supersampling. Android foreground fits its safe zone.
"""
from pathlib import Path
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parents[1]
OUT = APP / "resources"
OUT.mkdir(exist_ok=True)
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">
  <defs><linearGradient id="blue" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse"><stop stop-color="#75A6FF"/><stop offset="1" stop-color="#2F6FED"/></linearGradient></defs>
  <path fill="url(#blue)" d="M0 0h1024v1024H0z"/>
  <rect x="250" y="190" width="524" height="660" rx="110" fill="#245BC4" opacity=".16"/>
  <rect x="250" y="174" width="524" height="660" rx="110" fill="white"/>
  <path d="M322 181v646" stroke="#E5EEFF" stroke-width="16"/>
  <path d="M382 350h244M382 460h160" stroke="#B5CEFF" stroke-width="44" stroke-linecap="round"/>
  <path d="m394 626 88 88 174-202" stroke="#2F6FED" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/>
</svg>'''
(OUT / "app-icon.svg").write_text(SVG)

S = 2
N = 1024 * S


def notebook():
    image = Image.new("RGBA", (N, N))
    d = ImageDraw.Draw(image)

    def rect(box, radius, fill):
        d.rounded_rectangle(tuple(round(v*S) for v in box), radius=radius*S, fill=fill)

    def line(points, fill, width):
        pts = [(x*S, y*S) for x, y in points]
        d.line(pts, fill=fill, width=width*S, joint="curve")
        r = width*S/2
        for x, y in pts:
            d.ellipse((round(x-r), round(y-r), round(x+r), round(y+r)), fill=fill)

    rect((250, 190, 774, 850), 110, (36, 91, 196, 41))
    rect((250, 174, 774, 834), 110, "white")
    d.line((322*S, 181*S, 322*S, 827*S), fill="#E5EEFF", width=16*S)
    line([(382, 350), (626, 350)], "#B5CEFF", 44)
    line([(382, 460), (542, 460)], "#B5CEFF", 44)
    line([(394, 626), (482, 714), (656, 512)], "#2F6FED", 60)
    return image


base = Image.new("RGB", (N, N))
pixels = base.load()
for y in range(N):
    for x in range(N):
        t = (x+y)/(2*(N-1))
        pixels[x, y] = tuple(round(a+(b-a)*t) for a, b in zip((117, 166, 255), (47, 111, 237)))
mark = notebook()
base.paste(mark, (0, 0), mark)
icon = base.resize((1024, 1024), Image.Resampling.LANCZOS)
icon.save(OUT / "app-icon-1024.png", optimize=True)
icon.save(APP / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", optimize=True)
res = APP / "android/app/src/main/res"
for density, size, fgsize in [("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)]:
    folder = res / f"mipmap-{density}"
    icon.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher.png")
    rounded = icon.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
    mask = Image.new("L", (N, N))
    ImageDraw.Draw(mask).ellipse((0, 0, N-1, N-1), fill=255)
    rounded.putalpha(mask.resize((size, size), Image.Resampling.LANCZOS))
    rounded.save(folder / "ic_launcher_round.png")
    # 80% scale keeps the whole notebook inside the adaptive-icon safe circle.
    fg = Image.new("RGBA", (N, N))
    small = mark.resize((round(N*.8), round(N*.8)), Image.Resampling.LANCZOS)
    fg.paste(small, ((N-small.width)//2, (N-small.height)//2))
    fg.resize((fgsize, fgsize), Image.Resampling.LANCZOS).save(folder / "ic_launcher_foreground.png")
print("Generated editable SVG, 1024px PNG, iOS icon and Android icons.")
