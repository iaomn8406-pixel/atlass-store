'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hero } from '@/components/home/hero'
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, PlusIcon } from '@/components/ui/icons'
import { site } from '@/data/site'
import type { Room, RoomPiece } from '@/lib/room'
import type { Product } from '@/lib/types'
import { Hanger } from './hanger'
/* الكارت بيتحمّل لما يتفتح بس — هو اللي بيجيب السلة والتتبّع، فالصفحة
   الرئيسية بتفتح أخف */
const RoomCard = dynamic(() => import('./room-card').then((m) => m.RoomCard), { ssr: false })

/* ============================================================
   المتجر الافتراضي — على نفس فكرة الفيديو المرجعي
   ------------------------------------------------------------
   أوضة بحيطان فاتحة بنقط، وعلى الحيطة اللي قدام الشعار كبير
   وتحته قضيب واحد طويل متعلق عليه كل المنتجات جنب بعض ووشها
   لقدام. الأقسام أماكن على نفس القضيب: لما تختار قسم الكاميرا
   بتتزحلق على القضيب لحد مكانه.

   لما تدوس على قطعة الكاميرا بتقرّب منها، والقطع اللي جنبها
   بتوسّع لها مكان وتلف لفّة خفيفة. دوسة تانية بتفتح كارت المنتج.

   القطعة مش صورة مسطحة: ٣ شرايح بتنحني لورا على الجناب زي القماش
   على الشماعة، وعليها إضاءة خفيفة من فوق، ولها ظل على الحيطة.

   الأداء:
   • الكاميرا بتتحرك بكتابة transform واحد على «العالم» في كل
     فريم — مفيش إعادة رسم ولا render لرياكت أثناء الحركة
   • مفيش blur ولا filter جوه المشهد؛ الظلال صور جاهزة
   • الأجهزة الضعيفة بتاخد القطع من غير انحناء (صورة واحدة)
   • تفضيل تقليل الحركة = قطع مباشرة من غير تحريك
   ============================================================ */

/* ---------------- أبعاد العالم (وحدات المشهد) ---------------- */

const SHOULDER = 150 // عرض الكتاف الموحّد — كل القطع بنفس المقياس
const PACK = 0.9 // القطع جنب بعض على القضيب، الأكمام بتلمس بعض شوية
const ZONE_GAP = 110 // مسافة زيادة بين قسم والتاني على نفس القضيب
const RAIL_PAD = 150
const RAIL_Y = -230 // ارتفاع القضيب عن مستوى العين
const RAIL_Z = 90 // بُعد القضيب عن الحيطة
const HANGER_H = 58
const CEIL_Y = -1500 // الحيطة عالية كفاية إن الكاميرا ماتشوفش فوقها
const FLOOR_Y = 520
const WALL_H = FLOOR_Y - CEIL_Y
const FOCUS_Z = 80 // القطعة المختارة بتطلع لقدام
const SIDE_TURN = 28 // القطع اللي جنب المختارة بتلف لفّة خفيفة بس
const BEND = 22 // انحناء جناب القطعة لورا

type Mode = 'store' | 'zone' | 'focus' | 'product'

type Cam = { x: number; y: number; z: number; yaw: number }

type LaidPiece = RoomPiece & {
  w: number
  h: number
  /** مكان نقطة التعليق على القضيب */
  x: number
  /** ترتيبها على القضيب كله */
  idx: number
  zone: number
}

type LaidZone = {
  slug: string
  name: string
  /** مركز القسم على القضيب */
  cx: number
  width: number
  from: number
  to: number
}

/* ------------------------------------------------------------
   كل القطع على قضيب واحد — القسم الأول على اليمين (اتجاه القراءة)
   ------------------------------------------------------------ */
function layout(room: Room) {
  const pieces: LaidPiece[] = []
  const zones: LaidZone[] = []

  /* cursor = الطرف اليمين للقطعة الجاية، وبنمشي ناحية الشمال */
  let cursor = 0
  room.zones.forEach((zone, zi) => {
    if (zi > 0) cursor -= ZONE_GAP
    const from = pieces.length
    const start = cursor

    zone.pieces.forEach((p, i) => {
      const w = Math.min(330, Math.max(210, SHOULDER / Math.max(0.3, p.shoulder)))
      const h = (w * p.h) / p.w
      const prev = i > 0 ? pieces[pieces.length - 1] : null
      const x = prev ? prev.x - ((prev.w + w) / 2) * PACK : cursor - w / 2
      pieces.push({ ...p, w, h, x, idx: pieces.length, zone: zi })
    })

    const last = pieces[pieces.length - 1]
    cursor = last.x - last.w / 2
    zones.push({
      slug: zone.slug,
      name: zone.name,
      cx: (start + cursor) / 2,
      width: start - cursor,
      from,
      to: pieces.length - 1,
    })
  })

  /* بنوسّط القضيب كله على الحيطة */
  const right = Math.max(...pieces.map((p) => p.x + p.w / 2))
  const left = Math.min(...pieces.map((p) => p.x - p.w / 2))
  const shift = -(right + left) / 2
  pieces.forEach((p) => (p.x += shift))
  zones.forEach((z) => (z.cx += shift))

  const railW = right - left + RAIL_PAD * 2
  const roomW = Math.max(2400, railW + 900)
  const roomD = 2400
  const tallest = Math.max(...pieces.map((p) => p.h))

  return { pieces, zones, railW, roomW, roomD, tallest }
}

/* الكاميرا بتبص على نقطة من الحيطة اللي قدام من مسافة */
function cameraAt(lx: number, ly: number, dist: number, roomD: number, yaw = 0): Cam {
  return { x: lx, y: ly, z: -roomD / 2 + dist, yaw }
}

/* ------------------------------------------------------------
   تحريك الكاميرا: ٤ أرقام بمنحنى بيبدأ ويخلص بهدوء — مش محتاجين
   مكتبة تحريك كاملة عشان كده
   ------------------------------------------------------------ */
const ease = (t: number) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2)

function tweenCam(
  from: Cam,
  to: Cam,
  ms: number,
  onFrame: (c: Cam) => void
): () => void {
  let raf = 0
  /* الساعة بتبدأ من أول فريم بيترسم فعلًا مش من لحظة الضغطة — لو
     الفريم الأول اتأخر، الحركة ماتنطّش على جزء منها */
  let start = -1
  const tick = (now: number) => {
    if (start < 0) start = now
    const t = Math.min(1, (now - start) / ms)
    const k = ease(t)
    onFrame({
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      z: from.z + (to.z - from.z) * k,
      yaw: from.yaw + (to.yaw - from.yaw) * k,
    })
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/* أقصر لفّة بين زاويتين */
function nearAngle(from: number, to: number) {
  const d = (((to - from) % 360) + 540) % 360 - 180
  return from + d
}

/* ------------------------------------------------------------
   جسم القطعة: ٣ شرايح من نفس الصورة، الجناب بتنحني لورا
   ------------------------------------------------------------
   كل شريحة بتعرض جزءها من الصورة بالظبط (background-position)،
   والقناع بيقصّها على شكل القطعة، وطبقة تظليل خفيفة بتغمّق
   الأطراف اللي بتلف بعيد عن النور. الصورة نفسها مابتتغيّرش.
   ------------------------------------------------------------ */
const SLICES = [
  { from: 0, to: 0.24, side: 'start' as const },
  { from: 0.24, to: 0.76, side: 'mid' as const },
  { from: 0.76, to: 1, side: 'end' as const },
]

function Body({ p, flat, src }: { p: LaidPiece; flat: boolean; src: string }) {
  if (flat) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={p.w} height={p.h} decoding="async" draggable={false} />
    )
  }

  /* كل شريحة صندوق بيقص جزء من نفس الصورة (overflow: hidden) — من غير
     mask. الماسك جوه مشهد 3D مابيترسمش على بعض الأجهزة (لما تسريع
     كارت الشاشة يكون مقفول مثلًا) والقطعة كانت بتختفي خالص. الصورة
     نفسها شفافة حوالين القطعة، فمش محتاجين قص بشكلها */
  return (
    <>
      {SLICES.map((s) => {
        /* بكسل تداخل بين الشرايح عشان ما يبانش خط بينهم */
        const x0 = Math.max(0, s.from * p.w - 1)
        const x1 = Math.min(p.w, s.to * p.w + 1)

        return (
          <span
            key={s.side}
            className="vs-slice"
            data-side={s.side}
            style={{
              left: x0,
              width: x1 - x0,
              height: p.h,
              transform:
                s.side === 'start'
                  ? `rotateY(${-BEND}deg)`
                  : s.side === 'end'
                    ? `rotateY(${BEND}deg)`
                    : undefined,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              width={p.w}
              height={p.h}
              decoding="async"
              draggable={false}
              style={{ left: -x0, width: p.w, height: p.h }}
            />
          </span>
        )
      })}
    </>
  )
}

export function VirtualStore({ room, showcase }: { room: Room; showcase: Product[] }) {
  const stage = useRef<HTMLElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const cam = useRef<Cam>({ x: 0, y: -60, z: 0, yaw: 0 })
  const stopTween = useRef<(() => void) | null>(null)
  const size = useRef({ w: 1280, h: 720, p: 900 })

  const [supported, setSupported] = useState(true)
  const [ready, setReady] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [flat, setFlat] = useState(false)
  const [mode, setMode] = useState<Mode>('store')
  const [zoneIdx, setZoneIdx] = useState(0)
  /** القطعة المختارة — ترتيبها على القضيب كله */
  const [sel, setSel] = useState(0)
  const [help, setHelp] = useState(false)
  /* إعادة الإطار بعد تغيير المقاس (لفّ الفون مثلًا) */
  const [refit, setRefit] = useState(0)

  const motion = useRef({ reduced: false, light: false })

  const { pieces, zones, railW, roomW, roomD, tallest } = useMemo(() => layout(room), [room])

  const piece = pieces[sel]
  const zone = zones[zoneIdx]

  /* ---------------- الكاميرا ---------------- */
  const apply = useCallback(() => {
    const el = world.current
    if (!el) return
    const c = cam.current
    el.style.transform = `translateZ(${size.current.p}px) rotateY(${c.yaw}deg) translate3d(${-c.x}px, ${-c.y}px, ${-c.z}px)`
  }, [])

  const fly = useCallback(
    (to: Cam, duration = 1.05) => {
      stopTween.current?.()
      const target = { ...to, yaw: nearAngle(cam.current.yaw, to.yaw) }

      if (motion.current.reduced || duration === 0) {
        cam.current = target
        apply()
        return
      }

      stopTween.current = tweenCam(
        { ...cam.current },
        target,
        duration * 1000 * (motion.current.light ? 0.7 : 1),
        (c) => {
          cam.current = c
          apply()
        }
      )
    },
    [apply]
  )

  /** المسافة اللي تخلّي مقاس معيّن يملا جزء من الشاشة */
  const fit = useCallback((worldW: number, worldH: number, fw: number, fh: number) => {
    const { w, h, p } = size.current
    return Math.max((worldW * p) / (fw * w), (worldH * p) / (fh * h))
  }, [])

  /* ---------------- الوجهات ---------------- */
  /* من فوق الشعار لحد تحت أطول قطعة */
  const TOP = RAIL_Y - 330
  const BOTTOM = RAIL_Y + HANGER_H + tallest + 50

  const shotStore = useCallback((): Cam => {
    /* الكمبيوتر بيشوف القضيب كله. الفون شاشته طولية — لو حشرنا
       القضيب كله في العرض القطع هتبقى صغيرة أوي، فبنأطّر بالطول:
       الشعار والقطع اللي تحته واضحين، والباقي بالسحب */
    const d = mobile
      ? fit(420, BOTTOM - TOP, 0.96, 0.7) + RAIL_Z
      : fit(railW, BOTTOM - TOP, 0.96, 0.9) + RAIL_Z
    return cameraAt(0, (TOP + BOTTOM) / 2, d, roomD)
  }, [mobile, railW, fit, roomD, TOP, BOTTOM])

  const shotZone = useCallback(
    (z: LaidZone): Cam => {
      const top = RAIL_Y - 60
      /* على الفون بنوري حوالي قطعتين ونص من القسم، والباقي بالسحب */
      const d = fit(mobile ? Math.min(z.width, 640) : z.width + 180, BOTTOM - top, 0.94, mobile ? 0.62 : 0.84) + RAIL_Z
      return cameraAt(z.cx, (top + BOTTOM) / 2, d, roomD)
    },
    [fit, mobile, roomD, BOTTOM]
  )

  const shotPiece = useCallback(
    (p: LaidPiece, product: boolean): Cam => {
      const h = p.h + HANGER_H + 80
      const ly = RAIL_Y - HANGER_H + h / 2
      const z = RAIL_Z + FOCUS_Z

      if (!product) {
        const d = fit(p.w * 2.2, h, 0.9, 0.8) + z
        return cameraAt(p.x, ly, d, roomD)
      }

      /* وضع المنتج: القطعة في جزء والكارت في الجزء التاني */
      const { w, h: vh, p: P } = size.current
      if (mobile) {
        const d = fit(p.w * 1.3, h, 0.85, 0.4) + z
        const shift = (vh * 0.26 * d) / P
        return cameraAt(p.x, ly + shift, d, roomD)
      }
      const d = fit(p.w * 1.4, h, 0.5, 0.82) + z
      /* RTL: القطعة على اليمين والكارت على الشمال */
      const shift = (w * 0.22 * d) / P
      return cameraAt(p.x - shift, ly, d, roomD)
    },
    [fit, mobile, roomD]
  )

  /* ---------------- القياس ---------------- */
  useEffect(() => {
    if (typeof CSS !== 'undefined' && !CSS.supports('transform-style', 'preserve-3d')) {
      setSupported(false)
      return
    }

    const nav = navigator as Navigator & {
      deviceMemory?: number
      connection?: { saveData?: boolean }
    }
    motion.current = {
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      light:
        (nav.hardwareConcurrency ?? 8) <= 2 ||
        (nav.deviceMemory ?? 8) <= 2 ||
        Boolean(nav.connection?.saveData),
    }
    setFlat(motion.current.light)

    const el = stage.current
    if (!el) return

    const measure = () => {
      const r = el.getBoundingClientRect()
      const p = Math.round(Math.hypot(r.width, r.height) * 0.55)
      size.current = { w: r.width, h: r.height, p }
      el.style.perspective = `${p}px`
      setMobile(r.width < 768)
    }

    measure()
    const ro = new ResizeObserver(() => {
      measure()
      setRefit((n) => n + 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const target = useCallback((): Cam => {
    if (mode === 'store' || !piece) return shotStore()
    if (mode === 'zone') return shotZone(zone)
    return shotPiece(piece, mode === 'product')
  }, [mode, piece, zone, shotStore, shotZone, shotPiece])

  /* أول ظهور: الكاميرا بتلف من ركن الأوضة لحد الحيطة — زي أول
     الفيديو. دي الحركة الوحيدة المقصودة */
  const intro = useRef(false)
  useEffect(() => {
    if (!supported || intro.current || !world.current) return
    intro.current = true

    const to = shotStore()
    if (motion.current.reduced || motion.current.light) {
      cam.current = to
      apply()
    } else {
      cam.current = { ...to, x: to.x + 260, z: to.z + 700, yaw: -34 }
      apply()
      fly(to, 1.9)
    }
    setReady(true)
  }, [supported, shotStore, apply, fly])

  /* أي تغيير في الحالة → الكاميرا تروح على الوجهة الجديدة */
  const first = useRef(true)
  useEffect(() => {
    if (!ready) return
    if (first.current) {
      first.current = false
      return
    }
    fly(target())
  }, [mode, zoneIdx, sel, ready, target, fly])

  useEffect(() => {
    if (ready && refit) fly(target(), 0)
  }, [refit]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- التنقل ---------------- */
  const goStore = () => setMode('store')

  const goZone = (i: number) => {
    setZoneIdx(i)
    setSel(zones[i].from)
    setMode('zone')
  }

  const pick = (i: number) => {
    if (i === sel && mode === 'focus') {
      setMode('product')
      return
    }
    setSel(i)
    setZoneIdx(pieces[i].zone)
    setMode(mode === 'product' ? 'product' : 'focus')
  }

  const step = useCallback(
    (dir: 1 | -1) => {
      setSel((i) => {
        const next = (i + dir + pieces.length) % pieces.length
        setZoneIdx(pieces[next].zone)
        return next
      })
    },
    [pieces]
  )

  const back = useCallback(() => {
    setMode((m) => (m === 'product' ? 'focus' : m === 'focus' ? 'zone' : 'store'))
  }, [])

  /* Esc يرجع خطوة، والأسهم بتنقل بين القطع */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'store') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') back()
      if (mode === 'focus' || mode === 'product') {
        /* RTL: السهم الشمال = اللي بعده */
        if (e.key === 'ArrowLeft') step(1)
        if (e.key === 'ArrowRight') step(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, back, step])

  /* ---------------- السحب: بيزحلق الكاميرا على القضيب ---------------- */
  const drag = useRef<{ x: number; camX: number; moved: boolean; id: number } | null>(null)
  const dragged = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.vs-ui')) return
    drag.current = { x: e.clientX, camX: cam.current.x, moved: false, id: e.pointerId }
    dragged.current = false
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 8) return
    if (!d.moved) {
      d.moved = true
      dragged.current = true
      /* بنمسك المؤشر بعد ما يتحرك بس — كده الضغطة العادية على القطعة
         بتفضل شغالة */
      stage.current?.setPointerCapture(d.id)
    }

    if (mode === 'store' || mode === 'zone') {
      stopTween.current?.()
      /* سحب الشاشة يمين = الكاميرا تروح شمال، بنفس سرعة الصباع */
      const { p } = size.current
      const depth = -cam.current.z - roomD / 2 + RAIL_Z
      const scale = Math.abs(depth) / p
      const half = railW / 2
      cam.current.x = Math.max(-half, Math.min(half, d.camX - dx * scale))
      apply()
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return

    /* الضغطة اللي بتيجي مع نهاية السحب بتتجاهل — وبعدها على طول
       العلامة بتتشال، عشان الضغطات الجاية (والكيبورد) تشتغل عادي */
    window.setTimeout(() => (dragged.current = false), 0)

    const dx = e.clientX - d.x
    if (mode === 'focus' || mode === 'product') {
      /* سحب في وضع القطعة = اللي بعدها أو قبلها */
      if (Math.abs(dx) > 40) step(dx > 0 ? 1 : -1)
      return
    }

    /* بيستقر على أقرب قسم للكاميرا */
    let best = 0
    zones.forEach((z, i) => {
      if (Math.abs(z.cx - cam.current.x) < Math.abs(zones[best].cx - cam.current.x)) best = i
    })
    if (best === zoneIdx && mode === 'zone') fly(shotZone(zones[best]))
    else goZone(best)
  }

  const zooming = mode === 'focus' || mode === 'product'

  /* ---------------- تحميل الصور ----------------
     القطعة مابتظهرش (ولا ظلها) غير لما صورتها تتحمّل — من غير كده،
     على النت الضعيف الشماعات كانت بتبان فاضية لحد ما الصور توصل.
     الصور ممكن تكون اتحمّلت قبل ما رياكت يشتغل (الصفحة جاية جاهزة من
     السيرفر)، فبنتأكد من complete الأول قبل ما نستنى الحدث */
  const [loaded, setLoaded] = useState<Record<string, 'ok' | 'fail'>>({})

  useEffect(() => {
    const root = world.current
    if (!root) return
    const undo: (() => void)[] = []

    root.querySelectorAll<HTMLElement>('.vs-piece').forEach((el) => {
      const id = el.dataset.piece
      const img = el.querySelector<HTMLImageElement>('.vs-body img')
      if (!id || !img) return

      const done = (ok: boolean) =>
        setLoaded((s) => (s[id] === 'ok' ? s : { ...s, [id]: ok ? 'ok' : 'fail' }))

      if (img.complete) {
        done(img.naturalWidth > 0)
        return
      }
      const onLoad = () => done(true)
      const onError = () => done(false)
      img.addEventListener('load', onLoad, { once: true })
      img.addEventListener('error', onError, { once: true })
      undo.push(() => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
      })
    })

    return () => undo.forEach((u) => u())
  }, [pieces, flat])

  /* النسخة الكبيرة بتتحمّل بس للقطعة اللي اتختارت، وبتتبدّل لما تجهز
     فعلًا — من غير ما القطعة تختفي لحظة التبديل */
  const [sharp, setSharp] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!zooming || !piece || sharp[piece.id]) return
    let alive = true
    const id = piece.id
    const img = new window.Image()
    img.src = piece.src
    const ready = img.decode ? img.decode() : Promise.resolve()
    ready
      .then(() => {
        if (alive) setSharp((s) => ({ ...s, [id]: true }))
      })
      .catch(() => {
        /* بنفضل على النسخة الصغيرة */
      })
    return () => {
      alive = false
    }
  }, [zooming, piece, sharp])

  /* لو المتصفح مابيدعمش 3D — الواجهة العادية */
  if (!supported) return <Hero showcase={showcase} />

  const activeSlug = mode === 'store' ? 'store' : zone?.slug
  const product = piece ? room.products[piece.productId] : undefined

  /* مكان كل قطعة: المختارة بتطلع لقدام، واللي جنبها بتوسّع وتلف شوية */
  const place = (p: LaidPiece) => {
    if (!zooming) return { x: p.x, z: RAIL_Z, turn: 0 }
    const focus = pieces[sel]
    if (p.idx === sel) return { x: p.x, z: RAIL_Z + FOCUS_Z, turn: 0 }
    const away = p.idx < sel ? 1 : -1
    return {
      x: p.x + away * (focus.w * 0.34 + 36),
      z: RAIL_Z - 6,
      turn: SIDE_TURN * away,
    }
  }

  return (
    <section
      ref={stage}
      aria-label="المتجر الافتراضي"
      className="vs"
      data-mode={mode}
      data-ready={ready}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      /* المشهد عمره ما يتمرّر من جوه — لو متصفح قديم حاول (مثلًا وهو
         بيوصّل التركيز لزرار) بنرجّعه مكانه */
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0
        e.currentTarget.scrollLeft = 0
      }}
    >
      <div ref={world} className="vs-world">
        {/* ---------- الأرضية ---------- */}
        <div
          className="vs-floor"
          style={{ width: roomW, height: roomD, left: -roomW / 2, top: FLOOR_Y - roomD / 2 }}
        />

        {/* ---------- الحيطان اللي على الجناب ---------- */}
        {(['right', 'left'] as const).map((side) => (
          <div
            key={side}
            className="vs-wall"
            data-wall={side}
            style={{
              width: roomD,
              height: WALL_H,
              left: -roomD / 2,
              top: CEIL_Y,
              transform:
                side === 'right'
                  ? `translateX(${roomW / 2}px) rotateY(-90deg)`
                  : `translateX(${-roomW / 2}px) rotateY(90deg)`,
            }}
          />
        ))}

        {/* ---------- الحيطة اللي قدام: الشعار والقضيب ---------- */}
        <div
          className="vs-wall"
          data-wall="back"
          style={{
            width: roomW,
            height: WALL_H,
            left: -roomW / 2,
            top: CEIL_Y,
            transform: `translateZ(${-roomD / 2}px)`,
          }}
        >
          <div className="vs-logo" style={{ left: roomW / 2, top: RAIL_Y - CEIL_Y - 300 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={site.logo} alt="" width={128} height={128} />
            <span className="vs-logo__name">{site.name}</span>
            <span className="vs-logo__sub">Store</span>
          </div>

          <div className="vs-zone" style={{ left: roomW / 2, top: RAIL_Y - CEIL_Y }}>
            {/* ظل كل قطعة على الحيطة */}
            {pieces.map((p) => {
              const at = place(p)
              const hidden = mode === 'product' && p.idx !== sel
              const sw = p.w * 1.2
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${p.id}-shadow`}
                  src={p.shadow}
                  alt=""
                  aria-hidden="true"
                  className="vs-shadow"
                  data-hidden={hidden}
                  data-loaded={loaded[p.id] === 'ok'}
                  decoding="async"
                  draggable={false}
                  style={{
                    width: sw,
                    left: at.x - sw / 2 + p.w * (0.5 - p.hookX),
                    top: (p.ownHanger ? 0 : HANGER_H * 0.6) + 26,
                    transform: `translateZ(2px) scaleX(${Math.cos((at.turn * Math.PI) / 180)})`,
                    opacity: p.idx === sel && zooming ? 0.62 : 0.5,
                  }}
                />
              )
            })}

            {/* القضيب الواحد والأرجل اللي ماسكاه */}
            <div
              className="vs-rail"
              style={{ width: railW, left: -railW / 2, transform: `translateZ(${RAIL_Z}px)` }}
            />
            {[-1, 1].map((side) => (
              <div
                key={side}
                className="vs-bracket"
                style={{
                  width: RAIL_Z,
                  left: side * (railW / 2 - 14),
                  transform: 'translateZ(1px) rotateY(-90deg)',
                }}
              />
            ))}

            {pieces.map((p) => {
              const at = place(p)
              const focused = zooming && p.idx === sel
              const hidden = mode === 'product' && !focused

              const name = room.products[p.productId]?.name ?? ''
              const label = p.color ? `${name} — ${p.color}` : name

              /* الشماعة المرسومة على قد الكتاف بالظبط */
              const hw = p.shoulder * 0.92 * p.w
              const hh = (hw * 74) / 200

              return (
                <button
                  key={p.id}
                  type="button"
                  className="vs-piece"
                  data-piece={p.id}
                  data-focused={focused}
                  data-hidden={hidden}
                  data-loaded={loaded[p.id] === 'ok'}
                  aria-label={label}
                  aria-pressed={focused}
                  tabIndex={mode === 'store' ? -1 : 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragged.current) return
                    pick(p.idx)
                  }}
                  style={{
                    width: p.w,
                    top: p.ownHanger ? -6 : -hh * 0.14,
                    transform: `translate3d(${at.x - p.w * p.hookX}px, 0, ${at.z}px) rotateY(${at.turn}deg)`,
                    transformOrigin: `${p.hookX * 100}% 0`,
                  }}
                >
                  {!p.ownHanger && (
                    <span
                      className="vs-hanger"
                      style={{ width: hw, height: hh, left: p.hookX * p.w - hw / 2 }}
                    >
                      <Hanger />
                    </span>
                  )}

                  <span
                    className="vs-body"
                    data-flat={flat}
                    style={{ width: p.w, height: p.h, marginTop: p.ownHanger ? 0 : hh * 0.54 }}
                  >
                    <Body p={p} flat={flat} src={sharp[p.id] ? p.src : p.srcSm} />
                  </span>

                  <span className="vs-caption">{name}</span>
                  <span className="vs-plus" aria-hidden="true">
                    <PlusIcon className="h-4 w-4" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ============ الواجهة فوق المشهد ============ */}

      {/* أسهم التنقل في وضع القطعة */}
      {zooming && pieces.length > 1 && (
        <div className="vs-ui vs-steps" data-product={mode === 'product'}>
          <button type="button" onClick={() => step(-1)} aria-label="القطعة اللي قبلها">
            <ArrowRightIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="القطعة اللي بعدها">
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* شريط الأقسام */}
      {mode !== 'product' && (
        <nav className="vs-ui vs-pills" aria-label="أقسام المتجر">
          <div className="vs-pills__track no-bar">
            <button
              type="button"
              data-active={activeSlug === 'store'}
              aria-pressed={activeSlug === 'store'}
              onClick={goStore}
            >
              المتجر
            </button>
            {zones.map((z, i) => (
              <button
                key={z.slug}
                type="button"
                data-active={activeSlug === z.slug}
                aria-pressed={activeSlug === z.slug}
                onClick={() => goZone(i)}
              >
                {z.name}
              </button>
            ))}
            <button
              type="button"
              className="vs-pills__info"
              aria-label="إزاي تتنقل"
              aria-expanded={help}
              onClick={() => setHelp((v) => !v)}
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          </div>

          {help && (
            <p className="vs-help" role="status">
              {mobile
                ? 'اسحب يمين وشمال عشان تتنقل على الشماعة · دوس على أي قطعة تقرّب منها'
                : 'اسحب بالماوس عشان تتنقل على الشماعة · دوس على أي قطعة تقرّب منها، ودوسة تانية تفتحها'}
            </p>
          )}
        </nav>
      )}

      {/* كارت المنتج */}
      {mode === 'product' && piece && product && (
        <RoomCard
          key={piece.productId}
          product={product}
          piece={piece}
          mobile={mobile}
          onClose={back}
          onPickColor={(color) => {
            const idx = pieces.findIndex(
              (p) => p.productId === piece.productId && p.color === color
            )
            if (idx >= 0 && idx !== sel) setSel(idx)
          }}
        />
      )}
    </section>
  )
}
