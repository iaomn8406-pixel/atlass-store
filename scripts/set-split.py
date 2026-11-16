"""
الطقم كقطعتين منفصلتين: تيشيرت + بنطلون (من صور المنتج نفسها)
=================================================================

في كل صورة البنطلون (أسود) مرمي فوق التيشيرت:
  • البنطلون هو الطبقة اللي فوق → ظاهر كامل → بيتقص زي ما هو
    (بالتيكت والأستك)، وبيتلف رأسي (الوسط فوق).
  • التيشيرت جزء منه تحت البنطلون. التيشيرت سادة ومتماثل، فالجزء
    المستخبي (تحت البنطلون بس) بيتكمّل من الجنب التاني من نفس
    التيشيرت معكوس على محوره (نص الياقة) — نفس القماش والإضاءة،
    مش رسم ولا توليد. الحدود الظاهرة للتيشيرت زي ما هي بالظبط.
  • الطقم الأسود: التيشيرت والبنطلون الاتنين أسود فمفيش فرق لون
    نفصل بيه. البنطلون = نفس البنطلون من صورة الكحلي (نفس القطعة
    بالظبط)، والتيشيرت = الكحلي المكمّل متلوّن أسود في Lab (اللوجو
    والتفاصيل زي ما هي). ده متسجّل في البيانات (derived).

الناتج: public/room/set/oncloud-<color>-tee.webp و -pants.webp
وبيحدّث data/room-assets.json (pair). بعده: room-depth.py
"""

import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color as skcolor

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/room/set'
SLUG = 'on-cloud-tracksuit'
TEE_SPAN = 0.78  # من طرف الكم للطرف التاني (متر)
PANTS_LEN = 1.0  # البنطلون متطبّق بالطول: من الوسط للرجل


def load_set_cutouts():
    spec = importlib.util.spec_from_file_location('sc', ROOT / 'scripts/set-cutouts.py')
    sc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sc)
    return sc


def split(rgba):
    rgb = rgba[..., :3]
    garment = rgba[..., 3] > 128
    lab = skcolor.rgb2lab(rgb)
    C = np.hypot(lab[..., 1], lab[..., 2])
    L = lab[..., 0]
    dark = garment & (L < 30) & (C < 9)
    dark = ndi.binary_opening(dark, iterations=2)
    lab_, n = ndi.label(dark)
    sizes = ndi.sum(dark, lab_, range(1, n + 1))
    pants = lab_ == (1 + int(np.argmax(sizes)))
    # التيكت الأبيض والأستك جوه حدود البنطلون
    pants = ndi.binary_fill_holes(ndi.binary_closing(pants, iterations=6)) & garment
    # التيكت (مستطيل أبيض) متعلّق في البنطلون — لو لازق فيه يبقى منه مش من التيشيرت
    tag = garment & (L > 80) & (C < 10)
    tag = ndi.binary_opening(tag, iterations=1)
    tl, tn = ndi.label(tag)
    near_p = ndi.binary_dilation(pants, iterations=10)
    for i in range(1, tn + 1):
        blob = tl == i
        if blob.sum() > 150 and (blob & near_p).any() and blob.sum() < garment.sum() * 0.05:
            pants |= ndi.binary_dilation(blob, iterations=2) & garment
    pants = ndi.binary_fill_holes(ndi.binary_closing(pants, iterations=3)) & garment
    tee_vis = garment & ~ndi.binary_dilation(pants, iterations=2)
    lab2, n2 = ndi.label(tee_vis)
    s2 = ndi.sum(tee_vis, lab2, range(1, n2 + 1))
    tee_vis = lab2 == (1 + int(np.argmax(s2)))
    return pants, tee_vis


def complete_tee(rgb, tee_vis, hidden_zone):
    """
    بيكمّل الجزء المستخبي تحت البنطلون من الجنب التاني معكوس — قماش بس:
    أي بكسل معكوس شكله لوجو/طباعة (بعيد عن لون القماش) بيتبدّل بأقرب
    قماش سادة، عشان مانكرّرش اللوجو ولا نخترع طباعة.
    """
    ys, xs = np.nonzero(tee_vis)
    top = ys.min()
    band = tee_vis[top: top + max(3, int((ys.max() - top) * 0.03))]
    axis = float(np.nonzero(band.any(0))[0].mean())  # نص الياقة = أعلى نقطة
    h, w = tee_vis.shape
    yy, xx = np.mgrid[0:h, 0:w]
    mx = np.round(2 * axis - xx).astype(int)
    ok = (mx >= 0) & (mx < w)
    mirrored = np.zeros_like(tee_vis)
    mirrored[ok] = tee_vis[yy[ok], mx[ok]]
    fill = mirrored & hidden_zone & ~tee_vis
    full = ndi.binary_fill_holes(ndi.binary_closing(tee_vis | fill, iterations=5))
    fill = full & ~tee_vis

    lab = skcolor.rgb2lab(rgb)
    base = np.median(lab[tee_vis], axis=0)
    fabric = tee_vis & (np.abs(lab[..., 0] - base[0]) < 22) & (np.hypot(lab[..., 1] - base[1], lab[..., 2] - base[2]) < 14)
    fabric = ndi.binary_erosion(fabric, iterations=2)
    _, (fy, fx) = ndi.distance_transform_edt(~fabric, return_indices=True)

    out = rgb.copy()
    src_ok = fill & ok
    src_ok[src_ok] = fabric[yy[src_ok], mx[src_ok]]  # المصدر المعكوس لازم يكون قماش
    out[src_ok] = rgb[yy[src_ok], mx[src_ok]]
    rest = fill & ~src_ok
    out[rest] = rgb[fy[rest], fx[rest]]  # غير كده أقرب قماش سادة
    return out, full, axis


def to_rgba(rgb, mask, feather=0.8):
    a = ndi.gaussian_filter(mask.astype(float), feather)
    a[~ndi.binary_dilation(mask, iterations=2)] = 0
    core = ndi.binary_erosion(mask, iterations=2)
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    clean = rgb.copy()
    rim = ~core
    clean[rim] = rgb[iy[rim], ix[rim]]
    rgba = np.dstack([clean, (np.clip(a, 0, 1) * 255).astype(np.uint8)])
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    return rgba[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]


def upright_pants(rgba):
    """البنطلون بيتلف رأسي على محوره الطويل، والوسط (الأعرض) فوق"""
    m = rgba[..., 3] > 128
    ys, xs = np.nonzero(m)
    evals, evecs = np.linalg.eigh(np.cov(np.vstack([xs, ys])))
    v = evecs[:, np.argmax(evals)]
    ang = float(np.degrees(np.arctan2(v[0], v[1])))
    im = Image.fromarray(rgba, 'RGBA').rotate(-ang, resample=Image.BICUBIC, expand=True)
    a = np.asarray(im)
    mm = a[..., 3] > 128
    rows = np.where(mm.any(1))[0]
    hgt = rows.max() - rows.min()
    w = lambda r: np.ptp(np.nonzero(mm[r])[0]) if mm[r].any() else 0
    top = np.mean([w(r) for r in range(rows.min(), rows.min() + hgt // 6)])
    bot = np.mean([w(r) for r in range(rows.max() - hgt // 6, rows.max())])
    if bot > top:
        im = im.rotate(180, expand=True)
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


def recolor_lab(rgba, base_rgb, target_rgb):
    """نفس معادلة المعاينة في المشهد: الدرجة بتتغيّر والظل/الكسرات زي ما هم"""
    rgb = rgba[..., :3].astype(float) / 255
    L = skcolor.rgb2lab(rgb)
    B = skcolor.rgb2lab(np.array([[base_rgb]], float) / 255)[0, 0]
    T = skcolor.rgb2lab(np.array([[target_rgb]], float) / 255)[0, 0]
    dab = np.hypot(L[..., 1] - B[1], L[..., 2] - B[2])
    dl = np.abs(L[..., 0] - B[0])
    sm = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)
    w = (1 - sm(dab, 10, 24)) * (1 - sm(dl, 26, 44))
    gain = 0.55 + 0.45 * min(1, T[0] / 70)
    N = np.dstack([
        np.clip(T[0] + (L[..., 0] - B[0]) * gain, 0, 100),
        T[1] + (L[..., 1] - B[1]) * 0.35,
        T[2] + (L[..., 2] - B[2]) * 0.35,
    ])
    rec = np.clip(skcolor.lab2rgb(N), 0, 1)
    out = rgb * (1 - w[..., None]) + rec * w[..., None]
    return np.dstack([(out * 255).astype(np.uint8), rgba[..., 3]])


def save(img, name):
    img.save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6, exact=True)
    sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS) if img.height > 420 else img
    sm.save(OUT / f'{name}-sm.webp', 'WEBP', quality=84, method=6, exact=True)


def main():
    sc = load_set_cutouts()
    path = ROOT / 'data/room-assets.json'
    m = json.loads(path.read_text(encoding='utf-8'))
    entries = {a['color']: a for a in m[SLUG]}
    navy_tee = navy_pants = None
    results = {}

    for name, key, colour in sc.SOURCES:
        if key == 'black':
            continue
        rgba, _diff, _t = sc.cut(sc.SRC_DIR / name)
        rgba = np.asarray(rgba)
        rgb = rgba[..., :3]
        pants, tee_vis = split(rgba)
        tee_rgb, tee_full, axis = complete_tee(rgb, tee_vis, ndi.binary_dilation(pants, iterations=3))
        tee = Image.fromarray(to_rgba(tee_rgb, tee_full), 'RGBA')
        pants_img = upright_pants(to_rgba(rgb, pants))
        filled = int((tee_full & ~tee_vis).sum())
        results[key] = (colour, tee, pants_img, filled, int(tee_full.sum()))
        if key == 'navy':
            navy_tee, navy_pants = tee, pants_img

    # الأسود: نفس البنطلون + التيشيرت الكحلي متلوّن أسود (اللوجو زي ما هو)
    navy_base = entries['كحلي'].get('base') or [30, 40, 80]
    black_tee = Image.fromarray(recolor_lab(np.asarray(navy_tee), navy_base, [22, 23, 26]), 'RGBA')
    results['black'] = ('اسود', black_tee, navy_pants, -1, 0)

    for key, (colour, tee, pants_img, filled, total) in results.items():
        save(tee, f'oncloud-{key}-tee')
        save(pants_img, f'oncloud-{key}-pants')
        e = entries[colour]
        e['src'] = f'/room/set/oncloud-{key}-tee.webp'
        e['srcSm'] = f'/room/set/oncloud-{key}-tee-sm.webp'
        e['w'], e['h'] = tee.width, tee.height
        e['flat'] = {'span': TEE_SPAN}
        e['pair'] = {
            'src': f'/room/set/oncloud-{key}-pants-sm.webp',
            'w': pants_img.width,
            'h': pants_img.height,
            'len': PANTS_LEN,
        }
        if key == 'black':
            e['derived'] = 'تيشيرت الكحلي متلوّن أسود + نفس البنطلون — الطقم الأسود في الصورة مش بيتفصل'
        else:
            e.pop('derived', None)
            e['mirrored'] = round(filled / max(1, total), 3)
        e.pop('depth', None)
        print(f'{key:<7} tee {tee.size} pants {pants_img.size}  mirrored={e.get("mirrored", "derived")}')
    path.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
