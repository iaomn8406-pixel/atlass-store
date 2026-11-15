"""
عينة الطقم (On Cloud كحلي) — تيشيرت على شماعة + بنطلون متطبّق على رف
=====================================================================

ليه الصورة دي بالذات (public/img/oncloud-2.webp):
  • صورة 1 (فلات لاي): البنطلون مغطّي ربع التيشيرت التحتاني والكوتشي
    مغطّي جزء من البنطلون — فصلهم هناك محتاج اختراع أجزاء مستخبية.
  • صورة 2: التيشيرت كامل ومش متغطّي، والبنطلون متطبّق (من الوسط لحد
    طبقة الركبة) — يعني نقدر نعرض الاتنين بحالتهم الحقيقية من غير ما
    نخترع حاجة: التيشيرت على شماعة، والبنطلون متطبّق على رف.

المشكلة إن الصورة متصوّرة بزاوية من فوق. بنعدّلها بتحويل منظور
(homography) — بكسلات حقيقية بتتنقل لمكانها على سطح الترابيزة،
من غير أي توليد أو رسم.

إزاي بنحسب المنظور من الصورة نفسها (مش بالعين):
  1. نقطة تلاشي العرض V1 = تقاطع حرف الترابيزة الخلفي والأمامي
     (متوازيين في الحقيقة).
  2. نقطة تلاشي العمق V2 = تقاطع الحرف الشمال للترابيزة مع محور
     تماثل التيشيرت (الاتنين عموديين على الحرف الخلفي).
  3. لكاميرا عادية مركزها في نص الصورة: (V1-c)·(V2-c) = -f²
     → البعد البؤري f، ومنه اتجاه سطح الترابيزة بالكامل.
  4. كل بكسل بيتحوّل لإحداثيات حقيقية على السطح (نفس الوحدة في
     الاتجاهين) — فالنِسب بتطلع صح لوحدها.

نقاط الحروف متقاسة على الصورة 500×500 (شبكة مكبّرة في scratchpad).
الناتج بيتحفظ في public/room/sample/ — الصور الأصلية ماتلمستش.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'public/img/oncloud-2.webp'
OUT = ROOT / 'public/room/sample'
EVIDENCE = ROOT / 'docs/redesign'


def line(p, q):
    """خط متجانس بين نقطتين"""
    return np.cross([*p, 1.0], [*q, 1.0])


def meet(l1, l2):
    v = np.cross(l1, l2)
    return v[:2] / v[2]


# ---------------- القياسات (بكسل في الصورة الأصلية) ----------------
BACK = ((25, 40), (500, 137))      # حرف الترابيزة الخلفي
FRONT = ((0, 345), (500, 480))     # حرف الترابيزة الأمامي
LEFT = ((20, 40), (0, 70))         # حرف الترابيزة الشمال (رايح ناحية الكاميرا)
# أزواج متماثلة في التيشيرت: زاويتين الديل، وطرفين الكم من فوق
HEM = ((10, 327), (220, 385))
SLEEVE = ((57, 125), (350, 192))


def solve_camera(size, cy=None):
    c = np.array([size[0] / 2, size[1] / 2 if cy is None else cy])
    v1 = meet(line(*BACK), line(*FRONT))
    mid_hem = np.mean(HEM, axis=0)
    mid_sleeve = np.mean(SLEEVE, axis=0)
    v2 = meet(line(*LEFT), line(mid_hem, mid_sleeve))
    f2 = -np.dot(v1 - c, v2 - c)
    if f2 <= 0:
        raise SystemExit('نقط التلاشي مش متعامدة — القياسات غلط')
    f = float(np.sqrt(f2))
    d1 = np.array([*(v1 - c), f]); d1 /= np.linalg.norm(d1)
    d2 = np.array([*(v2 - c), f]); d2 /= np.linalg.norm(d2)
    # تعامد الاتجاهين بعد الحساب — مقياس لجودة القياس
    ortho = float(np.degrees(np.arccos(abs(np.dot(d1, d2)))))
    n = np.cross(d1, d2); n /= np.linalg.norm(n)
    if n[2] < 0:  # السطح لازم يبقى قدّام الكاميرا (n·r > 0 لشعاع النص)
        n = -n
    e1 = d1
    e2 = np.cross(n, d1)  # عمودي على e1 جوه السطح
    # لو الاتجاهين معكوسين عن اتجاه الصورة (مراية) نقلب e1 — لف بس، مش مراية
    def uv(p):
        r = np.array([p[0] - c[0], p[1] - c[1], f]); X = r / np.dot(n, r)
        return np.array([np.dot(X, e1), np.dot(X, e2)])
    J = np.column_stack([uv(c + [1, 0]) - uv(c), uv(c + [0, 1]) - uv(c)])
    if np.linalg.det(J) < 0:
        e1 = -e1
    return c, f, e1, e2, n, ortho, v1, v2


def rectify(img, c, f, e1, e2, n, scale, squash=1.0):
    """كل بكسل في الناتج = نقطة على السطح (n·X = 1) → بنرجّعها للصورة"""
    h, w = img.shape[:2]
    # حدود الصورة على السطح
    corners = np.array([[0, 0], [w, 0], [w, h], [0, h]], float)
    pts = []
    for p in corners:
        r = np.array([p[0] - c[0], p[1] - c[1], f])
        X = r / np.dot(n, r)
        pts.append([np.dot(X, e1), np.dot(X, e2)])
    pts = np.array(pts)
    u0, v0 = pts.min(0)
    u1, v1 = pts.max(0)
    W = int((u1 - u0) * scale)
    H = int((v1 - v0) * scale * squash)
    uu, vv = np.meshgrid(np.arange(W) / scale + u0, np.arange(H) / (scale * squash) + v0)
    # نقطة على السطح: X = u e1 + v e2 + t n  بحيث n·X = 1 → t = 1
    X = uu[..., None] * e1 + vv[..., None] * e2 + n
    px = c[0] + f * X[..., 0] / X[..., 2]
    py = c[1] + f * X[..., 1] / X[..., 2]
    out = np.zeros((H, W, img.shape[2]), np.float32)
    for k in range(img.shape[2]):
        out[..., k] = ndi.map_coordinates(img[..., k].astype(np.float32), [py, px],
                                          order=3, mode='constant', cval=0)
    valid = (px >= 0) & (px <= w - 1) & (py >= 0) & (py <= h - 1)
    return np.clip(out, 0, 255).astype(np.uint8), valid


def garment_masks(rgb, valid=None):
    """الترابيزة بيج فاتح؛ التيشيرت كحلي (فيه أزرق)، البنطلون أسود"""
    a = rgb.astype(np.float32)
    lum = a.mean(-1)
    blue = a[..., 2] - (a[..., 0] + a[..., 1]) / 2
    dark = lum < 150
    navy = dark & (blue > 18)
    chroma = a.max(-1) - a.min(-1)
    black = (lum < 70) & (chroma < 22) & ~navy
    if valid is not None:  # برّه حدود الصورة الأصلية أسود — مش بنطلون
        inside = ndi.binary_erosion(valid, iterations=3)
        navy &= inside
        black &= inside
    out = {}
    for name, m in (('tee', navy), ('pants', black)):
        m = ndi.binary_closing(m, iterations=2)
        m = ndi.binary_fill_holes(m)
        lab, k = ndi.label(m)
        if not k:
            raise SystemExit(f'مالقيتش {name}')
        sizes = ndi.sum(m, lab, range(1, k + 1))
        out[name] = lab == (1 + int(np.argmax(sizes)))
    return out


def cutout(rgb, mask, valid, other=None):
    """
    قص بحافة ناعمة حقيقية (مش حافة مقطوعة):
    الشفافية عند الحافة = قد إيه البكسل أغمق من الترابيزة اللي حواليه،
    مقارنةً بلون القطعة نفسها. كده خيوط الحافة والكم والياقة بتفضل
    زي ما هي، والانتقال للخلفية بيبقى ناعم زي الصورة الأصلية.
    لون الحافة بيتنضّف من البيج (بياخد لون القطعة الأقرب).
    """
    mask = mask & valid
    lum = rgb.astype(np.float32).mean(-1)
    core = ndi.binary_erosion(mask, iterations=3)
    ring = ndi.binary_dilation(mask, iterations=9) & ~ndi.binary_dilation(mask, iterations=4) & valid
    if other is not None:
        ring &= ~ndi.binary_dilation(other, iterations=3)
    l_bg = float(np.median(lum[ring]))
    l_fg = float(np.median(lum[core]))
    region = ndi.binary_dilation(mask, iterations=3) & valid
    if other is not None:
        region &= ~ndi.binary_dilation(other, iterations=1)
    a = np.clip((l_bg - lum) / max(1.0, l_bg - l_fg), 0, 1)
    # ظل الترابيزة الخفيف حوالين القطعة مش جزء منها
    a = np.clip((a - 0.22) / (0.8 - 0.22), 0, 1)
    a = a * a * (3 - 2 * a)
    a[~region] = 0
    a[core] = 1
    alpha = (a * 255).astype(np.uint8)

    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    clean = rgb.copy()
    rim = ~core
    clean[rim] = rgb[iy[rim], ix[rim]]
    rgba = np.dstack([clean, alpha])
    ys, xs = np.nonzero(alpha > 8)
    pad = 4
    y0, y1 = max(0, ys.min() - pad), ys.max() + pad + 1
    x0, x1 = max(0, xs.min() - pad), xs.max() + pad + 1
    return rgba[y0:y1, x0:x1], (rgb[y0:y1, x0:x1], core[y0:y1, x0:x1])


# نسبة طول التيشيرت لعرض جسمه — متقاسة من صورة 1 (متصوّرة من فوق مباشرة،
# نفس التيشيرت): الطول 263px من الياقة للديل، والعرض تحت الكم 184px
TRUE_RATIO = 263 / 184


def upright(mask):
    """بنلف التيشيرت لحد ما محوره يبقى رأسي والياقة فوق — لف بس"""
    ys, xs = np.nonzero(mask)
    evals, evecs = np.linalg.eigh(np.cov(np.vstack([xs, ys])))
    axis = evecs[:, np.argmax(evals)]
    tilt = float(np.degrees(np.arctan2(axis[0], axis[1])))
    im = Image.fromarray((mask * 255).astype(np.uint8)).rotate(-tilt, expand=True)
    m = np.asarray(im) > 127
    ys, _ = np.nonzero(m)
    h = ys.max() - ys.min()
    top = m[ys.min(): ys.min() + int(h * 0.3)].sum()
    bottom = m[ys.max() - int(h * 0.3): ys.max()].sum()
    if bottom > top:  # الأكمام (الجزء العريض) لازم تبقى فوق
        tilt += 180
    return tilt


def body_ratio(mask, tilt):
    m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).rotate(-tilt, expand=True)) > 127
    ys, _ = np.nonzero(m)
    y0, y1 = ys.min(), ys.max()
    h = y1 - y0
    widths = [np.ptp(np.nonzero(m[y])[0]) for y in range(int(y0 + h * 0.46), int(y0 + h * 0.57))
              if m[y].any()]
    return h / float(np.median(widths))


def build(src, squash, fine=True):
    c, f, e1, e2, n, ortho, v1, v2 = solve_camera((src.shape[1], src.shape[0]))

    def on_plane(p):
        r = np.array([p[0] - c[0], p[1] - c[1], f])
        return r / np.dot(n, r)

    unit = np.linalg.norm(on_plane(c + [1, 0]) - on_plane(c))
    flat, valid = rectify(src, c, f, e1, e2, n, scale=(2.0 if fine else 0.5) / unit, squash=squash)
    masks = garment_masks(flat, valid)
    tilt = upright(masks['tee'])
    return flat, valid, masks, tilt, body_ratio(masks['tee'], tilt), (f, v1, v2, ortho)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    src = np.asarray(Image.open(SRC).convert('RGB'))

    # التعديل بالمنظور لوحده بيطوّل التيشيرت ~22% في اتجاه عمق الترابيزة
    # (تقدير البعد البؤري من صورة مقصوصة مش دقيق). بنصلّحه بمقياس واحد في
    # اتجاه العمق، متظبّط على النسبة الحقيقية لنفس التيشيرت في صورة 1،
    # وبيتطبّق على السطح كله — يعني البنطلون بياخد نفس التصحيح
    lo, hi = 0.6, 1.1
    for _ in range(14):
        mid = (lo + hi) / 2
        ratio = build(src, mid, fine=False)[4]
        if ratio > TRUE_RATIO:
            hi = mid
        else:
            lo = mid
    squash = (lo + hi) / 2
    flat, valid, masks, tilt, ratio, (f, v1, v2, ortho) = build(src, squash)
    print(f'f = {f:.0f}px  زاوية الترابيزة = {ortho:.1f}°  تصحيح العمق = {squash:.3f}')
    print(f'نسبة التيشيرت: {ratio:.3f}  (الحقيقية من صورة 1: {TRUE_RATIO:.3f})')

    # صورة السطح المعدّل كاملة — دليل للمراجعة بس، مش بتتنشر
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    Image.fromarray(flat).save(EVIDENCE / 'sample-oncloud-2-rectified.png')

    images = {}
    for name in ('tee', 'pants'):
        rgba, (rgb_crop, m_crop) = cutout(flat, masks[name], valid,
                                          other=masks['pants' if name == 'tee' else 'tee'])
        im = Image.fromarray(rgba, 'RGBA')
        # الاتنين بيرجعوا لاتجاههم في الصورة الأصلية (الياقة/الوسط لفوق) —
        # لف بس بنفس الزاوية، من غير مط ولا قص
        im = im.rotate(-tilt, resample=Image.BICUBIC, expand=True)
        im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
        im.save(OUT / f'oncloud-navy-{name}.webp', 'WEBP', quality=92, method=6)
        images[name] = im
        inner = m_crop
        diff = np.abs(rgba[..., :3].astype(int) - rgb_crop.astype(int))[inner].max()
        print(f'{name}: {im.size}  أقصى فرق لون جوه القطعة عن الصورة المعدّلة = {diff}')
        if diff != 0:
            raise SystemExit(f'{name}: بكسلات القطعة اتغيّرت — ده مش المفروض يحصل')

    write_manifest(images['tee'], images['pants'], squash)


def shadow_of(img, out):
    """نفس طريقة room-cutouts.py: الشكل نفسه متصغّر ×3 ومتموّه"""
    a = img.getchannel('A')
    small = a.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.LANCZOS)
    pad = max(6, small.width // 8)
    canvas = Image.new('L', (small.width + pad * 2, small.height + pad * 2), 0)
    canvas.paste(small, (pad, pad))
    canvas = canvas.filter(__import__('PIL.ImageFilter', fromlist=['GaussianBlur']).GaussianBlur(pad * 0.55))
    sh = Image.new('RGBA', canvas.size, (20, 18, 14, 0))
    sh.putalpha(canvas)
    sh.save(out, 'WEBP', quality=70, method=6)


def waistband(img):
    """مكان مشابك الشماعة: أول سطر الوسط فيه بيعرض فعلًا (أكتر من ٤٠٪ من أعرض سطر)"""
    a = np.asarray(img)[..., 3] > 128
    widths = np.array([(np.ptp(np.where(r)[0]) if r.any() else 0) for r in a])
    y = int(np.where(widths > widths.max() * 0.4)[0].min())
    cols = np.where(a[y])[0]
    w, h = img.size
    return {'clipY': round(y / h, 4), 'clipX0': round(cols.min() / w, 4), 'clipX1': round(cols.max() / w, 4)}


def write_manifest(tee, pants, squash):
    """بيضيف الطقم لـ data/room-assets.json (لازم يتشغّل بعد room-cutouts.py)"""
    import importlib.util
    spec = importlib.util.spec_from_file_location('rc', ROOT / 'scripts/room-cutouts.py')
    rc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rc)

    shadow_of(tee, OUT / 'oncloud-navy-tee-shadow.webp')
    manifest_path = ROOT / 'data/room-assets.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['on-cloud-tracksuit'] = [{
        'src': '/room/sample/oncloud-navy-tee.webp',
        'srcSm': '/room/sample/oncloud-navy-tee.webp',
        'from': '/img/oncloud-2.webp',
        'color': 'كحلي',
        'shadow': '/room/sample/oncloud-navy-tee-shadow.webp',
        'ownHanger': False,
        'w': tee.width,
        'h': tee.height,
        **rc.anchors(tee),
        # البنطلون متطبّق زي ما اتصوّر — متعلّق من وسطه على شماعة مشابك جنب التيشيرت
        'fold': {'src': '/room/sample/oncloud-navy-pants.webp', 'w': pants.width, 'h': pants.height,
                 **waistband(pants)},
        # عينة مستنية موافقة صاحب المشروع قبل تعميم الطريقة
        'sample': True,
        'note': f'تعديل منظور + تصحيح عمق {squash:.3f} متظبّط على نسبة نفس التيشيرت في /img/oncloud-1.webp',
    }]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('manifest ← on-cloud-tracksuit (عينة)')


if __name__ == '__main__':
    main()
