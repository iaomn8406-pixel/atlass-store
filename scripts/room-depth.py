"""
خريطة عمق لكل قطعة — عشان تتعرض مجسّمة مش صورة مسطحة
==========================================================

القطعة نفسها (ألوانها وتفاصيلها) مابتتغيّرش. اللي بنحسبه هنا "شكل"
بس: قد إيه كل نقطة في القطعة بارزة لقدام، من حدود القطعة نفسها:

  • المتعلّقة (تيشيرت/عباية): الجسم بيبرز لقدام والحواف بتدوّر لورا —
    زي قماش لابس شماعة. الحتت الرفيعة (الكم، الأطراف) بروزها أقل
    تلقائيًا لأنها قريبة من الحافة.
  • المتطبّقة على الترابيزة (الطقم): سُمك قماش متطبّق بحواف مدوّرة،
    والبنطلون (الأسود اللي فوق التيشيرت) طبقة أعلى منه.

الناتج: <نفس اسم الصورة>-depth.png (رمادي، ٢٥٦ بكسل) + حقل depth في
data/room-assets.json. شغّله بعد room-cutouts.py و set-cutouts.py.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'data/room-assets.json'
SIZE = 256


def rounded(mask, radius):
    """بروز ناعم: صفر عند الحافة، بيوصل للقمة بعد radius بكسل (منحنى ربع دايرة)"""
    d = ndi.distance_transform_edt(mask)
    t = np.clip(d / max(1.0, radius), 0, 1)
    return np.sqrt(1 - (1 - t) ** 2)


def depth_for(src, flat):
    im = Image.open(src).convert('RGBA')
    scale = SIZE / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    a = np.asarray(im)
    mask = a[..., 3] > 110
    mask = ndi.binary_opening(mask, iterations=1)

    if flat:
        # قماش متطبّق: سُمك ثابت بحواف مدوّرة (~٦ بكسل)
        base = rounded(mask, 6)
        # البنطلون الأسود فوق التيشيرت = طبقة تانية
        rgb = a[..., :3].astype(float)
        lum = rgb.mean(-1)
        chroma = rgb.max(-1) - rgb.min(-1)
        pants = mask & (lum < 48) & (chroma < 26)
        pants = ndi.binary_opening(pants, iterations=2)
        # التيكت الأبيض والأستك جوه البنطلون مش فتحات فيه
        pants = ndi.binary_fill_holes(ndi.binary_closing(pants, iterations=4)) & mask
        lab, n = ndi.label(pants)
        if n:
            sizes = ndi.sum(pants, lab, range(1, n + 1))
            keep = np.isin(lab, 1 + np.where(sizes > pants.sum() * 0.08)[0])
            # لو القطعة كلها سودا (الطقم الأسود) مانقدرش نفصل — طبقة واحدة
            if keep.sum() < mask.sum() * 0.75:
                base = base * 0.55 + ndi.gaussian_filter(rounded(keep, 9), 1.6) * 0.45
        h = base
    else:
        # متعلّقة: بروز أكبر في النص، والحواف بتدوّر على مسافة أكبر
        r = 0.55 * np.sqrt(mask.sum() / np.pi)
        h = rounded(mask, r)
        h = ndi.gaussian_filter(h, 1.2)
        h[~mask] = 0

    h = ndi.gaussian_filter(h, 0.8)
    h[~ndi.binary_dilation(mask, iterations=1)] = 0
    out = Image.fromarray((np.clip(h, 0, 1) * 255).astype(np.uint8), 'L')
    return out


def main():
    m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    for slug, assets in m.items():
        for a in assets:
            src = ROOT / ('public' + a['src'])
            out = src.with_name(src.stem + '-depth.png')
            depth_for(src, bool(a.get('flat'))).save(out, optimize=True)
            a['depth'] = '/' + out.relative_to(ROOT / 'public').as_posix()
            print(a['depth'], out.stat().st_size // 1024, 'KB')
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
