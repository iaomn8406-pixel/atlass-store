"""
تنضيف البكسلات الشفافة حوالين كل قطعة (edge bleed)
====================================================

المشكلة: البكسلات الشفافة حوالين القطعة لونها جوه الملف أبيض (أو أي
لون). كارت الشاشة لما بيصغّر الصورة (القطعة بعيدة أو متشافة بزاوية)
بيخلط البكسلات دي مع حافة القماش → إطار أبيض حوالين القطعة.

الحل: كل بكسل شفاف ياخد لون أقرب بكسل مصمت من القطعة نفسها. الشفافية
زي ما هي بالظبط، فالجزء الظاهر من القطعة مابيتغيّرش خالص — بس الحافة
بتفضل بلون القماش مهما الصورة اتصغّرت. بنحفظ بـ exact=True عشان
WebP مايرميش ألوان البكسلات الشفافة.

شغّله بعد أي سكربت قص (room-cutouts / set-cutouts).
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]


def bleed(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).copy()
    alpha = a[..., 3]
    solid = alpha >= 200
    if solid.all() or not solid.any():
        return 0
    _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
    soft = ~solid
    a[..., :3][soft] = a[..., :3][iy[soft], ix[soft]]
    # إثبات: البكسلات المصمتة (الظاهرة) زي ما هي
    before = np.asarray(im)
    assert (before[solid] == a[solid]).all()
    Image.fromarray(a, 'RGBA').save(path, 'WEBP', quality=90, method=6, exact=True)
    return int(soft.sum())


def main():
    # بيشتغل على الملفات اللي تتبعتله بس (أو الكل لو مفيش) — كل حفظ WebP بيخسر جودة شوية
    import sys
    if len(sys.argv) > 1:
        files = [Path(a).resolve() for a in sys.argv[1:]]
    else:
        files = [p for p in (ROOT / 'public/room').rglob('*.webp') if not p.stem.endswith('-shadow')]
    for p in sorted(files):
        n = bleed(p)
        print(f'{p.relative_to(ROOT).as_posix():<60} {n:>8} px')


if __name__ == '__main__':
    main()
