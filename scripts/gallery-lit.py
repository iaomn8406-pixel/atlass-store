"""
صور «مضاءة» للقطع المتعلّقة في صفحات المتجر (عينة)
====================================================

في الصفحات مفيش WebGL لكل كارت (تقيل). عشان القطعة تبان مجسّمة مش
ورقة، بنحسب الإضاءة مرة واحدة هنا من خريطة العمق بتاعتها (نفس اللي
المشهد بيستخدمها): الأسطح البارزة اللي وشها للضوء تنوّر شوية، والجناب
والحواف اللي بتلف لورا تغمق — زي ما الضوء بيقع على قماش حقيقي.

اللون نفسه مابيتغيّرش: الوش اللي قدامك مضروب في ~١٫٠، والفرق بس في
الظل الطبيعي على الحجم (٠٫٨٢ عند الحافة لـ ~١٫٠٨ عند أعلى نقطة).

الاستخدام: python scripts/gallery-lit.py <src> [<src> ...]
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
LIGHT = np.array([-0.38, -0.55, 0.74])  # من فوق شمال وقدّام
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def lit(src):
    m = json.loads((ROOT / 'data/room-assets.json').read_text(encoding='utf-8'))
    asset = next(a for v in m.values() for a in v if a['src'] == src)
    im = Image.open(ROOT / ('public' + asset['srcSm'])).convert('RGBA')
    d = Image.open(ROOT / ('public' + asset['depth'])).convert('L').resize(im.size, Image.BICUBIC)
    h = ndi.gaussian_filter(np.asarray(d).astype(float) / 255, 1.5)
    # الحجم: ارتفاع القطعة في النص ~ ١٢٪ من عرضها
    scale = 0.12 * im.width
    gy, gx = np.gradient(h * scale)
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lam = np.clip(n @ LIGHT, 0, 1)
    # خفيف: الوش اللي قدامك ≈ لونه بالظبط، والجناب بتغمق شوية بس — مش «مجسّم» غريب
    shade = 0.9 + 0.13 * lam  # وش مواجه للكاميرا ≈ ١٫٠
    a = np.asarray(im).astype(float)
    # لمعة قماش خفيفة على اللي مواجه للضوء — هي اللي بتبيّن حجم القماش الغامق
    t = np.clip((lam - 0.78) / 0.22, 0, 1)
    sheen = 12 * t * t * (3 - 2 * t)
    a[..., :3] = np.clip(a[..., :3] * shade[..., None] + sheen[..., None], 0, 255)
    out = ROOT / ('public' + asset['srcSm'].replace('-sm.webp', '-lit.webp'))
    Image.fromarray(a.astype(np.uint8), 'RGBA').save(out, 'WEBP', quality=88, method=6, exact=True)
    print(out.relative_to(ROOT).as_posix(), im.size)


if __name__ == '__main__':
    srcs = sys.argv[1:]
    if not srcs:
        # كل القطع المتعلّقة (الأطقم على الترابيزة ليها عرض تاني)
        m = json.loads((ROOT / 'data/room-assets.json').read_text(encoding='utf-8'))
        srcs = [a['src'] for v in m.values() for a in v if not a.get('flat') and a.get('depth')]
    for s in srcs:
        lit(s)
