"""生成 iOS 应用图标与启动图：品牌蓝底 + 白色相机轮廓（与欢迎页一致）。

用法：server/.venv/bin/python app/ios/make-icon.py
输出：App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png（1024×1024，无透明）
      App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (47, 111, 237)
WHITE = (255, 255, 255)
HERE = Path(__file__).resolve().parent
ASSETS = HERE / "App" / "App" / "Assets.xcassets"


def draw_camera(img: Image.Image, cx: float, cy: float, size: float, stroke: float) -> None:
    """以 (cx, cy) 为中心画相机轮廓，size 为整体宽度。参考 24 格图标：机身 4..20 × 8..19，镜头 r=3.5。"""
    d = ImageDraw.Draw(img)
    u = size / 16  # 机身宽 16 格
    left, right = cx - 8 * u, cx + 8 * u
    top, bottom = cy - 5.5 * u, cy + 5.5 * u
    r = stroke * 1.1
    # 机身
    d.rounded_rectangle([left, top, right, bottom], radius=r, outline=WHITE, width=int(stroke))
    # 取景器凸起：圆角矩形坐在机身顶边上，再擦掉重叠的那段顶边让两者连通
    bump_w = 5.6 * u
    bx0, bx1 = cx - bump_w / 2, cx + bump_w / 2
    d.rounded_rectangle([bx0, top - 2.3 * u, bx1, top + stroke * 0.5], radius=stroke * 0.9, outline=WHITE, width=int(stroke))
    d.rectangle([bx0 + stroke, top - stroke * 0.6, bx1 - stroke, top + stroke * 0.6], fill=BRAND)
    # 镜头：外环 + 内圆点
    lr = 3.4 * u
    d.ellipse([cx - lr, cy + 0.4 * u - lr, cx + lr, cy + 0.4 * u + lr], outline=WHITE, width=int(stroke))
    dr = 1.1 * u
    d.ellipse([cx - dr, cy + 0.4 * u - dr, cx + dr, cy + 0.4 * u + dr], fill=WHITE)


def make_icon(path: Path, px: int = 1024) -> None:
    # 4 倍超采样再缩小，边缘更平滑
    s = 4
    img = Image.new("RGB", (px * s, px * s), BRAND)
    draw_camera(img, px * s / 2, px * s / 2 + px * s * 0.03, px * s * 0.56, px * s * 0.062)
    img = img.resize((px, px), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


def make_splash(path: Path, px: int = 2732) -> None:
    s = 2
    img = Image.new("RGB", (px * s, px * s), BRAND)
    draw_camera(img, px * s / 2, px * s / 2, px * s * 0.18, px * s * 0.02)
    img = img.resize((px, px), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)


if __name__ == "__main__":
    icon = ASSETS / "AppIcon.appiconset" / "AppIcon-512@2x.png"
    make_icon(icon)
    print("icon ->", icon)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        make_splash(ASSETS / "Splash.imageset" / name)
    print("splash -> Splash.imageset/*.png")
