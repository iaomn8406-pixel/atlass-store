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

export function getGalleryAssets(): Record<string, GalleryAsset> {
  const out: Record<string, GalleryAsset> = {}
  for (const [slug, list] of Object.entries(assets as Record<string, Asset[]>)) {
    const a = list.find((x) => !x.flat && x.depth)
    if (!a) continue
    const s = Math.min(1, 420 / a.h)
    out[slug] = {
      src: a.srcSm.replace('-sm.webp', '-lit.webp'),
      shadow: a.shadow,
      w: Math.round(a.w * s),
      h: Math.round(a.h * s),
      hookX: a.hookX,
    }
  }
  return out
}
