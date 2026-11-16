"""
توليد تيشيرت الطقم كامل (مفرود من قدّام) من صورة الطقم الحقيقية — Gemini
===========================================================================

الصورة الحقيقية فيها البنطلون فوق ثلث التيشيرت. بنبعتها لـ Gemini (موافقة
صاحب المشروع، موديل الحصة المجانية gemini-2.5-flash-image) وبنطلب التيشيرت
لوحده مفرود — بنفس اللون والشعار ومكانه والياقة. الناتج بيتحفظ في فولدر
المراجعة (الأصول مابتتلمسش)، وبيتقارن بالأصل قبل أي استخدام.

الاستخدام:  python scripts/gen-set-tee.py white black
المفتاح من متغير البيئة GEMINI_API_KEY (مش في الكود ولا الشات).
"""

import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

SRC = Path(r'E:/شغل/اطلس/ترينج  NE29 on cloud (مخزن Z13)')
OUT = Path(r'E:/شغل/اطلس/مولّد-للمراجعة')
MODEL = 'gemini-2.5-flash-image'  # الحصة المجانية — مفيش موديل مدفوع

FILES = {
    'white': '9KfPCo3QgaeymP2BXSSVU0QtqMbcn1lAptXrfTLY.jpg',
    'black': 'vKLS1Fp5wJJCQ8bY29oVjtcfuYlgGgmBV55C79Bn.jpg',
    'navy': 'NZFblgLkNHLeB9NwGcAfsVyReEub1CQlJcZehGJ8.jpg',
    'olive': 'JnIx8LPdiIdFeoqVJqetyrkDJszW9qk2TgFtfsCW.jpg',
    'red': 'GKGDKsReCTp7oyLlospfeyRIoMWSALsGvWPwzG0W.jpg',
    'yellow': '0w8mcBkSWFifsJVqZnVHAbHILT1kqEZOMHcauGkG.jpg',
}

PROMPT = (
    'This is a real product photo of a tracksuit set: a short-sleeve t-shirt with black jogger pants '
    'lying on top of part of it. Using the t-shirt in this photo as the exact reference, produce a clean '
    'e-commerce product photo of ONLY that same t-shirt: laid perfectly flat, front side up, seen straight '
    'from above, complete and symmetrical with both sleeves, the full hem and the full collar visible. '
    'Remove the jogger pants and the hang tag completely. Keep EXACTLY the same fabric color and fabric '
    'texture, the same small "On" logo with the same size and the same position on the chest (wearer\'s left), '
    'the same collar rib and the same neck label. Do not add any other logo, text, print, stitching or detail. '
    'Background: plain seamless light grey (#d4d4d4), soft even studio light, no props, no hands, no shadow. '
    'The t-shirt fills about 85% of the frame.'
)


def generate(key, color):
    data = base64.b64encode((SRC / FILES[color]).read_bytes()).decode()
    body = {
        'contents': [{'parts': [
            {'inline_data': {'mime_type': 'image/jpeg', 'data': data}},
            {'text': PROMPT},
        ]}],
        'generationConfig': {'responseModalities': ['IMAGE', 'TEXT']},
    }
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    res = json.load(urllib.request.urlopen(req, timeout=180))
    for cand in res.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            inline = part.get('inlineData') or part.get('inline_data')
            if inline:
                out = OUT / f'oncloud-{color}-tee-gen.png'
                out.write_bytes(base64.b64decode(inline['data']))
                return out
    raise SystemExit(f'{color}: مفيش صورة في الرد — {json.dumps(res)[:300]}')


def main():
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        raise SystemExit('GEMINI_API_KEY مش متظبط')
    OUT.mkdir(parents=True, exist_ok=True)
    for c in sys.argv[1:]:
        print(c, '→', generate(key, c))


if __name__ == '__main__':
    main()
