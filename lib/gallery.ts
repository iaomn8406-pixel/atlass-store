import assets from '@/data/room-assets.json'
import type { GalleryAsset } from '@/components/product/gallery-piece'

/* ============================================================
   القطع المتعلّقة لكروت المتجر (نفس عالم المعرض)
   ------------------------------------------------------------
   أي منتج ليه صورة مفرّغة أمينة متعلّقة (ومعاها الصورة «المضاءة»
   من scripts/gallery-lit.py) بيظهر في الكارت متعلّق على شماعة
   المعرض. غير كده (أطقم على الترابيزة / منتجات صورها مش كفاية)
   بيفضل بصورته الحقيقية.
   ============================================================ */

type Asset = {
  src: string
  srcSm: string
  shadow: string
  w: number
  h: number
  hookX: number
  flat?: unknown
  depth?: string
}


/** صورة صغيرة لكل لون عنده صورة حقيقية (للسلة وملخص الطلب): { slug: { لون: src } } */
export function getColorThumbs(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [slug, list] of Object.entries(assets as Record<string, (Asset & { color?: string | null })[]>)) {
    for (const a of list) {
      if (!a.color) continue
      ;(out[slug] ??= {})[a.color] = a.srcSm
    }
  }
  return out
}

export function getGalleryAssets(): Record<string, GalleryAsset> {
  const out: Record<string, GalleryAsset> = {}
  for (const [slug, list] of Object.entries(assets as Record<string, Asset[]>)) {
    const a = list.find((x) => !x.flat)
    if (!a) continue
    const s = Math.min(1, 420 / a.h)
    out[slug] = {
      // صورة القطعة الأصلية من غير إضاءة مضافة (الإضاءة المضافة كانت بتطلّعها شبه البلاستيك)
      src: a.srcSm,
      shadow: a.shadow,
      w: Math.round(a.w * s),
      h: Math.round(a.h * s),
      hookX: a.hookX,
    }
  }
  return out
}
