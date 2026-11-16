"""
قصّ الطقم (On Cloud NE29) بألوانه الستة — من صور المنتج الأصلية
=================================================================

الصور: E:/شغل/اطلس/ترينج  NE29 on cloud (مخزن Z13)/*.jpg
كل صورة = الطقم كامل متصوّر من فوق على خشب (التيشيرت والبنطلون
فوقه زي ما اتطبّقوا). بنشيل الخشب بس — القطعة نفسها زي ما هي
بالظبط (مفيش فصل، مفيش رسم، مفيش تعديل ألوان).

إزاي بنعرف الخشب:
  • الخشب موجود على أطراف الصورة كلها → بناخد منه عيّنة ألوان (Lab)
    ونحسب لكل بكسل «قد إيه شبه الخشب» (مسافة ماهالانوبيس).
  • اللي مش شبه الخشب ومتصل بنص الصورة = الطقم.
  • الحافة: شفافية ناعمة من نفس المسافة (مش قص حاد)، ولون الحافة
    بيتنضّف من البني (بياخد لون القطعة الأقرب).

الناتج: public/room/set/oncloud-<color>.webp (+ -sm و -shadow)
وبيكتب الطقم في data/room-assets.json — شغّله بعد room-cutouts.py.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from skimage import color as skcolor

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = Path(r'E:/شغل/اطلس/ترينج  NE29 on cloud (مخزن Z13)')
OUT = ROOT / 'public/room/set'
SLUG = 'on-cloud-tracksuit'

# اسم الصورة ← اللون (نفس أسماء الألوان في بيانات المنتج)
SOURCES = [
    ('NZFblgLkNHLeB9NwGcAfsVyReEub1CQlJcZehGJ8.jpg', 'navy', 'كحلي'),
    ('vKLS1Fp5wJJCQ8bY29oVjtcfuYlgGgmBV55C79Bn.jpg', 'black', 'اسود'),
    ('9KfPCo3QgaeymP2BXSSVU0QtqMbcn1lAptXrfTLY.jpg', 'white', 'أبيض'),
    ('JnIx8LPdiIdFeoqVJqetyrkDJszW9qk2TgFtfsCW.jpg', 'olive', 'زيتي'),
    ('GKGDKsReCTp7oyLlospfeyRIoMWSALsGvWPwzG0W.jpg', 'red', 'أحمر'),
    ('0w8mcBkSWFifsJVqZnVHAbHILT1kqEZOMHcauGkG.jpg', 'yellow', 'أصفر'),
]

# عرض الطقم من طرف كم التيشيرت للطرف التاني ≈ ٨٠ سم (تيشيرت رجالي متفرد)
SPAN_M = 0.80


def wood_prob(lab):
    """
    احتمال إن البكسل خشب: الخشب بني دافي — تشبّع متوسط (≈ 11–26)
    ودرجة لون برتقالي/بني (≈ 37–62°). الأسود والأبيض تشبّعهم شبه صفر،
    والأحمر/الأصفر تشبّعهم عالي أو درجتهم بعيدة — فمش بيتلخبطوا معاه.
    (القيم متقاسة من أطراف الصور نفسها)
    """
    C = np.hypot(lab[..., 1], lab[..., 2])
    H = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    sig = lambda x: 1 / (1 + np.exp(-x))
    sat = sig((C - 7.5) / 1.2) * sig((40 - C) / 3)
    hue = sig((H - 24) / 3) * sig((76 - H) / 3)
    return sat * hue


def cut(path):
    rgb = np.asarray(Image.open(path).convert('RGB'))
    h, w = rgb.shape[:2]
    lab = skcolor.rgb2lab(rgb)

    wood = ndi.gaussian_filter(wood_prob(lab), 1.4)
    garment = wood < 0.5
    # فواصل الألواح خطوط رفيعة — الفتح بيشيلها من غير ما يمس القطعة
    garment = ndi.binary_opening(garment, iterations=3)
    lab_, n = ndi.label(garment)
    sizes = ndi.sum(garment, lab_, range(1, n + 1))
    body = lab_ == (1 + int(np.argmax(sizes)))
    body = ndi.binary_closing(body, iterations=3)
    body = ndi.binary_fill_holes(body)

    # الحافة: شفافية ناعمة من احتمال الخشب نفسه
    inner = ndi.binary_erosion(body, iterations=3)
    near = ndi.binary_dilation(body, iterations=3)
    a = np.clip((0.75 - wood) / 0.5, 0, 1)
    a = a * a * (3 - 2 * a)
    alpha = np.where(near, a, 0.0)
    alpha[inner] = 1.0
    alpha = ndi.gaussian_filter(alpha, 0.5)
    alpha[~near] = 0

    core = ndi.binary_erosion(body, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    clean = rgb.copy()
    rim = ~core
    clean[rim] = rgb[iy[rim], ix[rim]]
    diff = int(np.abs(clean.astype(int) - rgb.astype(int))[core].max())

    rgba = np.dstack([clean, (alpha * 255).astype(np.uint8)])
    ys, xs = np.nonzero(alpha > 0.03)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    touches = ys.min() <= 2 or xs.min() <= 2 or ys.max() >= h - 3 or xs.max() >= w - 3
    return Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA'), diff, touches


def fabric_color(img):
    """لون القماش الأساسي (للمعاينة بلون تاني) — أكتر لون متكرر جوه التيشيرت"""
    a = np.asarray(img)
    m = a[..., 3] > 250
    px = a[..., :3][m].astype(float)
    return [int(v) for v in np.median(px, 0)]


def shadow_of(img, out):
    a = img.getchannel('A')
    small = a.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.LANCZOS)
    pad = max(6, small.width // 8)
    canvas = Image.new('L', (small.width + pad * 2, small.height + pad * 2), 0)
    canvas.paste(small, (pad, pad))
    canvas = canvas.filter(ImageFilter.GaussianBlur(pad * 0.55))
    sh = Image.new('RGBA', canvas.size, (20, 18, 14, 0))
    sh.putalpha(canvas)
    sh.save(out, 'WEBP', quality=70, method=6)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, key, color in SOURCES:
        img, diff, touches = cut(SRC_DIR / name)
        if diff != 0:
            sys.exit(f'{key}: بكسلات القطعة اتغيّرت')
        if touches:
            print(f'⚠ {key}: القطعة لامسة حرف الصورة — راجعها')
        base = f'oncloud-{key}'
        img.save(OUT / f'{base}.webp', 'WEBP', quality=88, method=6)
        sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS) if img.height > 420 else img
        sm.save(OUT / f'{base}-sm.webp', 'WEBP', quality=82, method=6)
        shadow_of(img, OUT / f'{base}-shadow.webp')
        entries.append({
            'src': f'/room/set/{base}.webp',
            'srcSm': f'/room/set/{base}-sm.webp',
            'from': f'{SRC_DIR.name}/{name}',
            'color': color,
            'shadow': f'/room/set/{base}-shadow.webp',
            'ownHanger': False,
            'w': img.width,
            'h': img.height,
            'hookX': 0.5,
            'top': 0,
            'shoulder': 1.0,
            # متصوّر من فوق — بيتحط نايم على الترابيزة بمقاسه الحقيقي
            'flat': {'span': SPAN_M},
            'base': fabric_color(img),
        })
        print(f'{base:<22} {img.width}x{img.height}  maxDiff={diff}')

    path = ROOT / 'data/room-assets.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest[SLUG] = entries
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('manifest ←', SLUG, len(entries))


if __name__ == '__main__':
    main()
