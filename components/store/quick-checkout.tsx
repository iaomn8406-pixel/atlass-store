'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertIcon, ArrowRightIcon, SpinnerIcon } from '@/components/ui/icons'
import { track as trackActivity, trackOrdered } from '@/lib/activity'
import { formatPrice, isValidEgyptPhone, isValidEmail, normalizeEgyptPhone } from '@/lib/format'
import { makeEventId, trackInitiateCheckout, trackPurchase } from '@/lib/meta/client'
import { loadProfile, profileToForm } from '@/lib/profile'
import { useColorImage } from '@/components/product/gallery-piece'
import type { RoomProduct } from '@/lib/room'
import type { CartItem, CustomerInfo } from '@/lib/types'
import { arClear, arInvalid } from '@/components/checkout/field'

/* ============================================================
   الطلب من البطاقة نفسها (قطعة واحدة)
   ------------------------------------------------------------
   نفس صفحة إتمام الطلب بالظبط من جوه — نفس الشروط ونفس المحافظات
   والمراكز ونفس /api/order ونفس أحداث ميتا وتتبع العميل ونفس صفحة
   النجاح. الفرق الوحيد إن الطلب لقطعة واحدة اختارها (لونها ومقاسها)
   من غير ما تدخل السلة. السلة زي ما هي بصفحتها.
   ============================================================ */

export type GovOption = { id: number; name: string; shipping: number }

const empty: CustomerInfo = {
  fullName: '',
  phone: '',
  phoneAlt: '',
  email: '',
  governorate: '',
  area: '',
  village: '',
  address: '',
  landmark: '',
  notes: '',
}

type Errors = Partial<Record<keyof CustomerInfo, string>>

export function QuickCheckout({
  product,
  picked,
  governorates,
  onBack,
}: {
  product: RoomProduct
  picked: Record<string, string>
  governorates: GovOption[]
  onBack: () => void
}) {
  const router = useRouter()
  const withColorImage = useColorImage()
  const [form, setForm] = useState<CustomerInfo>(empty)
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState('')
  const [sending, setSending] = useState(false)
  const [areas, setAreas] = useState<string[]>([])
  const [areasLoading, setAreasLoading] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  /* القطعة بنفس شكل عنصر السلة — /api/order بيستقبلها زي ما هي */
  const item: CartItem = useMemo(
    () => ({
      key: `${product.id}__${Object.entries(picked)
        .map(([k, v]) => `${k}:${v}`)
        .join('|')}`,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      image: withColorImage(product, picked).images[0] ?? '',
      quantity: 1,
      selectedVariants: picked,
      sku: product.sku,
    }),
    [product, picked, withColorImage]
  )
  const items = useMemo(() => [item], [item])

  const gov = governorates.find((g) => g.name === form.governorate)
  const shipping = gov ? gov.shipping : null
  const total = item.price + (shipping ?? 0)

  /* «بدأ إتمام الطلب» — زي صفحة الدفع */
  useEffect(() => {
    trackInitiateCheckout(items, item.price)
    trackActivity({ stage: 'checkout', cart: items, kind: 'checkout_open', label: 'طلب من بطاقة المتجر' })
    first.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* بيانات آخر أوردر */
  useEffect(() => {
    let alive = true
    void (async () => {
      const profile = await loadProfile()
      if (!alive || !profile) return
      const saved = profileToForm(profile)
      setForm((prev) => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(saved)) {
          if (v) (next as Record<string, string>)[k] = v as string
        }
        return next
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  /* مراكز المحافظة */
  useEffect(() => {
    if (!form.governorate) {
      setAreas([])
      return
    }
    let alive = true
    setAreasLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/locations?gov=${encodeURIComponent(form.governorate)}`)
        const json = (await res.json()) as { cities: string[] }
        if (alive) setAreas(json.cities ?? [])
      } catch {
        if (alive) setAreas([])
      } finally {
        if (alive) setAreasLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [form.governorate])

  const update = (field: keyof CustomerInfo, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'governorate') next.area = ''
      trackActivity({
        stage: 'filling',
        cart: items,
        lastField: field,
        name: next.fullName,
        email: next.email,
        phone: next.phone,
        governorate: next.governorate,
        area: next.area,
        address: next.address,
      })
      return next
    })
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    setServerError('')
  }

  /* نفس شروط صفحة إتمام الطلب */
  const validate = () => {
    const next: Errors = {}
    if (form.fullName.trim().length < 3) next.fullName = 'اكتب اسمك الكامل'
    if (!form.phone.trim()) next.phone = 'رقم الموبايل مطلوب'
    else if (!isValidEgyptPhone(form.phone)) next.phone = 'الرقم لازم يبدأ بـ 010 أو 011 أو 012 أو 015'
    if (!form.phoneAlt?.trim()) next.phoneAlt = 'الرقم الاحتياطي مطلوب'
    else if (!isValidEgyptPhone(form.phoneAlt)) next.phoneAlt = 'الرقم الاحتياطي مش مظبوط'
    else if (normalizeEgyptPhone(form.phoneAlt) === normalizeEgyptPhone(form.phone))
      next.phoneAlt = 'لازم يكون رقم تاني غير الأساسي'
    if (!form.email?.trim()) next.email = 'الإيميل مطلوب'
    else if (!isValidEmail(form.email)) next.email = 'الإيميل مش مظبوط'
    if (!form.governorate) next.governorate = 'اختار المحافظة'
    if (!form.area) next.area = 'اختار المركز أو الحي'
    if (form.address.trim().length < 10) next.address = 'اكتب العنوان بالتفصيل — الشارع ورقم العقار والدور'
    setErrors(next)
    const firstBad = Object.keys(next)[0]
    if (firstBad) document.getElementById(`qc-${firstBad}`)?.focus()
    return !firstBad
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending || !validate()) return
    setSending(true)
    setServerError('')
    const eventId = makeEventId('purchase')
    const customer = {
      ...form,
      phone: normalizeEgyptPhone(form.phone),
      phoneAlt: form.phoneAlt ? normalizeEgyptPhone(form.phoneAlt) : '',
    }
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, items, metaEventId: eventId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'حصلت مشكلة أثناء إرسال الطلب')
      trackPurchase(items, data.total ?? total, eventId)
      trackOrdered(data.orderId)
      sessionStorage.setItem(
        'atlas_last_order',
        JSON.stringify({ orderId: data.orderId, customer, items, subtotal: item.price, shipping: shipping ?? 0, total: data.total ?? total })
      )
      router.push('/checkout/success')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'حصلت مشكلة — جرّب تاني أو كلّمنا واتساب')
      setSending(false)
    }
  }

  const field = (
    name: keyof CustomerInfo,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {}
  ) => (
    <label className="qc-field" data-error={!!errors[name]}>
      <span>{label}</span>
      <input
        id={`qc-${name}`}
        ref={name === 'fullName' ? first : undefined}
        value={(form[name] as string) ?? ''}
        onChange={(e) => update(name, e.target.value)}
        aria-invalid={!!errors[name]}
        onInvalid={arInvalid}
        onInput={arClear}
        {...props}
      />
      {errors[name] && <em>{errors[name]}</em>}
    </label>
  )

  const variants = Object.entries(picked)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')

  return (
    <form className="qc" onSubmit={submit}>
      <button type="button" className="qc-back" onClick={onBack} disabled={sending}>
        <ArrowRightIcon className="h-3.5 w-3.5" />
        <span>رجوع للمقاس واللون</span>
      </button>

      <div className="qc-item">
        <span>{variants}</span>
        <b className="nums">{formatPrice(item.price)}</b>
      </div>

      <div className="qc-grid">
        {field('fullName', 'الاسم بالكامل', { autoComplete: 'name', required: true, minLength: 3 })}
        {field('phone', 'رقم الموبايل', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', dir: 'ltr', required: true, minLength: 10 })}
        {field('phoneAlt', 'رقم احتياطي', { type: 'tel', inputMode: 'tel', dir: 'ltr', required: true, minLength: 10 })}
        {field('email', 'الإيميل', { type: 'email', inputMode: 'email', autoComplete: 'email', dir: 'ltr', required: true })}

        <label className="qc-field" data-error={!!errors.governorate}>
          <span>المحافظة</span>
          <select id="qc-governorate" required onInvalid={arInvalid} onInput={arClear} value={form.governorate} onChange={(e) => update('governorate', e.target.value)}>
            <option value="">اختار</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
          {errors.governorate && <em>{errors.governorate}</em>}
        </label>

        <label className="qc-field" data-error={!!errors.area}>
          <span>المركز / الحي</span>
          <select
            id="qc-area"
            required
            onInvalid={arInvalid}
            onInput={arClear}
            value={form.area}
            onChange={(e) => update('area', e.target.value)}
            disabled={!form.governorate || areasLoading}
          >
            <option value="">{areasLoading ? 'بيحمّل…' : 'اختار'}</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {errors.area && <em>{errors.area}</em>}
        </label>

        <div className="qc-wide">{field('address', 'العنوان بالتفصيل', { autoComplete: 'street-address', required: true, minLength: 10 })}</div>
        <div className="qc-wide">{field('landmark', 'علامة مميزة (اختياري)')}</div>
      </div>

      <dl className="qc-sum">
        <div>
          <dt>المنتج</dt>
          <dd className="nums">{formatPrice(item.price)}</dd>
        </div>
        <div>
          <dt>الشحن</dt>
          <dd className="nums">{shipping === null ? 'اختار المحافظة' : formatPrice(shipping)}</dd>
        </div>
        <div className="qc-total">
          <dt>الإجمالي · دفع عند الاستلام</dt>
          <dd className="nums">{formatPrice(total)}</dd>
        </div>
      </dl>

      {serverError && (
        <p className="st-card__error" role="alert">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {serverError}
        </p>
      )}

      <button type="submit" className="st-card__add" disabled={sending}>
        {sending ? <SpinnerIcon className="a-spin h-4 w-4" /> : <span>تأكيد الطلب</span>}
      </button>
    </form>
  )
}
