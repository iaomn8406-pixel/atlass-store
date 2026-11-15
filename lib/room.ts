import assets from '@/data/room-assets.json'
import { getCategoryTree, getProductsByCategory } from './catalog'
import type { Product } from './types'

/* ============================================================
   بيانات المتجر الافتراضي
   ------------------------------------------------------------
   قراءة بس — مفيش أي تعديل في قاعدة البيانات. القطع المتعلقة
   جاية من data/room-assets.json اللي بيطلّعه سكربت
   scripts/room-cutouts.py: صورة مقصوصة لكل لون عنده صورة نضيفة.

   المنتج اللي مالوش صورة مقصوصة مابيتعلقش في الأوضة — بيظهر
   عادي في أقسام الصفحة تحت وفي المتجر. مابنعلّقش صورة مستطيلة
   مكانه.
   ============================================================ */

type Asset = {
  src: string
  /** نسخة صغيرة للقضيب — بتتحمّل الأول، والكبيرة لما القطعة تتختار */
  srcSm: string
  /** ظل القطعة متموّه جاهز — بيتحط على الحيطة وراها */
  shadow: string
  /** القطعة متصوّرة على شماعتها الحقيقية — مابنرسمش شماعة */
  ownHanger: boolean
  color: string | null
  w: number
  h: number
  hookX: number
  top: number
  shoulder: number
}

const MANIFEST = assets as Record<string, Asset[]>

/** قطعة واحدة متعلقة على الشماعة */
export type RoomPiece = Asset & {
  /** مفتاح فريد للقطعة: المنتج + اللون */
  id: string
  productId: string
}

/** الحاجات اللي الكارت والسلة محتاجينها من المنتج — من غير الوصف الطويل */
export type RoomProduct = Pick<
  Product,
  | 'id'
  | 'slug'
  | 'name'
  | 'price'
  | 'compareAtPrice'
  | 'images'
  | 'variants'
  | 'inStock'
  | 'category'
  | 'sku'
> & {
  categoryName: string
  /** { "اسود": ["L","XL"] } من فيندور — لقفل المقاس اللي مش متوفر */
  available: Record<string, string[]> | null
}

export type RoomZone = {
  slug: string
  name: string
  pieces: RoomPiece[]
}

export type Room = {
  zones: RoomZone[]
  products: Record<string, RoomProduct>
}

function slim(p: Product, categoryName: string): RoomProduct {
  const available = p.vendoor?.variants
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    images: p.images,
    variants: p.variants,
    inStock: p.inStock,
    category: p.category,
    sku: p.sku,
    categoryName,
    available: available && Object.keys(available).length ? available : null,
  }
}

export async function getRoom(): Promise<Room> {
  const tree = await getCategoryTree()

  const products: Record<string, RoomProduct> = {}
  const zones: RoomZone[] = []

  for (const category of tree) {
    const items = await getProductsByCategory(category.slug)
    const pieces: RoomPiece[] = []

    for (const product of items) {
      const own = MANIFEST[product.slug]
      if (!own?.length) continue

      products[product.id] = slim(product, category.name)

      for (const asset of own) {
        pieces.push({
          ...asset,
          id: `${product.id}::${asset.color ?? asset.src}`,
          productId: product.id,
        })
      }
    }

    if (pieces.length) zones.push({ slug: category.slug, name: category.name, pieces })
  }

  /* أكتر قسم فيه قطع بياخد الحيطة اللي قدام الشعار */
  zones.sort((a, b) => b.pieces.length - a.pieces.length)

  return { zones, products }
}
