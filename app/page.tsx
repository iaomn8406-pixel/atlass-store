import { VirtualStore } from '@/components/store/virtual-store'
import { site } from '@/data/site'
import { getGovernorateOptions } from '@/lib/locations'
import { getRoom } from '@/lib/room'

/* ============================================================
   الرئيسية = المتجر الافتراضي نفسه
   ------------------------------------------------------------
   مفيش بانرات ولا أقسام تسويقية تحت الأوضة. كل المنتجات ليها
   روابط حقيقية جوه المتجر (ولقارئ الشاشة ومحركات البحث)، و/shop
   و/category/* لسه موجودين للتصفّح العادي.

   الواجهة القديمة محفوظة في تاريخ git (main قبل الفرع ده).
   ============================================================ */

/* الصفحة بتتبني كل ساعة أو أول ما تعدّل حاجة من اللوحة */
export const revalidate = 3600

export default async function HomePage() {
  const [room, governorates] = await Promise.all([
    getRoom(),
    /* المحافظات للطلب من البطاقة — نفس اللي صفحة إتمام الطلب بتستخدمه */
    getGovernorateOptions().catch(() => []),
  ])
  const products = Object.values(room.products)

  /* قايمة المنتجات اللي في المتجر — بيانات منظّمة لجوجل */
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: site.nameFull,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${site.url}/product/${p.slug}`,
      name: p.name,
    })),
  }

  return (
    <>
      <h1 className="sr-only">{site.nameFull} — المتجر الافتراضي</h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
      <VirtualStore room={room} governorates={governorates} />
    </>
  )
}
