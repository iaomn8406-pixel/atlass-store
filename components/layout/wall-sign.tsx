import Link from 'next/link'

/* ============================================================
   لافتة معلّقة بخيطين (بدل العدّاد الزجاجي) + زرار الرجوع للمعرض
   ------------------------------------------------------------
   نفس عالم المعرض: لافتة صغيرة متعلّقة من السكة فيها عدد القطع،
   وزرار بيفتح الغرفة على نفس القسم (/?zone=slug).
   ============================================================ */
export function WallSign({
  count,
  label,
  zone,
}: {
  count: number
  label: string
  /** القسم في المعرض — لو موجود بيظهر زرار «العودة للقسم في المعرض» */
  zone?: string
}) {
  return (
    <div className="wsign">
      <div className="wsign__board" role="note" aria-label={`${count} ${label}`}>
        <span className="wsign__strings" aria-hidden="true" />
        <b className="nums">{count}</b>
        <span>{label}</span>
      </div>
      {zone !== undefined && (
        <Link href={zone ? `/?zone=${encodeURIComponent(zone)}` : '/'} className="wsign__back">
          {zone ? 'العودة للقسم في المعرض' : 'افتح المعرض'}
        </Link>
      )}
    </div>
  )
}
