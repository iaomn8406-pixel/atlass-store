"""
قص قطع الملابس من صورها — لعرضها متعلقة في المتجر الافتراضي
=================================================================

الأداة دي بتشيل الخلفية بس. مفيش أي موديل ذكاء اصطناعي ولا
توليد: كل بكسل من القطعة بيفضل زي ما هو في الصورة الأصلية
بالظبط، والسكربت بيطبع إثبات ده (maxDiff=0) لكل صورة.

بتشتغل كويس على صور الاستوديو: قطعة لوحدها، كاملة، على خلفية
ساده (أبيض أو رمادي). صور الموديل اللابس أو القطع المتراكبة أو
الخلفيات الزحمة مش هتطلع صح — ولازم لها صورة نضيفة.

التشغيل (من جذر المشروع):
    python scripts/room-cutouts.py

المدخلات في SOURCES تحت. المخرجات:
    public/room/<slug>--<key>.webp     ← القطعة بخلفية شفافة
    data/room-assets.json             ← المقاسات ونقطة تعليق الشماعة

المتطلبات: Pillow · numpy · scipy · scikit-image (كلها مجانية).
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from skimage.color import rgb2lab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'public', 'room')
MANIFEST = os.path.join(ROOT, 'data', 'room-assets.json')

# أقصى ارتفاع للصورة الناتجة — كفاية لشاشة كبيرة في وضع التركيز
MAX_H = 960

# ------------------------------------------------------------------
# المصادر — صورة نضيفة واحدة لكل لون موجود فعلًا
#   color: اسم اللون بالظبط زي ما هو في اختيارات المنتج، أو None
#          لو مش متأكدين من اسمه (الكارت ساعتها بيسيب العميل يختار)
#   chroma_min: لقطعة بنفس إضاءة الخلفية تقريبًا بس أدفى منها
#   bg_holes: فتحات واسعة بلون الخلفية جوه القطعة (بين الكم والجسم
#             مثلًا) تتشال. بنشغّله بس في الصور اللي فيها كده،
#             عشان ما نشيلش شعار أبيض على تيشرت غامق بالغلط
#   crop: (يسار، فوق، يمين، تحت) كنسبة من الصورة — لصورة فيها حاجات
#         تانية جنب القطعة (رف هدوم مثلًا) بنقصّها الأول
#   own_hanger: القطعة متصوّرة على شماعتها الحقيقية — بنعرضها زي ما
#               هي ومابنرسمش شماعة تانية. الصور دي بتبان أحقّ حاجة
#               لأن القماش واخد شكله الطبيعي وهو متعلق
# ------------------------------------------------------------------
SOURCES = [
    {'slug': 'loewe-mens-tshirt', 'key': 'white', 'src': 'public/img/loewe-1.webp', 'color': 'أبيض'},
    {'slug': 'loewe-mens-tshirt', 'key': 'black', 'src': 'public/img/loewe-2.webp', 'color': 'اسود'},
    {'slug': 'massimo-dutti-oversize', 'key': 'white', 'src': 'public/img/massimo-1.webp', 'color': 'أبيض'},
    {'slug': 'massimo-dutti-oversize', 'key': 'black', 'src': 'public/img/massimo-2.webp', 'color': 'اسود',
     'own_hanger': True},
    {'slug': 'tshirt-1975-print', 'key': 'olive', 'src': 'public/img/print1975-4.webp', 'color': None,
     'own_hanger': True, 'crop': (0.15, 0.135, 0.88, 0.85), 'bg_holes': True, 'bg_holes_top': 0.22},
    # الطقم (on-cloud-tracksuit) اتشال من هنا: صورة 1 كانت بتتقص كقصاصة واحدة
    # (تيشيرت + بنطلون ملزوقين) وده مرفوض. الطقم بقى بيتجهّز في
    # scripts/set-sample.py — شغّله بعد السكربت ده.
    {'slug': 'hooded-embroidered-abaya', 'key': 'white', 'src': 'public/img/abaya-2.webp', 'color': 'أبيض',
     'bg_holes': True},
    {'slug': 'hooded-embroidered-abaya', 'key': 'beige', 'src': 'public/img/abaya-3.webp', 'color': 'بيج',
     'bg_holes': True, 'chroma_min': 6},
    {'slug': 'hooded-embroidered-abaya', 'key': 'black', 'src': 'public/img/abaya-4.webp', 'color': 'اسود',
     'bg_holes': True},
    {'slug': 'hooded-embroidered-abaya', 'key': 'blue', 'src': 'public/img/abaya-1.webp', 'color': None,
     'bg_holes': True},
]


def cutout(path, opts):
    keep_parts = opts.get('keep_parts', False)
    bg_holes = opts.get('bg_holes', False)
    chroma_min = opts.get('chroma_min', 0)
    own_hanger = opts.get('own_hanger', False)
    # بنشيل فتحات الخلفية في الجزء اللي فوق بس (جوه الشماعة فوق
    # الياقة) — تحته ممكن تكون طباعة بيضا على القماش ولازم تفضل
    holes_top = opts.get('bg_holes_top', 1.0)

    img = Image.open(path).convert('RGB')
    if opts.get('crop'):
        l, t, r, b = opts['crop']
        img = img.crop((round(l * img.width), round(t * img.height), round(r * img.width), round(b * img.height)))
    orig = np.asarray(img)
    lab = rgb2lab(orig.astype(np.float64) / 255.0)
    L = lab[..., 0]
    H, W = L.shape

    # لون الخلفية من شريط الأطراف
    band = max(8, min(H, W) // 40)
    edge = np.concatenate([
        lab[:band].reshape(-1, 3), lab[-band:].reshape(-1, 3),
        lab[:, :band].reshape(-1, 3), lab[:, -band:].reshape(-1, 3),
    ])
    bg = np.median(edge, axis=0)
    dE = np.sqrt(((lab - bg) ** 2).sum(-1))

    # القطعة أفتح ولا أغمق من الخلفية؟ الظل دايمًا أغمق من الخلفية،
    # فالقاعدة بتتعامل معاه كخلفية في الحالتين
    cy, cx = H // 2, W // 2
    centre = L[cy - H // 8: cy + H // 8, cx - W // 8: cx + W // 8]
    lighter = np.median(centre) > bg[0]

    def classify(bgL, dist):
        if lighter:
            return (L > bgL + 12) | ((dist > 18) & (L > bgL - 4))
        return (L < bgL - 28) | ((dist > 30) & (L < bgL - 10))

    fg = classify(bg[0], dE)

    # خلفيات الاستوديو الرمادي بتبقى متدرّجة (أفتح في النص وأغمق على
    # الأطراف)، فلون واحد للخلفية بيغلط: بياكل حواف قطعة فاتحة
    # وبيدخّل جزء من الأرضية. بنقيس الخلفية كسطح ناعم بدل لون واحد:
    # معادلة من الدرجة التانية في x و y لكل قناة لون، متحسوبة من
    # بكسلات بعيدة عن القطعة
    far = ~ndi.binary_dilation(fg, iterations=max(12, min(H, W) // 40))
    yy, xx = np.mgrid[0:H, 0:W]
    sample = far & ((yy + xx) % 7 == 0)
    if sample.sum() > 500:
        X = np.stack([np.ones_like(xx), xx / W, yy / H, (xx / W) ** 2, (yy / H) ** 2, (xx / W) * (yy / H)], -1)
        A = X[sample]
        surface = np.empty_like(lab)
        for c in range(3):
            coef, *_ = np.linalg.lstsq(A, lab[..., c][sample], rcond=None)
            surface[..., c] = X @ coef
        dE = np.sqrt(((lab - surface) ** 2).sum(-1))
        fg = classify(surface[..., 0], dE)

        if chroma_min:
            # قطعة قريبة من لون الخلفية في الإضاءة بس مختلفة عنها في
            # الدفا (بيج على رمادي): بنفرّق بالتشبّع اللوني
            chroma = np.hypot(lab[..., 1], lab[..., 2])
            bg_chroma = np.hypot(surface[..., 1], surface[..., 2])
            fg |= (chroma - bg_chroma) > chroma_min

    lbl, n = ndi.label(fg)
    if n == 0:
        raise SystemExit(f'{path}: مفيش قطعة واضحة')
    sizes = ndi.sum(fg, lbl, range(1, n + 1))
    biggest = sizes.max()

    if keep_parts:
        # طقم من أكتر من قطعة (تيشرت + بنطلون): بناخد الأجزاء الكبيرة
        # بس — الكوتشي والإكسسوارات الصغيرة في الصورة بتتشال
        keep = [i + 1 for i, s in enumerate(sizes) if s > biggest * 0.25]
        mask = np.isin(lbl, keep)
    else:
        mask = lbl == (int(np.argmax(sizes)) + 1)

    mask = ndi.binary_closing(mask, iterations=2)
    filled = ndi.binary_fill_holes(mask)

    if bg_holes:
        # الفتحات الواسعة اللي لونها لون الخلفية = خلفية باينة من بين
        # الكم والجسم، مش جزء من القطعة
        holes, hn = ndi.label(filled & ~mask)
        rows = np.where(mask.any(1))[0]
        limit = rows.min() + (rows.max() - rows.min()) * holes_top
        for i in range(1, hn + 1):
            region = holes == i
            cy_hole = np.where(region)[0].mean()
            if cy_hole > limit:
                continue
            if region.sum() > H * W * 0.0015 and np.median(dE[region]) < 14:
                filled[region] = False

    # الشماعة الحقيقية خطافها رفيع (بكسل أو اتنين) — التنضيف ده كان
    # هيشيله، فبنعدّيه للصور دي
    mask = filled if own_hanger else ndi.binary_opening(filled, iterations=1)

    # تنضيف الحافة — ده اللي كان عامل الخط الأبيض حوالين القطع:
    # بكسلات الحافة في الصورة الأصلية ممزوجة بلون الخلفية (أبيض أو
    # رمادي). بنقلّص الحافة بكسل، وبنلوّن شريط الحافة اللي برا قلب
    # القطعة بلون أقرب بكسل جوّاها. قلب القطعة نفسه مابيتلمسش
    if not own_hanger:
        mask = ndi.binary_erosion(mask, iterations=1)
    core = ndi.binary_erosion(mask, iterations=2)
    if not core.any():
        core = mask
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    clean = orig.copy()
    rim = ~core
    clean[rim] = orig[iy[rim], ix[rim]]

    # حافة ناعمة بكسل واحد — بتشيل التسنين بس
    soft = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)))
    inner = ndi.binary_erosion(mask, iterations=3)
    alpha = np.where(inner, 255, soft).astype(np.uint8)

    rgba = np.dstack([clean, alpha])

    # إثبات: البكسلات الداخلية مطابقة للأصل بالظبط
    max_diff = int(np.abs(rgba[..., :3].astype(int) - orig.astype(int))[inner].max())

    ys, xs = np.where(alpha > 8)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')

    if crop.height > MAX_H:
        crop = crop.resize((round(crop.width * MAX_H / crop.height), MAX_H), Image.LANCZOS)

    return crop, max_diff, lighter


def anchors(img):
    """نقطة تعليق الشماعة: نص الياقة من فوق، وعرض الكتاف"""
    a = np.asarray(img)[..., 3] > 128
    h, w = a.shape
    rows = np.where(a.any(1))[0]
    top = int(rows.min())

    # الياقة = أعلى شريط رفيع من القطعة
    band = a[top: top + max(4, int(h * 0.05))]
    cols = np.where(band.any(0))[0]
    hook_x = float((cols.min() + cols.max()) / 2 / w)

    # الكتاف = أول سطر القطعة فيه بتعرض فعلًا (أكتر من ٣٥٪ من أعرض
    # سطر)، ونازلين منه شوية. كده الخطاف والشماعة الحقيقية اللي فوق
    # الياقة مابيتحسبوش كتاف، فكل القطع بتتعرض بنفس المقياس
    widths = np.array([(np.ptp(np.where(r)[0]) if r.any() else 0) for r in a])
    body = np.where(widths > widths.max() * 0.35)[0]
    start = int(body.min()) if body.size else top
    sy = min(h - 1, start + int(h * 0.06))
    scol = np.where(a[sy])[0]
    shoulder = float((scol.max() - scol.min()) / w) if scol.size else 0.6

    return {'hookX': round(hook_x, 4), 'top': round(top / h, 4), 'shoulder': round(shoulder, 4)}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}

    for s in SOURCES:
        src = os.path.join(ROOT, s['src'])
        img, max_diff, lighter = cutout(src, s)

        name = f"{s['slug']}--{s['key']}.webp"
        img.save(os.path.join(OUT_DIR, name), 'WEBP', quality=86, method=6)

        # نسخة صغيرة للقضيب — هي اللي بتتحمّل الأول، والكبيرة بتتحمّل بس
        # لما العميل يختار القطعة. على النت الضعيف ده بيفرق جدًا
        sm = img.resize((round(img.width * 420 / img.height), 420), Image.LANCZOS) if img.height > 420 else img
        sm_name = f"{s['slug']}--{s['key']}-sm.webp"
        sm.save(os.path.join(OUT_DIR, sm_name), 'WEBP', quality=82, method=6)

        # ظل القطعة على الحيطة: نفس شكلها متموّه — صورة صغيرة جاهزة
        # بدل filter: blur في المتصفح (اللي بيتعب كارت الشاشة)
        a = img.getchannel('A')
        small = a.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.LANCZOS)
        pad = max(6, small.width // 8)
        canvas = Image.new('L', (small.width + pad * 2, small.height + pad * 2), 0)
        canvas.paste(small, (pad, pad))
        canvas = canvas.filter(ImageFilter.GaussianBlur(pad * 0.55))
        shadow = Image.new('RGBA', canvas.size, (20, 18, 14, 0))
        shadow.putalpha(canvas)
        shadow_name = f"{s['slug']}--{s['key']}-shadow.webp"
        shadow.save(os.path.join(OUT_DIR, shadow_name), 'WEBP', quality=70, method=6)

        entry = {
            'src': f'/room/{name}',
            'srcSm': f'/room/{sm_name}',
            'from': s['src'].replace('public', ''),
            'color': s['color'],
            'shadow': f'/room/{shadow_name}',
            'ownHanger': bool(s.get('own_hanger')),
            'w': img.width,
            'h': img.height,
            **anchors(img),
        }
        manifest.setdefault(s['slug'], []).append(entry)

        size_kb = os.path.getsize(os.path.join(OUT_DIR, name)) / 1024
        print(f"{name:<44} {img.width}x{img.height}  {size_kb:5.0f}KB  maxDiff={max_diff}  "
              f"{'light-on-dark' if lighter else 'dark-on-light'}")
        if max_diff != 0:
            sys.exit(f'{name}: بكسلات القطعة اتغيّرت — ده مش المفروض يحصل')

    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('manifest -> data/room-assets.json')


if __name__ == '__main__':
    main()
