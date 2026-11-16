'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightIcon, CloseIcon, InfoIcon } from '@/components/ui/icons'
import { site } from '@/data/site'
import { colorOf } from '@/lib/colors'
import type { Room, RoomPiece, RoomZone } from '@/lib/room'
import type { GovOption } from './quick-checkout'
import type { Rect, Store } from './scene'

/* البطاقة بتتحمّل لما حد يفتح قطعة بس — مش في أول تحميل للصفحة */
const StoreCard = dynamic(() => import('./store-card').then((m) => m.StoreCard), { ssr: false })

/* ============================================================
   المتجر الافتراضي — الصفحة الرئيسية كلها
   ------------------------------------------------------------
   الرسم في scene.ts (WebGL). هنا الحالة والتحكم وإتاحة الاستخدام:
   أزرار حقيقية فوق كل قطعة (ماوس/لمس/كيبورد/قارئ شاشة)، شريط
   الأقسام، البطاقة، والرجوع.

   الحالات: store (الكادر العام) → zone (مكان القسم) → product
   (القطعة متركّز عليها + البطاقة). Escape/الرجوع بيطلع خطوة.
   ============================================================ */

type Mode = 'store' | 'zone' | 'product'
type Piece = RoomPiece & { zone: string }

export function VirtualStore({ room, governorates }: { room: Room; governorates: GovOption[] }) {
  const zones = room.zones
  const pieces = useMemo<Piece[]>(
    () => zones.flatMap((z) => z.pieces.map((p) => ({ ...p, zone: z.slug }))),
    [zones]
  )
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces])

  const [gl, setGl] = useState<'pending' | 'on' | 'off'>('pending')
  const [mode, setMode] = useState<Mode>('store')
  const [zone, setZone] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  const [info, setInfo] = useState(false)
  /** لون بيتعرض كمعاينة (مالوش صورة) */
  const [preview, setPreview] = useState<string | null>(null)
  /** رجع من تسجيل الدخول وهو كان بيطلب قطعة → نفتحها بنفس اختياراته */
  const [resume, setResume] = useState<{ pieceId: string; picked: Record<string, string> } | null>(null)
  const [mobile, setMobile] = useState(false)

  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const store = useRef<Store | null>(null)
  const spots = useRef(new Map<string, HTMLButtonElement>())
  const rects = useRef(new Map<string, Rect | null>())
  const returnTo = useRef<HTMLElement | null>(null)
  const dragged = useRef(false)
  const modeRef = useRef<Mode>('store')
  modeRef.current = mode

  /* ---------------- تشغيل المشهد ---------------- */
  useEffect(() => {
    const mq = matchMedia('(max-width: 767px)')
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!canvasSupported()) {
      setGl('off')
      return
    }
    let alive = true
    let ro: ResizeObserver | null = null
    const el = canvas.current!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

    const lost = (e: Event) => {
      e.preventDefault()
      setGl('off')
    }
    el.addEventListener('webglcontextlost', lost)

    import('./scene')
      .then(({ createStore }) => {
        if (!alive) return
        const s = createStore(el, {
          zones,
          logo: site.logo,
          brand: site.name,
          reducedMotion: reduced,
          onRects: (r) => {
            rects.current = r
            place()
          },
          onPieceReady: (id) => setReady((prev) => new Set(prev).add(id)),
          onMotion: (m) => stage.current?.setAttribute('data-moving', String(m)),
        })
        store.current = s
        const box = stage.current!.getBoundingClientRect()
        s.resize(box.width, box.height)
        s.intro()
        ro = new ResizeObserver(([e]) => s.resize(e.contentRect.width, e.contentRect.height))
        ro.observe(stage.current!)
        setGl('on')
      })
      .catch(() => alive && setGl('off'))

    return () => {
      alive = false
      ro?.disconnect()
      el.removeEventListener('webglcontextlost', lost)
      store.current?.dispose()
      store.current = null
    }
    // المشهد بيتبني مرة واحدة للأقسام دي
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('atlas_quick_resume')
      if (!raw) return
      sessionStorage.removeItem('atlas_quick_resume')
      const r = JSON.parse(raw)
      if (r?.pieceId && byId.has(r.pieceId)) setResume(r)
    } catch {
      /* مفيش طلب معلّق */
    }
  }, [byId])

  /* ---------------- أزرار القطع فوق الكانفاس ---------------- */
  const place = useCallback(() => {
    for (const [id, el] of spots.current) {
      const r = rects.current.get(id)
      const m = modeRef.current
      // في وضع المنتج مفيش أزرار ورا البطاقة — القطعة المختارة بس
      const show = !!r && (m !== 'product' || el.dataset.sel === 'true')
      if (!show || !r) {
        el.dataset.off = 'true'
        continue
      }
      el.dataset.off = 'false'
      const w = Math.max(44, r.w)
      const h = Math.max(44, r.h)
      el.style.transform = `translate3d(${r.x + (r.w - w) / 2}px, ${r.y + (r.h - h) / 2}px, 0)`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
    }
  }, [])

  useEffect(() => place(), [mode, sel, ready, place])

  /* ---------------- التنقل ---------------- */
  const goStore = useCallback(() => {
    setMode('store')
    setZone(null)
    setSel(null)
    store.current?.store()
  }, [])

  const goZone = useCallback((slug: string) => {
    setPreview(null)
    store.current?.recolor(null, null)
    setMode('zone')
    setZone(slug)
    setSel(null)
    store.current?.zone(slug)
  }, [])

  const open = useCallback(
    (id: string, from?: HTMLElement | null) => {
      const p = byId.get(id)
      if (!p) return
      if (from) returnTo.current = from
      setPreview(null)
      store.current?.recolor(null, null)
      setMode('product')
      setZone(p.zone)
      setSel(id)
      store.current?.focus(id, true)
      store.current?.sharpen(id)
    },
    [byId]
  )

  /* الطلب المعلّق: أول ما القطعة تظهر في المشهد نفتحها والبطاقة تكمّل الطلب */
  const resumed = useRef(false)
  useEffect(() => {
    if (!resume || resumed.current || gl !== 'on' || !ready.has(resume.pieceId)) return
    resumed.current = true
    open(resume.pieceId)
  }, [resume, gl, ready, open])

  /** الرجوع: البطاقة → مكان القسم → الكادر العام */
  const back = useCallback(() => {
    if (modeRef.current === 'product' && zone) {
      const to = returnTo.current
      goZone(zone)
      // التركيز يرجع للقطعة اللي كان عليها
      requestAnimationFrame(() => to?.focus({ preventScroll: true }))
      return
    }
    goStore()
  }, [zone, goZone, goStore])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (info) return setInfo(false)
        if (modeRef.current !== 'store') back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, info])

  /* ---------------- سكرول الماوس / سحب الصباع = التنقل بين الأماكن ----------------
     الترتيب: المتجر ← الأقسام بنفس ترتيب الشريط. الكاميرا بتمشي للمكان
     اللي بعده كأنك بتلف في المحل. */
  const stepping = useRef(0)
  const step = useCallback(
    (dir: 1 | -1) => {
      if (modeRef.current === 'product') return
      const now = performance.now()
      if (now < stepping.current) return
      const order = ['store', ...zones.map((z) => z.slug)]
      const at = modeRef.current === 'store' ? 0 : Math.max(0, order.indexOf(zone ?? ''))
      const next = Math.max(0, Math.min(order.length - 1, at + dir))
      if (next === at) return
      stepping.current = now + 850 // سكرول واحد = مكان واحد
      if (next === 0) goStore()
      else goZone(order[next])
    },
    [zones, zone, goStore, goZone]
  )

  useEffect(() => {
    const el = stage.current
    if (!el) return
    let acc = 0
    let idle = 0
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current === 'product' || e.ctrlKey) return // ctrl+wheel = تكبير الصفحة
      e.preventDefault()
      acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      clearTimeout(idle)
      idle = window.setTimeout(() => (acc = 0), 220)
      if (Math.abs(acc) > 40) {
        step(acc > 0 ? 1 : -1)
        acc = 0
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [step])

  /* ---------------- السحب ---------------- */
  const drag = useRef<{ x: number; x0: number; y0: number; t0: number; id: number; moved: boolean } | null>(null)
  /** مسك المؤشر للسحب — بعض المتصفحات بترمي خطأ لو المؤشر خلص؛ مش مهم */
  const capture = (e: React.PointerEvent) => {
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* السحب بيكمّل عادي من غير مسك */
    }
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || modeRef.current === 'product') return
    drag.current = { x: e.clientX, x0: e.clientX, y0: e.clientY, t0: performance.now(), id: e.pointerId, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 8) return
    if (!d.moved) {
      d.moved = true
      capture(e)
    }
    d.x = e.clientX
    store.current?.drag(dx)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    const dt = Math.max(1, performance.now() - d.t0)
    // سحبة لفوق/تحت، أو سحبة جانبية سريعة = المكان اللي بعده/قبله
    const vertical = Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2
    const fling = Math.abs(dx) > 70 && Math.abs(dx) / dt > 0.45
    if (vertical || fling) {
      step(vertical ? (dy < 0 ? 1 : -1) : dx < 0 ? 1 : -1)
      dragged.current = true
      setTimeout(() => (dragged.current = false), 0)
      return
    }
    if (d.moved || Math.abs(dy) > 10) {
      dragged.current = true
      setTimeout(() => (dragged.current = false), 0)
    }
  }

  /* ---------------- لون تاني لنفس المنتج ----------------
     لو اللون ليه صورة حقيقية → القطعة دي. لو مالوش → معاينة: بنلوّن
     القطعة الأقرب له في الفتاحة/الغمقان (الرمادي من الأبيض مش من الأسود)
     بنفس تفاصيلها، والبطاقة بتقول إنها معاينة. */
  const pickColor = useCallback(
    (color: string) => {
      const cur = sel ? byId.get(sel) : null
      if (!cur) return
      const twin = pieces.find((p) => p.productId === cur.productId && p.color === color)
      if (twin) {
        if (twin.id !== cur.id) open(twin.id)
        else {
          setPreview(null)
          store.current?.recolor(null, null)
        }
        return
      }
      const hex = colorOf(color)
      const siblings = pieces.filter((p) => p.productId === cur.productId && p.base)
      if (!hex || !siblings.length) {
        setPreview(null)
        store.current?.recolor(null, null)
        return
      }
      // الأقرب في الفتاحة والتشبّع (Lab): الرمادي من الأبيض، البترولي من الأزرق
      const t = lab([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))
      const score = (c: number[]) => {
        const l = lab(c)
        return Math.abs(l[0] - t[0]) + 0.5 * Math.abs(Math.hypot(l[1], l[2]) - Math.hypot(t[1], t[2]))
      }
      const src = siblings.reduce((a, b) => (score(b.base!) < score(a.base!) ? b : a))
      if (src.id !== cur.id) open(src.id)
      store.current?.recolor(src.id, hex)
      setPreview(color)
    },
    [sel, byId, pieces, open]
  )

  const piece = sel ? byId.get(sel) : undefined
  const product = piece ? room.products[piece.productId] : undefined
  const pieceRect = useCallback(() => (sel ? store.current?.rectOf(sel) ?? null : null), [sel])

  /* ---------------- مفيش WebGL → بديل بسيط شغّال ---------------- */
  if (gl === 'off') return <StoreFallback room={room} />

  return (
    <section className="st st-home" data-mode={mode} aria-label={`${site.nameFull} — المتجر الافتراضي`}>
      <div
        ref={stage}
        className="st-stage"
        data-gl={gl}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <canvas ref={canvas} className="st-canvas" aria-hidden="true" />

        {/* لحد ما المشهد يجهز: الحيطة والشعار بس — مفيش شماعات فاضية */}
        {gl === 'pending' && (
          <div className="st-poster" aria-hidden="true">
            <img src={site.logo} alt="" width={64} height={64} />
          </div>
        )}

        {/* زرار لكل قطعة — مكانه بيتحدّث من المشهد */}
        {zones.map((z) => (
          <div key={z.slug} role="group" aria-label={z.name} className="st-spots">
            {z.pieces.map((p) => {
              const prod = room.products[p.productId]
              const label = `${prod?.name ?? ''}${p.color ? ` — ${p.color}` : ''}`
              return (
                <button
                  key={p.id}
                  type="button"
                  ref={(el) => {
                    if (el) spots.current.set(p.id, el)
                    else spots.current.delete(p.id)
                  }}
                  className="st-spot"
                  data-off="true"
                  data-sel={sel === p.id}
                  hidden={!ready.has(p.id)}
                  aria-label={label}
                  aria-pressed={sel === p.id}
                  onClick={(e) => (sel === p.id ? undefined : open(p.id, e.currentTarget))}
                  onPointerEnter={() => store.current?.hover(p.id)}
                  onPointerLeave={() => store.current?.hover(null)}
                  onFocus={(e) => {
                    // كيبورد على قطعة مش ظاهرة → الكاميرا تروح لقسمها
                    if (e.currentTarget.dataset.off === 'true' && modeRef.current !== 'product' && zone !== z.slug)
                      goZone(z.slug)
                    store.current?.hover(p.id)
                  }}
                  onBlur={() => store.current?.hover(null)}
                />
              )
            })}
          </div>
        ))}

        {/* رجوع (من القسم أو المنتج) */}
        {mode !== 'store' && (
          <button type="button" className="st-back" onClick={back}>
            <ArrowRightIcon className="h-4 w-4" />
            <span>{mode === 'product' ? 'رجوع للقسم' : 'المتجر'}</span>
          </button>
        )}
      </div>

      {/* ---------------- شريط الأقسام ---------------- */}
      <nav className="st-pills" aria-label="أقسام المتجر" data-hide={mode === 'product' && mobile}>
        <div className="st-pills__track">
          <button type="button" data-active={mode === 'store'} onClick={goStore}>
            المتجر
          </button>
          {zones.map((z) => (
            <button
              key={z.slug}
              type="button"
              data-active={mode !== 'store' && zone === z.slug}
              onClick={() => goZone(z.slug)}
            >
              {z.name}
            </button>
          ))}
          <span className="st-pills__sep" aria-hidden="true" />
          <button
            type="button"
            className="st-pills__info"
            aria-expanded={info}
            aria-controls="st-info"
            aria-label="عن المتجر وروابط مهمة"
            onClick={() => setInfo((v) => !v)}
          >
            <InfoIcon className="h-4 w-4" />
          </button>
        </div>
      </nav>

      {info && <InfoPanel zones={zones} onClose={() => setInfo(false)} />}

      {/* ---------------- البطاقة ---------------- */}
      {mode === 'product' && piece && product && (
        <StoreCard
          key={piece.productId}
          product={product}
          piece={piece}
          mobile={mobile}
          onClose={back}
          onPickColor={pickColor}
          pieceRect={pieceRect}
          preview={preview}
          governorates={governorates}
          resume={resume?.pieceId === piece.id ? resume.picked : null}
        />
      )}

      {/* روابط المنتجات لمحركات البحث وقارئ الشاشة — نفس مسارات المنتجات */}
      <nav className="sr-only" aria-label="كل منتجات المتجر">
        <ul>
          {Object.values(room.products).map((p) => (
            <li key={p.id}>
              <Link href={`/product/${p.slug}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  )
}

/* ---------------- لوحة «i» — شرح + الروابط اللي كانت في الفوتر ---------------- */
function InfoPanel({ zones, onClose }: { zones: RoomZone[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div id="st-info" ref={ref} tabIndex={-1} className="st-info" role="dialog" aria-label="عن المتجر">
      <button type="button" className="st-info__close" onClick={onClose} aria-label="قفل">
        <CloseIcon className="h-4 w-4" />
      </button>
      <p className="st-info__lead">
        اختار قسم من تحت والكاميرا هتروح له. دوس على أي قطعة تشوفها من قريب وتختار مقاسك. اسحب يمين
        وشمال عشان تلف في المكان.
      </p>
      <div className="st-info__links">
        <Link href="/shop">كل المنتجات</Link>
        {zones.map((z) => (
          <Link key={z.slug} href={`/category/${z.slug}`}>
            {z.name}
          </Link>
        ))}
        <Link href="/track">تتبّع طلبك</Link>
        <Link href="/shipping">الشحن</Link>
        <Link href="/returns">الاستبدال والاسترجاع</Link>
        <Link href="/size-guide">دليل المقاسات</Link>
        <Link href="/faq">أسئلة شائعة</Link>
      </div>
    </div>
  )
}

/* ---------------- بديل من غير WebGL: نفس القطع ونفس الأقسام ---------------- */
function StoreFallback({ room }: { room: Room }) {
  return (
    <section className="st-fallback" aria-label={site.nameFull}>
      {room.zones.map((z) => (
        <div key={z.slug} className="st-fallback__zone">
          <h2>
            <Link href={`/category/${z.slug}`}>{z.name}</Link>
          </h2>
          <ul>
            {z.pieces.map((p) => {
              const prod = room.products[p.productId]
              if (!prod) return null
              return (
                <li key={p.id}>
                  <Link href={`/product/${prod.slug}`}>
                    <img src={p.srcSm} alt={prod.name} width={p.w} height={p.h} loading="lazy" />
                    <span>{prod.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** sRGB (0–255) → CIE Lab */
function lab(rgb: number[]) {
  const lin = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  const z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883
  const f = (u: number) => (u > 0.008856 ? Math.cbrt(u) : 7.787 * u + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function canvasSupported() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
