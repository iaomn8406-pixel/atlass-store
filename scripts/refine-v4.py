"""
تجهيز عينة ملف المراجعة v3 (نسخ جديدة — الأصول زي ما هي)
==========================================================

١) الطقم: صور On المفرودة اللي صاحب المشروع جهّزها (٦ تيشيرتات + بنطلون)
   → قص الخلفية الرمادي لشفافية + خطوط الطي (للطي والفرد في المشهد).
   الطي هندسي بس (الصورة نفسها بتتطبق) — مفيش أي تفصيلة مرسومة.
٢) عينة الشماعة/القماش/الحواف: Loewe الأبيض، Massimo الأبيض، العباية
   البترولي والسودا → نسخ ‎-v4 بحواف ناعمة من غير شرشرة وهالة، وللأبيضين
   تقوية الظلال اللي في الصورة الأصلية نفسها (مش ثنيات مخترعة).
٣) خط الكتف (rim) لكل قطعة متعلّقة: الشماعة بتترسم تحته عشان الخشب
   مايطلعش برّه القماش أبدًا.

الاستخدام:  python scripts/refine-v4.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
ROOM = ROOT / 'public/room'
MANIFEST = ROOT / 'data/room-assets.json'
GEN = Path(r'E:/شغل/اطلس/مولّد-للمراجعة/الطقم ، والبنطلون')
W = 'WhatsApp Image 2026-11-16 at '

# مطابقة كل ملف مستلم بلون الطقم (اتراجعت بالعين مقابل الأصل)
SET_TEES = {
    'white': W + '8.24.13 PM.jpeg',
    'black': W + '8.24.13 PM (1).jpeg',
    'navy': W + '8.24.12 PM (1).jpeg',
    'olive': W + '8.24.11 PM.jpeg',
    'red': W + '8.24.12 PM.jpeg',
    'yellow': W + '8.24.21 PM.jpeg',
}
SET_PANTS = W + '8.26.51 PM.jpeg'
SET_KEYS = {'أبيض': 'white', 'اسود': 'black', 'كحلي': 'navy', 'زيتي': 'olive', 'أحمر': 'red', 'أصفر': 'yellow'}

# تنضيف الحواف لكل القطع المتعلّقة (ملف المراجعة v6 ٨-١):
# (المنتج، اللون، تقوية ظلال الأبيض، نص قطر تنضيف الحافة، شيل خلفية تحت الديل)
SAMPLE = [
    ('loewe-mens-tshirt', 'white', True, 2, False),
    ('massimo-dutti-oversize', 'white', True, 2, False),
    ('loewe-mens-tshirt', 'black', False, 2, False, True),
    ('hooded-embroidered-abaya', 'blue', False, 3, True),
    ('hooded-embroidered-abaya', 'black', False, 3, True),
    # العبايات الفاتحة: من غير خطوة «تحت الديل» (كانت هتشيل القماش الفاتح نفسه)
    ('hooded-embroidered-abaya', 'white', False, 3, False),
    ('hooded-embroidered-abaya', 'beige', False, 3, False),
]

# الصور اللي صاحب المشروع جهّزها من غير شماعة (٠٧ و٠٨) — بتتعلق على نفس شماعة
# المشهد زي باقي السكة (ملف v6 ٣-٦: نوع شماعة واحد)
UNHUNG = [
    ('massimo-dutti-oversize', 'black', r'E:/شغل/اطلس/مولّد-للمراجعة/من 7 ل 10/WhatsApp Image 2026-11-16 at 8.31.04 PM (2).jpeg'),
    ('tshirt-1975-print', 'olive', r'E:/شغل/اطلس/مولّد-للمراجعة/من 7 ل 10/WhatsApp Image 2026-11-16 at 8.31.06 PM.jpeg'),
]


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def largest(mask, keep_frac=0.004):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= max(sizes.max() * 0.02, mask.size * keep_frac)]
    return np.isin(lab, keep)


def bleed(rgba):
    a = rgba.copy()
    solid = a[..., 3] >= 200
    if solid.any() and not solid.all():
        _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
        soft = ~solid
        a[..., :3][soft] = a[..., :3][iy[soft], ix[soft]]
    return a


def save_set(img, path, quality=90):
    Image.fromarray(img, 'RGBA').save(path, 'WEBP', quality=quality, method=6, exact=True)


def decontaminate(rgb, alpha, depth=3):
    """لون الحافة (أول كام بكسل + الشفاف) = لون القماش اللي جوه بـ depth بكسل —
    بكسلات الطرف نفسها متلوثة بالخلفية وضغط JPEG فبتطلع نقط فاتحة على الغامق"""
    inner = ndi.binary_erosion(alpha > 0.98, disk(depth))
    if not inner.any():
        return rgb
    _, (iy, ix) = ndi.distance_transform_edt(~inner, return_indices=True)
    out = rgb.copy()
    rim = ~inner
    out[rim] = rgb[iy[rim], ix[rim]]
    return out


def smooth_alpha(a):
    """حافة ناعمة (anti-aliased) في نفس مكانها: تمويه خفيف وبعدين منحنى حول ٠٫٥"""
    s = ndi.gaussian_filter(a, 0.9)
    t = np.clip((s - 0.18) / 0.64, 0, 1)
    return t * t * (3 - 2 * t)


def shadow_of(alpha_img):
    small = alpha_img.resize((max(1, alpha_img.width // 3), max(1, alpha_img.height // 3)), Image.LANCZOS)
    pad = max(6, small.width // 8)
    canvas = Image.new('L', (small.width + pad * 2, small.height + pad * 2), 0)
    canvas.paste(small, (pad, pad))
    canvas = canvas.filter(ImageFilter.GaussianBlur(pad * 0.55))
    sh = Image.new('RGBA', canvas.size, (20, 18, 14, 0))
    sh.putalpha(canvas)
    return sh


# ---------------------------------------------------------------- ١) الطقم
def cut_flat(path):
    """قص خلفية رمادي سادة (الصور المجهزة) → RGBA مقصوصة على القطعة"""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, 0)
    d = np.abs(rgb - bg).max(2)
    # هالة الشحذ في صور واتساب: بكسلات أفتح من الخلفية في كل القنوات — مش قماش
    halo = rgb.min(2) > bg.min() + 3
    m0 = ndi.binary_fill_holes(largest(d > 9))
    light = float(np.median(rgb.mean(2)[m0])) > 200
    # القماش الفاتح فرقه عن الخلفية صغير: عتبة أوطى عشان الحافة ماتبقاش مقطّعة
    m = ndi.binary_fill_holes(largest((d > (6 if light else 9)) & ~halo))
    m = ndi.binary_opening(ndi.binary_closing(m, disk(4 if light else 2)), disk(3 if light else 1))
    m = ndi.binary_fill_holes(largest(m))
    # الحافة من الشكل كله بعد تنعيمه (مش بكسل بكسل — ده كان بيطلع شرشرة من نويز الـ JPEG)
    sm = ndi.gaussian_filter(m.astype(np.float32), 2.4 if light else 1.4)
    t = np.clip((sm - 0.3) / 0.4, 0, 1)
    a = t * t * (3 - 2 * t)
    if not light:
        # نقط بيضا صغيرة على الطرف (بقايا شحذ الصورة) في القماش الملوّن/الغامق
        L = rgb.mean(2)
        med = float(np.median(L[a > 0.9]))
        chroma = rgb.max(2) - rgb.min(2)
        rim = (a > 0.01) & ~ndi.binary_erosion(a > 0.5, disk(4))
        bad = rim & (L > med + 60) & (chroma < 60)
        a = np.where(ndi.binary_dilation(bad, disk(1)) & rim, 0, a)
        a = smooth_alpha(a)
    # لون الحافة = لون القماش اللي جوه (من غير خلطة الرمادي) → مفيش هالة
    col = decontaminate(rgb, a)
    out = np.dstack([col, a * 255]).round().astype(np.uint8)
    ys, xs = np.where(a > 0.02)
    pad = 10
    y0, y1 = max(0, ys.min() - pad), min(out.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(out.shape[1], xs.max() + pad + 1)
    return out[y0:y1, x0:x1], pad


def widths(alpha, row):
    xs = np.where(alpha[row] > 128)[0]
    return (xs.min(), xs.max()) if len(xs) else (0, alpha.shape[1] - 1)


def set_assets():
    out_dir = ROOM / 'set-v4'
    out_dir.mkdir(exist_ok=True)
    res = {}

    # البنطلون (واحد للألوان الستة — نفس البنطلون الأسود في صور الأطقم الست)
    p, _ = cut_flat(GEN / SET_PANTS)
    al = p[..., 3]
    ys = np.where((al > 128).any(1))[0]
    top, bot = ys.min(), ys.max()
    l, r = widths(al, top + int((bot - top) * 0.06))
    waist = r - l
    pb = bleed(p)
    save_set(pb, out_dir / 'oncloud-pants.webp')
    sm = Image.fromarray(pb, 'RGBA')
    sm = sm.resize((round(sm.width * 560 / sm.height), 560), Image.LANCZOS)
    save_set(np.asarray(sm), out_dir / 'oncloud-pants-sm.webp', 86)
    pants = {
        'src': '/room/set-v4/oncloud-pants.webp',
        'srcSm': '/room/set-v4/oncloud-pants-sm.webp',
        'from': 'مولّد-للمراجعة/الطقم ، والبنطلون/' + SET_PANTS,
        'w': int(p.shape[1]), 'h': int(p.shape[0]),
        # الطي: الرجل الشمال ورا اليمين (اللي عليها الشعار)، وبعدين النص التحتاني لورا
        'cuts': [round((l + r) / 2 / p.shape[1], 4)],
        'anchor': 1,
        'foldV': round((top + (bot - top) * 0.5) / p.shape[0], 4),
        'top': round(top / p.shape[0], 4), 'bottom': round(bot / p.shape[0], 4),
        # عرض الوسط الحقيقي مفرود ~٣٨ سم
        'ppm': round(waist / 0.38, 2),
    }
    print('pants', p.shape[1], p.shape[0], 'waist', waist, 'len m', round((bot - top) / pants['ppm'], 2))

    for key, f in SET_TEES.items():
        t, _ = cut_flat(GEN / f)
        al = t[..., 3]
        ys = np.where((al > 128).any(1))[0]
        top, bot = ys.min(), ys.max()
        # عرض الجسم عند الديل (تحت الأكمام)
        l, r = widths(al, top + int((bot - top) * 0.9))
        body = r - l
        cx = (l + r) / 2
        half = body * 0.275
        tb = bleed(t)
        save_set(tb, out_dir / f'oncloud-{key}-tee.webp')
        sm = Image.fromarray(tb, 'RGBA')
        sm = sm.resize((560, round(sm.height * 560 / sm.width)), Image.LANCZOS)
        save_set(np.asarray(sm), out_dir / f'oncloud-{key}-tee-sm.webp', 86)
        res[key] = {
            'tee': {
                'src': f'/room/set-v4/oncloud-{key}-tee.webp',
                'srcSm': f'/room/set-v4/oncloud-{key}-tee-sm.webp',
                'from': 'مولّد-للمراجعة/الطقم ، والبنطلون/' + f,
                'w': int(t.shape[1]), 'h': int(t.shape[0]),
                # الطي زي المحلات: الجنبين بالأكمام لورا، وبعدين النص التحتاني لورا
                'cuts': [round((cx - half) / t.shape[1], 4), round((cx + half) / t.shape[1], 4)],
                'anchor': 1,
                'foldV': round((top + (bot - top) * 0.5) / t.shape[0], 4),
                'top': round(top / t.shape[0], 4), 'bottom': round(bot / t.shape[0], 4),
                # عرض جسم تيشيرت رجالي مفرود ~٥٢ سم
                'ppm': round(body / 0.52, 2),
            },
            'pants': pants,
        }
        print(key, t.shape[1], t.shape[0], 'body', body, 'len m', round((bot - top) / res[key]['tee']['ppm'], 2))
    return res


# ---------------------------------------------------------------- ٢) العينة
def refine(slug, key, whiten, r, hem_fix, dark_rim=False):
    src = ROOM / f'{slug}--{key}.webp'
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32)
    A = a[..., 3] / 255
    if hem_fix:
        # تحت الديل: بقع رمادي/أبيض فاتح من خلفية الصورة اتقصّت مع القطعة (العباية
        # الغامقة مفيهاش أي جزء فاتح هناك) → بتتشال، والديل نفسه زي ما هو
        L = a[..., :3].mean(2)
        sat = a[..., :3].max(2) - a[..., :3].min(2)
        ys = np.where((A > 0.5).any(1))[0]
        hem = np.zeros_like(A, bool)
        hem[ys.max() - int((ys.max() - ys.min()) * 0.07):] = True
        light = hem & (L > 120) & (sat < 40)
        light = ndi.binary_dilation(light, disk(1)) & hem
        print(f'  hem background px removed {int((light & (A > 0.5)).sum())}')
        A = np.where(light, 0, A)
    if dark_rim:
        # تيشيرت غامق: بكسلات فاتحة مصمتة على الطرف (بقايا خلفية في القص القديم) بتتشال
        Lr = a[..., :3].mean(2)
        med = float(np.median(Lr[A > 0.9]))
        rim = (A > 0.02) & ~ndi.binary_erosion(A > 0.5, disk(4))
        bad = rim & (Lr > med + 60)
        print(f'  light rim px removed {int(bad.sum())}')
        A = np.where(bad, 0, A)
    core = A > 0.5
    # الشرشرة والخيوط الرفيعة اللي على الحافة (أرفع من ٢r بكسل) بتتشال — القطعة نفسها لأ
    kept = largest(ndi.binary_opening(core, disk(r)))
    allowed = ndi.binary_dilation(kept, disk(1))
    A1 = A * allowed
    A2 = smooth_alpha(A1)
    removed = int(((A > 0.5) & (A2 < 0.5)).sum())
    added = int(((A < 0.5) & (A2 > 0.5)).sum())
    rgb = a[..., :3]
    if whiten:
        L = rgb.mean(2)
        inner = ndi.binary_erosion(A2 > 0.98, disk(4)).astype(np.float32)
        inner = ndi.gaussian_filter(inner, 3)
        # الطباعة/اللوجو بيفضلوا زي ما هم بالظبط
        ink = ndi.binary_dilation(L < 185, disk(5)).astype(np.float32)
        ink = ndi.gaussian_filter(ink, 2)
        w = inner * (1 - ink)
        Lf = np.where(inner > 0.5, L, np.nan)
        mean = np.nanmean(Lf)
        # تمويه بيتجاهل الطباعة والحواف (normalized convolution) — من غير هالة غامقة حوالين اللوجو
        fab = ((inner > 0.5) & (ink < 0.05)).astype(np.float32)

        def nblur(s):
            return ndi.gaussian_filter(L * fab, s) / np.maximum(ndi.gaussian_filter(fab, s), 1e-3)

        # من غير الترددات العالية (نويز الـ JPEG كان بيطلع نمش)
        fine = (nblur(2.2) - nblur(10)) * fab
        broad = nblur(28) - mean
        delta = (0.5 * fine + 2.0 * broad) * w
        rgb = np.clip(rgb + delta[..., None], 0, 255)
        print(f'  whiten: fabric L std {np.nanstd(Lf):.1f} -> {np.nanstd(np.where(inner > 0.5, rgb.mean(2), np.nan)):.1f}')
    rgb = decontaminate(rgb, A2)
    out = bleed(np.dstack([rgb, A2 * 255]).round().astype(np.uint8))
    name = f'{slug}--{key}-v4'
    save_set(out, ROOM / f'{name}.webp')
    img = Image.fromarray(out, 'RGBA')
    sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS) if img.height > 420 else img
    save_set(bleed(np.asarray(sm)), ROOM / f'{name}-sm.webp', 86)
    shadow_of(img.getchannel('A')).save(ROOM / f'{name}-shadow.webp', 'WEBP', quality=70, method=6)
    print(f'{name}: edge px removed {removed}, added {added}')
    return name


def unhung(man, slug, key, path):
    import importlib.util
    spec = importlib.util.spec_from_file_location('room_cutouts', ROOT / 'scripts/room-cutouts.py')
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)
    t, _ = cut_flat(path)
    img = Image.fromarray(bleed(t), 'RGBA')
    if img.height != 960:
        img = img.resize((round(img.width * 960 / img.height), 960), Image.LANCZOS)
    out = bleed(np.asarray(img))
    name = f'{slug}--{key}-v4'
    save_set(out, ROOM / f'{name}.webp')
    img = Image.fromarray(out, 'RGBA')
    sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS)
    save_set(bleed(np.asarray(sm)), ROOM / f'{name}-sm.webp', 86)
    shadow_of(img.getchannel('A')).save(ROOM / f'{name}-shadow.webp', 'WEBP', quality=70, method=6)
    for e in man[slug]:
        if e['src'] in (f'/room/{slug}--{key}.webp', f'/room/{name}.webp'):
            e.update({
                'src': f'/room/{name}.webp', 'srcSm': f'/room/{name}-sm.webp', 'shadow': f'/room/{name}-shadow.webp',
                'from': 'مولّد-للمراجعة/من 7 ل 10/' + Path(path).name,
                'ownHanger': False, 'w': img.width, 'h': img.height, **rc.anchors(img), 'base': rc.fabric_color(img),
                'sample': 'v4',
            })
            e.pop('depth', None)
    print(name, img.size)


# ---------------------------------------------------------------- ٣) خط الكتف
def rim(src):
    al = np.asarray(Image.open(ROOT / 'public' / src.lstrip('/')).convert('RGBA'))[..., 3]
    h, w = al.shape
    out = []
    for u in np.linspace(0, 1, 41):
        x = min(w - 1, int(round(u * (w - 1))))
        col = np.where(al[:, max(0, x - 1):x + 2].max(1) > 128)[0]
        out.append(round(col.min() / h, 4) if len(col) else 1.0)
    return out


def main():
    man = json.loads(MANIFEST.read_text(encoding='utf8'))
    sets = set_assets()
    for e in man.get('on-cloud-tracksuit', []):
        k = SET_KEYS.get(e.get('color'))
        if k:
            e['foldSet'] = sets[k]
    for slug, key, path in UNHUNG:
        unhung(man, slug, key, path)
    for slug, key, whiten, r, hem_fix, *rest in SAMPLE:
        name = refine(slug, key, whiten, r, hem_fix, *rest)
        for e in man[slug]:
            if e['src'] == f'/room/{slug}--{key}.webp' or e['src'] == f'/room/{name}.webp':
                e['src'] = f'/room/{name}.webp'
                e['srcSm'] = f'/room/{name}-sm.webp'
                e['shadow'] = f'/room/{name}-shadow.webp'
                e['sample'] = 'v4'
    for slug, lst in man.items():
        for e in lst:
            if not e.get('flat') and not e.get('foldSet'):
                e['rim'] = rim(e['src'])
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
