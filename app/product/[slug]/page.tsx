import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProductGrid } from '@/components/product/product-card'
import { ProductDetail } from '@/components/product/product-detail'
import { isInRoom } from '@/lib/room'
import { SectionHead } from '@/components/ui/section'
import { SHIPPING_FLAT_RATE } from '@/data/locations'
import {
  getCategoryBySlug,
  getProductBySlug,
  getRelatedProducts,
} from '@/lib/catalog'
import { site } from '@/data/site'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'المنتج غير موجود' }

  const description = product.shortDescription ?? product.description.slice(0, 155)

  return {
    title: product.name,
    description,
    alternates: { canonical: `/product/${slug}` },
    openGraph: {
      title: `${product.name} — ${site.nameFull}`,
      description,
      images: product.images.length ? [product.images[0]] : undefined,
      type: 'website',
    },
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()

  const [category, related] = await Promise.all([
    getCategoryBySlug(product.category),
    getRelatedProducts(product, 8),
  ])

  /* بيانات منظّمة لجوجل — المنتج + مسار التنقّل */
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription ?? product.description,
    sku: product.sku,
    brand: { '@type': 'Brand', name: site.nameFull },
    /* صور فيندور بتيجي بروابط كاملة، وصورنا المحلية بتبدأ بـ / */
    image: product.images.map((img) =>
      img.startsWith('http') ? img : `${site.url}${img}`
    ),
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'EGP',
      availability:
        product.inStock === false
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      url: `${site.url}/product/${product.slug}`,
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: SHIPPING_FLAT_RATE,
          currency: 'EGP',
        },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'EG',
        },
      },
    },
  }

  const crumbsJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: site.url },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'كل المنتجات',
        item: `${site.url}/shop`,
      },
      ...(category
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: category.name,
              item: `${site.url}/category/${category.slug}`,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: category ? 4 : 3,
        name: product.name,
        item: `${site.url}/product/${product.slug}`,
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([productJsonLd, crumbsJsonLd]),
        }}
      />

      {/* اسم المنتج بيظهر مرة واحدة بس (جنب الصورة) — هنا سطر التنقل بس */}
      <nav aria-label="مسار الصفحة" className="shell pt-6 text-[12.5px] text-mist lg:pt-8">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-foam">الرئيسية</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/shop" className="hover:text-foam">كل المنتجات</Link>
          </li>
          {category && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/category/${category.slug}`} className="hover:text-foam">{category.name}</Link>
              </li>
            </>
          )}
        </ol>
        {/* بيفتح الغرفة على نفس القطعة ببطاقتها — للمنتجات المتعلّقة في المعرض بس */}
        {isInRoom(product.slug) && (
          <Link href={`/?piece=${encodeURIComponent(product.slug)}`} className="wsign__back mt-3">
            شوفه في المعرض
          </Link>
        )}
      </nav>

      <ProductDetail product={product} category={category} />

      {/* كمّل الطقم: قطع من أقسام تانية تتلبس معاه */}
      {related.some((p) => p.category !== product.category) && (
        <section className="shell pb-12 lg:pb-16">
          <SectionHead eyebrow="Complete The Look" title="كمّل الطقم" href="/shop" />
          <ProductGrid products={related.filter((p) => p.category !== product.category).slice(0, 4)} />
        </section>
      )}

      {related.some((p) => p.category === product.category) && (
        <section className="shell pb-20 lg:pb-28">
          <SectionHead
            eyebrow="Same Section"
            title="من نفس القسم"
            href={category ? `/category/${category.slug}` : '/shop'}
          />
          <ProductGrid products={related.filter((p) => p.category === product.category).slice(0, 4)} />
        </section>
      )}
    </>
  )
}
