'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertIcon,
  ArrowLeftIcon,
  BagIcon,
  CheckIcon,
  CloseIcon,
  SpinnerIcon,
} from '@/components/ui/icons'
import { useCart } from '@/lib/cart'
import { colorOf } from '@/lib/colors'
import { formatPrice } from '@/lib/format'
import { trackAddToCart } from '@/lib/meta/client'
import type { RoomPiece, RoomProduct } from '@/lib/room'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { QuickCheckout, type GovOption } from './quick-checkout'
import type { Product } from '@/lib/types'

/* ============================================================
   كارت المنتج في المتجر الافتراضي
   ------------------------------------------------------------
   نفس السلة ونفس التتبّع اللي في صفحة المنتج بالظبط — مفيش سلة
   جديدة. الزرار مابيخضرّش غير لما نتأكد إن عدد السلة زاد فعلًا،
   وأثناء الإضافة بيتقفل عشان الضغطتين ورا بعض ما يضيفوش مرتين.

   المقاس اللي مش متوفر في اللون المختار (حسب فيندور) بيتقفل.
   ============================================================ */

const COLOR = 'اللون'
const SIZE = 'المقاس'

/* «أسود» و«اسود» نفس اللون — الهمزات بتختلف بين فيندور ومتجرنا */
const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim()

type Phase = 'idle' | 'busy' | 'done'

export function StoreCard({
  product,
  piece,
  mobile,
  onClose,
  onPickColor,
  pieceRect,
  preview,
  governorates,
  resume,
}: {
  product: RoomProduct
  piece: RoomPiece
  mobile: boolean
  onClose: () => void
  onPickColor: (color: string) => void
  /** مكان القطعة على الشاشة دلوقتي — من المشهد (للطيران للسلة) */
  pieceRect: () => { x: number; y: number; w: number; h: number } | null
  /** اللون المختار مالوش صورة — القطعة معروضة بمعاينة للون */
  preview?: string | null
  /** المحافظات (للطلب من البطاقة) */
  governorates: GovOption[]
  /** رجع من تسجيل الدخول: نفس الاختيارات ويفتح الطلب على طول */
  resume?: Record<string, string> | null
}) {
  const router = useRouter()
  const { addItem, openCart, count } = useCart()

  const groups = product.variants ?? []
  const colorGroup = groups.find((g) => g.name === COLOR)
  const sizeGroup = groups.find((g) => g.name === SIZE)
  const others = groups.filter((g) => g !== colorGroup && g !== sizeGroup)

  const [picked, setPicked] = useState<Record<string, string>>(() => {
    if (resume) return { ...resume }
    const start: Record<string, string> = {}
    if (piece.color && colorGroup?.options.includes(piece.color)) start[COLOR] = piece.color
    return start
  })
  const [phase, setPhase] = useState<Phase>('idle')
  /* options → leaving (أنيميشن خروج) → checkout */
  const [stage, setStage] = useState<'options' | 'leaving' | 'checkout'>('options')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const soldOut = product.inStock === false
  const color = picked[COLOR]

  /* المقاسات المتاحة للون المختار — لو فيندور بعتت الخريطة */
  const allowed = useMemo(() => {
    if (!product.available || !color) return null
    const key = Object.keys(product.available).find((k) => norm(k) === norm(color))
    return key ? new Set(product.available[key]) : null
  }, [product.available, color])

  const choose = (group: string, value: string) => {
    setPicked((prev) => {
      const next = { ...prev, [group]: value }
      /* تغيير اللون بيلغي مقاس مش متوفر فيه */
      if (group === COLOR && product.available && next[SIZE]) {
        const key = Object.keys(product.available).find((k) => norm(k) === norm(value))
        if (key && !product.available[key].includes(next[SIZE])) delete next[SIZE]
      }
      return next
    })
    setError('')
    setPhase('idle')
    if (group === COLOR) onPickColor(value)
  }

  /* ---------------- الإضافة للسلة ---------------- */
  const before = useRef(0)

  const ready = () => {
    const missing = groups.find((g) => !picked[g.name])
    if (missing) {
      setError(`اختار ${missing.name} الأول`)
      return false
    }
    if (allowed && picked[SIZE] && !allowed.has(picked[SIZE])) {
      setError('المقاس ده مش متوفر في اللون ده')
      return false
    }
    return true
  }

  /* اطلب الآن: لازم يكون مسجّل (زي صفحة الدفع). لو مش مسجّل بنحفظ
     اختياره ونوديه يسجّل، ويرجع يلاقي الطلب مفتوح بنفس القطعة */
  const buyNow = async () => {
    if (soldOut || checking || !ready()) return
    setChecking(true)
    try {
      if (isSupabaseConfigured) {
        const {
          data: { user },
        } = await createClient().auth.getUser()
        if (!user) {
          sessionStorage.setItem('atlas_quick_resume', JSON.stringify({ pieceId: piece.id, picked }))
          router.push('/login?next=/')
          return
        }
      }
      setStage('leaving')
      window.setTimeout(() => setStage('checkout'), 260)
    } finally {
      setChecking(false)
    }
  }

  /* رجع من تسجيل الدخول → الطلب يفتح على طول */
  useEffect(() => {
    if (resume) void buyNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = () => {
    if (phase === 'busy' || soldOut) return
    if (!ready()) return

    before.current = count
    setPhase('busy')
    setError('')

    const full: Product = { ...product, description: '' }
    trackAddToCart(full, 1, picked)
    addItem(full, picked, 1, false)
  }

  /* الأخضر بيظهر بس بعد ما عدد السلة يزيد فعلًا */
  useEffect(() => {
    if (phase !== 'busy') return

    if (count > before.current) {
      // الطيران بيبدأ بعد ما السلة اتأكدت — مش قبلها
      flyToCart(pieceRect(), piece.srcSm)
      setPhase('done')
      return
    }

    const t = window.setTimeout(() => {
      setPhase('idle')
      setError('ما قدرناش نضيفها للسلة — جرّب تاني')
    }, 1500)
    return () => window.clearTimeout(t)
  }, [count, phase, piece.srcSm, pieceRect])

  const colorLine = color ?? (colorGroup ? 'اختار اللون' : null)

  return (
    <aside
      className="st-card"
      data-sheet={mobile}
      data-stage={stage}
      role="dialog"
      aria-label={product.name}
    >
      <button type="button" className="st-card__close" onClick={onClose} aria-label="رجوع للمحل">
        <CloseIcon className="h-4 w-4" />
      </button>

      <p className="st-card__cat">{product.categoryName}</p>
      <h2 className="st-card__name">{product.name}</h2>

      <div className="st-card__price">
        <span className="nums">{formatPrice(product.price)}</span>
        {product.compareAtPrice && product.compareAtPrice > product.price && (
          <s className="nums">{formatPrice(product.compareAtPrice)}</s>
        )}
      </div>

      {colorLine && stage !== 'checkout' && <p className="st-card__line">{colorLine}</p>}

      {stage === 'checkout' ? (
        <div className="st-swap-in">
          <QuickCheckout
            product={product}
            picked={picked}
            governorates={governorates}
            onBack={() => setStage('options')}
          />
        </div>
      ) : (
      <div className="st-card__opts" data-leaving={stage === 'leaving'}>
      {preview && (
        <p className="st-card__note">معاينة للون «{preview}» على نفس القطعة — الصورة الحقيقية بلون تاني</p>
      )}

      {/* ---------- الألوان ---------- */}
      {colorGroup && (
        <div className="st-card__colors" role="radiogroup" aria-label="اللون">
          {colorGroup.options.map((c) => {
            const hex = colorOf(c)
            const on = color === c
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c}
                title={c}
                data-on={on}
                onClick={() => choose(COLOR, c)}
              >
                <span style={{ background: hex ?? 'transparent' }} data-empty={!hex}>
                  {!hex && c.slice(0, 1)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ---------- المقاسات ---------- */}
      {sizeGroup && (
        <>
          <div className="st-card__head">
            <span>اختار المقاس</span>
            <span>رجالي</span>
          </div>
          <div className="st-card__sizes" role="radiogroup" aria-label="المقاس">
            {sizeGroup.options.map((s) => {
              const off = allowed ? !allowed.has(s) : false
              const on = picked[SIZE] === s
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={off}
                  data-on={on}
                  onClick={() => choose(SIZE, s)}
                  title={off ? 'مش متوفر في اللون ده' : undefined}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* أي اختيارات تانية (لو المنتج ليه) */}
      {others.map((g) => (
        <div key={g.name} className="mt-4">
          <p className="st-card__head">
            <span>{g.name}</span>
          </p>
          <div className="st-card__sizes" role="radiogroup" aria-label={g.name}>
            {g.options.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={picked[g.name] === o}
                data-on={picked[g.name] === o}
                onClick={() => choose(g.name, o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="st-card__error" role="alert">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {/* ---------- الزرار ---------- */}
      <button
        type="button"
        className="st-card__add"
        data-phase={phase}
        disabled={soldOut || phase === 'busy'}
        onClick={add}
        aria-live="polite"
      >
        {soldOut ? (
          'خلص المخزون'
        ) : phase === 'busy' ? (
          <SpinnerIcon className="a-spin h-4 w-4" />
        ) : phase === 'done' ? (
          <>
            <span>اتضافت للسلة</span>
            <CheckIcon className="h-4 w-4" />
          </>
        ) : (
          <>
            <BagIcon className="h-4 w-4" />
            <span>أضف إلى السلة</span>
          </>
        )}
      </button>

      {phase === 'done' && (
        <button type="button" className="st-card__view" onClick={openCart}>
          <span>عرض السلة</span>
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
      )}

      {!soldOut && (
        <button type="button" className="st-card__buy" onClick={buyNow} disabled={checking || phase === 'busy'}>
          {checking ? <SpinnerIcon className="a-spin h-4 w-4" /> : <span>اطلب الآن — من غير السلة</span>}
        </button>
      )}

      <Link href={`/product/${product.slug}`} className="st-card__more">
        كل تفاصيل المنتج
        {product.images.length > 1 && (
          <span className="nums"> · {product.images.length} صور</span>
        )}
      </Link>
      </div>
      )}
    </aside>
  )
}

/* ------------------------------------------------------------
   القطعة بتطير للسلة — نسخة من صورتها بتتحرك لأيقونة السلة
   في الهيدر. transform و opacity بس، فبتفضل ناعمة.
   ------------------------------------------------------------ */
function flyToCart(rect: { x: number; y: number; w: number; h: number } | null, src: string) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.querySelector<HTMLElement>('.st-canvas')
  const target = [...document.querySelectorAll<HTMLElement>('[data-cart-target]')].find(
    (el) => el.getBoundingClientRect().width > 0
  )
  if (!rect || !canvas || !target) return

  const box = canvas.getBoundingClientRect()
  const from = { left: box.left + rect.x, top: box.top + rect.y, width: rect.w, height: rect.h }
  const to = target.getBoundingClientRect()
  if (!from.width || !to.width) return

  const ghost = document.createElement('img')
  ghost.src = src
  ghost.alt = ''
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    zIndex: '90',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    willChange: 'transform, opacity',
  })
  document.body.appendChild(ghost)

  const scale = Math.min(to.width / from.width, to.height / from.height) * 0.9
  const dx = to.left + to.width / 2 - (from.left + (from.width * scale) / 2)
  const dy = to.top + to.height / 2 - (from.top + (from.height * scale) / 2)

  const anim = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(${0.55 + scale * 0.45})`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.2 },
    ],
    { duration: 760, easing: 'cubic-bezier(0.55, 0, 0.3, 1)', fill: 'forwards' }
  )
  anim.onfinish = () => ghost.remove()
}
