'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

/* ============================================================
   القطعة المتعلّقة في كروت المتجر (نفس عالم المعرض)
   ------------------------------------------------------------
   • الصورة «مضاءة» من خريطة عمقها (scripts/gallery-lit.py): الجناب
     بتغمق والبارز بينوّر — حجم حقيقي مش ورقة. الألوان والطباعة زي الأصل.
   • نفس الشماعة الخشب في كل الكروت، وظلها على الحيطة بيتحرك معاها.
   • لمس/ماوس: أرجحة خفيفة بتهدى + ميل بسيط (٣–٦°) مع الماوس.
   • CSS بس (transform/opacity) — مفيش WebGL لكل كارت. تقليل الحركة
     بيوقف الأرجحة والميل خالص.
   ============================================================ */

export type GalleryAsset = {
  /** الصورة المضاءة */
  src: string
  shadow: string
  w: number
  h: number
  hookX: number
}

const GalleryContext = createContext<Record<string, GalleryAsset>>({})
const ThumbContext = createContext<Record<string, Record<string, string>>>({})

export function GalleryProvider({
  assets,
  thumbs = {},
  children,
}: {
  assets: Record<string, GalleryAsset>
  /** صورة لكل لون (للسلة) — { slug: { لون: src } } */
  thumbs?: Record<string, Record<string, string>>
  children: React.ReactNode
}) {
  return (
    <GalleryContext.Provider value={assets}>
      <ThumbContext.Provider value={thumbs}>{children}</ThumbContext.Provider>
    </GalleryContext.Provider>
  )
}

export function useGalleryAsset(slug: string) {
  return useContext(GalleryContext)[slug]
}

/**
 * المنتج بصورة اللون المختار أول صورة — عشان مصغّرة السلة وملخص الطلب
 * تبان بنفس اللون اللي العميل اختاره (لو اللون ده ليه صورة حقيقية).
 * عرض بس: سيرفر الطلب بيحسب بياناته من المنتج نفسه.
 */
export function useColorImage() {
  const thumbs = useContext(ThumbContext)
  return useCallback(
    <P extends { slug: string; images: string[] }>(product: P, variants: Record<string, string>): P => {
      const color = variants['اللون']
      const src = color ? thumbs[product.slug]?.[color] : undefined
      return src ? { ...product, images: [src, ...product.images] } : product
    },
    [thumbs]
  )
}

export function GalleryPiece({ asset, alt, index = 0 }: { asset: GalleryAsset; alt: string; index?: number }) {
  const rig = useRef<HTMLDivElement>(null)
  const [swing, setSwing] = useState(0)
  const last = useRef(0)

  /* أرجحة جديدة — مش أكتر من مرة كل ٧٠٠ms عشان ماتبقاش رعشة */
  const nudge = () => {
    const now = performance.now()
    if (now - last.current < 700) return
    last.current = now
    setSwing((n) => n + 1)
  }

  const tilt = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !rig.current) return
    const r = rig.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    rig.current.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`)
    rig.current.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`)
  }
  const rest = () => {
    rig.current?.style.setProperty('--ry', '0deg')
    rig.current?.style.setProperty('--rx', '0deg')
  }

  const tall = asset.h / asset.w > 1.7

  return (
    <div
      className="gp"
      data-tall={tall}
      onPointerEnter={nudge}
      onPointerDown={nudge}
      onPointerMove={tilt}
      onPointerLeave={rest}
      style={{ '--i': index } as React.CSSProperties}
    >
      <div ref={rig} className="gp-rig">
        {/* key بيتغيّر مع كل لمسة → الأرجحة تبدأ من الأول */}
        <div key={swing} className="gp-swing" data-swing={swing > 0}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="gp-shadow" src={asset.shadow} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <Hanger x={asset.hookX} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="gp-piece"
            src={asset.src}
            alt={alt}
            width={asset.w}
            height={asset.h}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}

/** نفس الشماعة الخشب بتاعة المعرض (خشب + خطاف معدن) */
function Hanger({ x }: { x: number }) {
  return (
    <svg className="gp-hanger" viewBox="0 0 200 74" aria-hidden="true" style={{ left: `${x * 100}%` }}>
      <defs>
        <linearGradient id="gp-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9a86c" />
          <stop offset="0.55" stopColor="#b9814a" />
          <stop offset="1" stopColor="#8f5f31" />
        </linearGradient>
        <linearGradient id="gp-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7c828b" />
          <stop offset="0.5" stopColor="#c9cdd2" />
          <stop offset="1" stopColor="#7c828b" />
        </linearGradient>
      </defs>
      <path d="M100 40 V22 C100 10 92 3 83 3 C74 3 68 9 68 16" stroke="url(#gp-metal)" strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <path
        d="M8 66 C40 52 72 40 100 38 C128 40 160 52 192 66 C193 70 190 73 186 72 C156 62 128 52 100 51 C72 52 44 62 14 72 C10 73 7 70 8 66 Z"
        fill="url(#gp-wood)"
      />
    </svg>
  )
}
