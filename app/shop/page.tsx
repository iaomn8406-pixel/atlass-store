import type { Metadata } from 'next'
import { PageHeader } from '@/components/layout/page-header'
import { GalleryProvider, type GalleryAsset } from '@/components/product/gallery-piece'
import { ShopBrowser } from '@/components/shop/shop-browser'
import assets from '@/data/room-assets.json'
import { site } from '@/data/site'
import { getCategories, getProducts } from '@/lib/catalog'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'كل المنتجات',
  description: `تصفّح مجموعة ${site.nameFull} كاملة — ملابس رجالي بخامات مختارة وأسعار واضحة، والدفع عند الاستلام.`,
  alternates: { canonical: '/shop' },
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sale?: string; preview?: string }>
}) {
  const [params, products, categories] = await Promise.all([
    searchParams,
    getProducts(),
    getCategories(),
  ])

  const saleOnly = params.sale === '1'

  /* عينة «عالم المعرض» — مستنية موافقة صاحب المشروع قبل التعميم.
     بتظهر بس مع ?preview=gallery؛ الصفحة العادية زي ما هي. */
  const gallery: Record<string, GalleryAsset> = {}
  if (params.preview === 'gallery') {
    const SAMPLE: Record<string, string> = {
      'massimo-dutti-oversize': '/room/massimo-dutti-oversize--white.webp',
      'loewe-mens-tshirt': '/room/loewe-mens-tshirt--black.webp',
      'hooded-embroidered-abaya': '/room/hooded-embroidered-abaya--white.webp',
    }
    const manifest = assets as Record<string, { src: string; srcSm: string; shadow: string; w: number; h: number; hookX: number }[]>
    for (const [slug, src] of Object.entries(SAMPLE)) {
      const a = manifest[slug]?.find((x) => x.src === src)
      if (!a) continue
      const sh = Math.min(1, 420 / a.h)
      gallery[slug] = {
        src: a.srcSm.replace('-sm.webp', '-lit.webp'),
        shadow: a.shadow,
        w: Math.round(a.w * sh),
        h: Math.round(a.h * sh),
        hookX: a.hookX,
      }
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="All Products"
        title={saleOnly ? 'العروض' : 'كل المنتجات'}
        description={
          saleOnly
            ? 'القطع اللي عليها خصم دلوقتي — نفس الخامة ونفس القصّة بسعر أقل.'
            : 'المجموعة كاملة. فلتر حسب القسم أو السعر ورتّب زي ما يريحك عشان توصل بسرعة للي بتدوّر عليه.'
        }
        aside={
          <div className="card px-5 py-4 text-center">
            <p className="nums display grad-text text-[26px] font-bold">
              {products.length}
            </p>
            <p className="mt-1 text-[11px] text-mist">قطعة في المجموعة</p>
          </div>
        }
      />

      <div className="shell py-10 lg:py-14">
        <GalleryProvider assets={gallery}>
          <ShopBrowser
            products={products}
            categories={categories}
            initialCategory={params.category ?? ''}
            initialSaleOnly={saleOnly}
          />
        </GalleryProvider>
      </div>
    </>
  )
}
