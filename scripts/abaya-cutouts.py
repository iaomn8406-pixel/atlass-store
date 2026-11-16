"""
قصّ العباية (hooded-embroidered-abaya) من صورها عالية الجودة
=============================================================

الصور: E:/شغل/اطلس/منتجح/3/New folder  (1254×1254)
  • الأزرق (بترولي في جدول المخزن) جاي من غير خلفية أصلًا (88.png)
  • الأبيض والبيج على خلفية رمادي متدرّجة، والأسود على خلفية بيضا

إزاي بنعرف الخلفية:
  الخلفية بنحسب شكلها الحقيقي في كل نقطة (سطح ناعم من الدرجة التانية
  متظبّط على أطراف الصورة)، وبعدين بنقارن كل بكسل باللي المفروض يكون
  وراه في نفس المكان:
    • العباية الفاتحة = أفتح من الخلفية في مكانها، أو ليها لون (التطريز/البيج)
    • العباية الغامقة = أغمق بكتير من الخلفية
  ضل العباية على الأرض (أغمق ومن غير لون) مابيتحسبش منها.

القطعة نفسها بكسلاتها زي ما هي (maxDiff=0 جوه القطعة).
بعده شغّل: room-depth.py ثم room-bleed.py
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from skimage import color as skcolor

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r'E:/شغل/اطلس/منتجح/3/New folder')
OUT = ROOT / 'public/room'
SLUG = 'hooded-embroidered-abaya'
MAX_H = 1100

# (الملف، المفتاح، اللون في بيانات المنتج، نوع الخلفية)
SOURCES = [
    ('ChatGPT Image Jul 28, 2026, 12_24_28 AM.png', 'white', 'أبيض', 'light'),
    ('ChatGPT Image Jul 28, 2026, 12_26_21 AM.png', 'beige', 'بيج', 'light'),
    ('ChatGPT Image Jul 28, 2026, 12_27_53 AM.png', 'black', 'اسود', 'dark'),
    ('88.png', 'blue', 'بترولي', 'alpha'),
]


def bg_model(lab, border):
    """سطح ناعم (درجة تانية) لكل قناة Lab متظبّط على أطراف الصورة"""
    h, w = lab.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    x = xx / w - 0.5
    y = yy / h - 0.5
    A = np.stack([np.ones_like(x), x, y, x * x, y * y, x * y], -1)
    Ab = A[border]
    model = np.zeros_like(lab)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(Ab, lab[..., c][border], rcond=None)
        model[..., c] = A @ coef
    return model


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def cut(name, kind):
    im = Image.open(SRC / name)
    if kind == 'alpha':
        # جاية من غير خلفية — بس حافتها فيها خيط فاتح: لون الحافة من جوه القطعة
        rgba = np.asarray(im.convert('RGBA')).copy()
        body = rgba[..., 3] > 128
        core = ndi.binary_erosion(body, iterations=3)
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        rim = ~core
        rgba[..., :3][rim] = rgba[..., :3][iy[rim], ix[rim]]
        return rgba, 0

    rgb = np.asarray(im.convert('RGB'))
    h, w = rgb.shape[:2]
    lab = skcolor.rgb2lab(rgb)
    border = np.zeros((h, w), bool)
    b = int(min(h, w) * 0.04)
    border[:b] = border[-b:] = True
    border[:, :b] = border[:, -b:] = True
    bg = bg_model(lab, border)

    dL = lab[..., 0] - bg[..., 0]
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    dC = np.hypot(lab[..., 1] - bg[..., 1], lab[..., 2] - bg[..., 2])

    if kind == 'light':
        # الخلفية فيها بقعة نور فاتحة من غير لون. القماش أفتح منها بوضوح
        # (أفتح من أفتح حتة في أطراف الصورة + ٦)، أو ليه لون (بيج/تطريز).
        # القيم متقاسة: بقعة النور ≈٧١–٧٩، القماش ≥٨٥، تشبّع الخلفية ≈٠٫٤
        edge = np.r_[lab[..., 0][border]]
        T = float(np.percentile(edge, 95)) + 6
        p = np.maximum(smooth(lab[..., 0], T - 4, T + 2), smooth(chroma, 3.0, 6.0))
        # الكسرات وجوه الكابيشون أغمق شوية: بنقبلها لو متصلة بقماش أكيد
        # (hysteresis) — بقعة النور مش متصلة بالقماش بالشكل ده
        from skimage.filters import apply_hysteresis_threshold
        weak = apply_hysteresis_threshold(np.maximum(lab[..., 0] - (T - 9), 0) + (chroma > 4) * 20, 0.5, 9)
        p = np.maximum(p, weak * smooth(lab[..., 0], T - 11, T - 8))
    else:
        p = smooth(-dL, 18.0, 30.0)
        p = np.maximum(p, smooth(dC, 8.0, 14.0) * (chroma > 8))

    p = ndi.gaussian_filter(p, 0.7)
    hard = p > 0.5
    hard = ndi.binary_opening(hard, iterations=2)
    lab_, n = ndi.label(hard)
    sizes = ndi.sum(hard, lab_, range(1, n + 1))
    body = lab_ == (1 + int(np.argmax(sizes)))
    body = ndi.binary_closing(body, iterations=2)
    # فتحات صغيرة جوه القطعة (نقط في التطريز) مش خلفية — الكبيرة (بين الكم والجسم) خلفية
    holes = ndi.binary_fill_holes(body) & ~body
    hl, hn = ndi.label(holes)
    if hn:
        hs = ndi.sum(holes, hl, range(1, hn + 1))
        # فتحات مقفولة جوه القطعة (جوه الكابيشون/نقط التطريز) = قماش؛ الكبيرة (بين الكم والجسم) خلفية
        small = np.isin(hl, 1 + np.where(hs < body.sum() * 0.02)[0])
        body |= small

    # الكابيشون مقبّب ومقفول: قوسه اللي فوق (قماش رمادي فاتح + حرف دهبي رفيع)
    # قريب من الخلفية في الدرجة. بنملا أعلى القطعة جوه الشكل المحدّب بتاعه —
    # البكسلات نفسها من الصورة الأصلية (مش مرسومة)
    from skimage.morphology import convex_hull_image
    rows = np.where(body.any(1))[0]
    top, height = rows.min(), rows.max() - rows.min()
    hood = slice(top, top + int(height * 0.09))
    if kind == 'light' and body[hood].any():
        hull = convex_hull_image(body[hood])
        added = hull & ~body[hood]
        body[hood] |= hull
        p = p.copy()
        p[hood][added] = 1.0

    inner = ndi.binary_erosion(body, iterations=2)
    near = ndi.binary_dilation(body, iterations=2)
    alpha = np.where(near, p, 0.0)
    alpha[inner] = 1.0
    alpha[~near] = 0

    core = ndi.binary_erosion(body, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    clean = rgb.copy()
    rim = ~core
    clean[rim] = rgb[iy[rim], ix[rim]]
    diff = int(np.abs(clean.astype(int) - rgb.astype(int))[core].max())
    return np.dstack([clean, (alpha * 255).astype(np.uint8)]), diff


def main():
    spec = importlib.util.spec_from_file_location('rc', ROOT / 'scripts/room-cutouts.py')
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)

    entries = []
    for name, key, color, kind in SOURCES:
        rgba, diff = cut(name, kind)
        if diff != 0:
            sys.exit(f'{key}: بكسلات القطعة اتغيّرت')
        a = rgba[..., 3]
        ys, xs = np.nonzero(a > 8)
        pad = 6
        crop = rgba[max(0, ys.min() - pad): ys.max() + pad + 1, max(0, xs.min() - pad): xs.max() + pad + 1]
        img = Image.fromarray(crop, 'RGBA')
        if img.height > MAX_H:
            img = img.resize((round(img.width * MAX_H / img.height), MAX_H), Image.LANCZOS)
        base = f'{SLUG}--{key}'
        img.save(OUT / f'{base}.webp', 'WEBP', quality=90, method=6, exact=True)
        sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS)
        sm.save(OUT / f'{base}-sm.webp', 'WEBP', quality=84, method=6, exact=True)
        # الظل
        al = img.getchannel('A')
        small = al.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.LANCZOS)
        padd = max(6, small.width // 8)
        canvas = Image.new('L', (small.width + padd * 2, small.height + padd * 2), 0)
        canvas.paste(small, (padd, padd))
        canvas = canvas.filter(ImageFilter.GaussianBlur(padd * 0.55))
        sh = Image.new('RGBA', canvas.size, (20, 18, 14, 0))
        sh.putalpha(canvas)
        sh.save(OUT / f'{base}-shadow.webp', 'WEBP', quality=70, method=6)
        entries.append({
            'src': f'/room/{base}.webp',
            'srcSm': f'/room/{base}-sm.webp',
            'from': f'{SRC.name}/{name}',
            'color': color,
            'shadow': f'/room/{base}-shadow.webp',
            'ownHanger': False,
            'w': img.width,
            'h': img.height,
            **rc.anchors(img),
            'base': rc.fabric_color(img),
        })
        print(f'{base:<40} {img.width}x{img.height} maxDiff={diff}')

    path = ROOT / 'data/room-assets.json'
    m = json.loads(path.read_text(encoding='utf-8'))
    m[SLUG] = entries
    path.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')
    print('manifest ←', SLUG, len(entries))


if __name__ == '__main__':
    main()
