/* ============================================================
   مشهد المتجر الافتراضي — WebGL (three.js)
   ------------------------------------------------------------
   ليه WebGL مش CSS 3D:
   • أوضة حقيقية: أرضية وركن وعمق وكاميرا بزاوية رؤية — مش طبقات
     HTML متلفّة يرسمها كل متصفح بطريقته (اللي خلّى القطع تختفي قبل كده).
   • الصور بـ mipmaps: القطعة بتفضل حادة لما الكاميرا تقرّب.
   • الكاميرا بتلف وتقرّب وتبعد جوه الأوضة نفسها.

   المشهد ده "عرض" بس: الضغط والكيبورد وقارئ الشاشة كلهم على
   أزرار DOM حقيقية فوق الكانفاس (المشهد بيقول لها مكان كل قطعة
   على الشاشة). مفيش raycasting ولا منطق متجر هنا.

   الوحدة: متر.
   ============================================================ */
import {
  BackSide,
  Box3,
  BufferAttribute,
  FrontSide,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
} from 'three'

/* ---------------- البيانات اللي داخلة ---------------- */
export type ScenePiece = {
  id: string
  productId: string
  src: string
  srcSm: string
  shadow: string
  ownHanger: boolean
  w: number
  h: number
  hookX: number
  top: number
  shoulder: number
  fold?: { src: string; w: number; h: number; clipY: number; clipX0: number; clipX1: number }
  /** متصوّرة من فوق (طقم متطبّق) — بتتحط نايمة على ترابيزة بعرضها الحقيقي */
  flat?: { span: number }
  /** لون القماش الأساسي — للمعاينة بلون مالوش صورة */
  base?: number[]
  /** خريطة عمق (رمادي): قد إيه كل نقطة في القطعة بارزة — عشان تبقى مجسّمة */
  depth?: string
  /** خط القماش من فوق (٤١ نقطة على عرض الصورة، كنسبة من الارتفاع) — الشماعة بتترسم تحته */
  rim?: number[]
  /** طقم من قطعتين مفرودين (تيشيرت + بنطلون) بيتطبقوا على الترابيزة ويتفردوا عند الاختيار */
  foldSet?: { tee: FoldSpec; pants: FoldSpec }
  /** عينة «قماش مجسّم»: القطعة المتعلّقة ليها وش وضهر وسُمك بيلفّ عند الحواف */
  volume?: boolean
  /** عينة: نفس القطعة متطبّقة (صورة من فوق) — بتتحط على الترابيزة. span = عرضها بالمتر */
  folded?: { src: string; w: number; h: number; span: number }
}

/** قطعة مفرودة متصوّرة من فوق + خطوط طيّها (نِسَب من الصورة) */
export type FoldSpec = {
  src: string
  srcSm: string
  w: number
  h: number
  /** خطوط الطي الرأسية (u) — العمود رقم anchor بيفضل قدّام والباقي بيتطبق لورا */
  cuts: number[]
  anchor: number
  /** خط الطي الأفقي (v): النص التحتاني بيتطبق لورا */
  foldV: number
  top: number
  bottom: number
  /** بكسل لكل متر */
  ppm: number
}

export type SceneZone = {
  slug: string
  name: string
  kind: 'top' | 'long' | 'set'
  pieces: ScenePiece[]
}

export type Rect = { x: number; y: number; w: number; h: number }

export type SceneOptions = {
  zones: SceneZone[]
  logo: string
  brand: string
  reducedMotion: boolean
  /** المشهد بيبعت مكان كل قطعة على الشاشة (null = مش ظاهرة) */
  onRects: (rects: Map<string, Rect | null>) => void
  /** قطعة اتحمّلت صورتها وظهرت */
  onPieceReady: (id: string) => void
  /** بدأت/خلصت حركة كاميرا */
  onMotion: (moving: boolean) => void
}


/* ---------------- أبعاد الأوضة ---------------- */
const ROOM_W = 9.6
const ROOM_D = 10
const ROOM_H = 3.4
const BACK_Z = -ROOM_D / 2

/* المقاسات الحقيقية للعرض */
const SHOULDER_M = 0.47 // عرض كتف تيشيرت رجالي
const LONG_M = 1.42 // طول العباية (كل ألوان نفس المنتج بنفس الطول)
const RAIL_Z = 0.17 // بُعد القضيب عن الحيطة
const HOOK_DROP = 0.085 // من القضيب لكتف الشماعة
const GAP = 0.09 // مسافة بين القطع على القضيب
const SET_GAP = 0.08 // بين تيشيرت الطقم وبنطلونه
/* ترابيزة الطقم */
const TABLE_Y = 0.86

/* ---------------- ألوان (مأخوذة من كادر المرجع: أوضة فاتحة دافية) ---------------- */
const WALL = '#e7e3dd'
const FLOOR = '#d5d0c8'

/* ============================================================ */

type Slot = {
  /** واقف في الأوضة (مش على حيطة): ستاند أو ترابيزة */
  free?: boolean
  /** نقطة على الحيطة عند الأرض */
  origin: Vector3
  /** يمين الواقف قدام الحيطة */
  right: Vector3
  /** خارج من الحيطة للأوضة */
  normal: Vector3
  /** دوران المجموعة حوالين المحور الرأسي */
  yaw: number
}

/** مكان واقف في الأوضة متلفّ بزاوية yaw ناحية نص المحل */
function freeSlot(x: number, z: number, yaw: number): Slot {
  return {
    origin: new Vector3(x, 0, z),
    right: new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    normal: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
    yaw,
    free: true,
  }
}

const SLOTS: Record<string, Slot> = {
  // ستاند العبايات يمين، وترابيزة الأطقم شمال — الاتنين واقفين على الأرض ومتلفّين ناحيتك
  rack: freeSlot(2.75, -2.35, -0.6),
  island: freeSlot(-3.25, -3.0, 0.6),
  back: { origin: new Vector3(0, 0, BACK_Z), right: new Vector3(1, 0, 0), normal: new Vector3(0, 0, 1), yaw: 0 },
  right: { origin: new Vector3(ROOM_W / 2, 0, -3.15), right: new Vector3(0, 0, 1), normal: new Vector3(-1, 0, 0), yaw: -Math.PI / 2 },
  left: { origin: new Vector3(-ROOM_W / 2, 0, -3.15), right: new Vector3(0, 0, -1), normal: new Vector3(1, 0, 0), yaw: Math.PI / 2 },
  backRight: { origin: new Vector3(3.6, 0, BACK_Z), right: new Vector3(1, 0, 0), normal: new Vector3(0, 0, 1), yaw: 0 },
  front: { origin: new Vector3(0, 0, ROOM_D / 2), right: new Vector3(-1, 0, 0), normal: new Vector3(0, 0, -1), yaw: Math.PI },
}

/** كل نوع عنده حيطة مفضّلة؛ لو اتاخدت بياخد اللي بعدها */
const PREFER: Record<SceneZone['kind'], string[]> = {
  top: ['back', 'backRight', 'front', 'right', 'left'],
  long: ['right', 'backRight', 'front', 'left', 'back'],
  set: ['left', 'backRight', 'front', 'right', 'back'],
}

type Shot = { pos: Vector3; target: Vector3; fov: number }

type LaidPiece = ScenePiece & {
  zone: string
  /** موضع الخطاف على القضيب (محلي في مجموعة القسم) */
  x: number
  /** مقاس القطعة بالمتر */
  mw: number
  mh: number
  /** الجسم كله (قطعة + شماعة + ظل) */
  group: Group
  body: Mesh
  ready: boolean
  /** إزاحة لما قطعة جنبها تتختار */
  spread: number
  spreadTo: number
  lift: number
  liftTo: number
  /** الصندوق اللي بيتحسب منه مكان الزرار (محلي) */
  box: { x0: number; x1: number; y0: number; y1: number; z: number }
  /** الأجسام اللي بيتحسب منها مكان الزرار على الشاشة */
  hits: Object3D[]
  /** متحطّة على ترابيزة (الكاميرا من فوق) */
  onTable: boolean
  tint: Tint
  /** الجيران بيغمقوا شوية وقت اختيار قطعة */
  dim: number
  dimTo: number
  baseColor: Color
  tintTo: number
  /** خامات تانية بتغمق مع الجسم (قطع الطقم) */
  dimMats?: { mat: MeshBasicMaterial; base: Color }[]
  /** الطقم المطوي: ٠ مطوي ← ١ مفرود */
  folding?: { s: number; apply: (s: number) => void }
  /** الطقم واقف مفرود: مكان وحجم الكادر (محلي في مجموعة القسم، x نسبةً للقطعة) */
  stand?: { x: number; y: number; z: number; w: number; h: number }
}

type LaidZone = Omit<SceneZone, 'pieces'> & {
  depth: number
  tableZ: number
  slot: Slot
  group: Group
  pieces: LaidPiece[]
  width: number
  top: number
  bottom: number
}

/* ---------------- أدوات ---------------- */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function cssFont(variable: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return v || fallback
}

/** تدرّج إضاءة مخبوز للحيطة: أفتح في النص وفوق، وأغمق عند الأرض والأركان */
function wallTexture(w: number, h: number, tint: string) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = tint
  g.fillRect(0, 0, c.width, c.height)
  // ضوء هادي من فوق
  const top = g.createRadialGradient(256, -40, 20, 256, 60, 420)
  top.addColorStop(0, 'rgba(255,255,255,0.38)')
  top.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = top
  g.fillRect(0, 0, c.width, c.height)
  // ظل تلامس عند الأرض
  const floor = g.createLinearGradient(0, c.height, 0, c.height * 0.55)
  floor.addColorStop(0, 'rgba(60,52,40,0.16)')
  floor.addColorStop(1, 'rgba(60,52,40,0)')
  g.fillStyle = floor
  g.fillRect(0, 0, c.width, c.height)
  // الأركان
  for (const side of [0, 1]) {
    const x = side ? c.width : 0
    const cg = g.createLinearGradient(x, 0, side ? c.width - 70 : 70, 0)
    cg.addColorStop(0, 'rgba(60,52,40,0.13)')
    cg.addColorStop(1, 'rgba(60,52,40,0)')
    g.fillStyle = cg
    g.fillRect(0, 0, c.width, c.height)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  void w
  void h
  return t
}

function floorTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = FLOOR
  g.fillRect(0, 0, 512, 512)
  // انعكاس خفيف جدًا للضوء في النص — مش أقوى من اللي في المرجع
  const r = g.createRadialGradient(256, 200, 10, 256, 240, 330)
  r.addColorStop(0, 'rgba(255,255,255,0.32)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 512, 512)
  // ظل عند الحيطان
  const edges: [number, number, number, number][] = [
    [0, 0, 0, 60],
    [0, 512, 0, 452],
    [0, 0, 60, 0],
    [512, 0, 452, 0],
  ]
  for (const [x0, y0, x1, y1] of edges) {
    const e = g.createLinearGradient(x0, y0, x1, y1)
    e.addColorStop(0, 'rgba(60,52,40,0.18)')
    e.addColorStop(1, 'rgba(60,52,40,0)')
    g.fillStyle = e
    g.fillRect(0, 0, 512, 512)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** اسم القسم على الحيطة: حروف غامقة + خط سماوي صغير تحتها */
function labelTexture(text: string, font: string) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 300
  const g = c.getContext('2d')!
  g.font = `700 150px ${font}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.direction = 'rtl'
  g.fillStyle = '#1b1f29'
  g.fillText(text, 512, 130)
  g.fillStyle = '#1aa5d8'
  g.fillRect(452, 252, 120, 10)
  const texture = new CanvasTexture(c)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: c.width / c.height, dispose: () => texture.dispose() }
}

/** شعار الحيطة: علامة أطلس + ATLASs + STORE */
async function logoTexture(src: string, brand: string, font: string) {
  const mark = await new Promise<HTMLImageElement | null>((res) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => res(null)
    i.src = src
  })
  const c = document.createElement('canvas')
  c.width = 1400
  c.height = 360
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  const markH = 250
  const markW = mark ? (mark.width / mark.height) * markH : 0
  g.font = `800 200px ${font}`
  g.direction = 'ltr'
  const textW = g.measureText(brand).width
  const total = markW + 40 + textW
  let x = (c.width - total) / 2
  if (mark) g.drawImage(mark, x, 40, markW, markH)
  x += markW + 40
  g.fillStyle = '#0d47a8'
  g.textBaseline = 'alphabetic'
  g.fillText(brand, x, 245)
  g.font = `600 48px ${font}`
  g.fillStyle = '#1aa5d8'
  const label = 'S T O R E'
  g.fillText(label, x + textW - g.measureText(label).width, 320)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return { texture: t, aspect: c.width / c.height }
}

/**
 * جسم القطعة: سطح منحني شوية (النص لقدام والجناب لورا) زي ما
 * القماش بيقع على الشماعة — والجناب أغمق شوية من الإضاءة.
 * الصورة نفسها مابتتغيّرش: الألوان بالظبط زي الأصل في النص.
 */
function bodyGeometry(w: number, h: number, bend: number) {
  const seg = 64
  const geo = new PlaneGeometry(w, h, seg, Math.max(8, Math.round(seg * (h / w))))
  const pos = geo.attributes.position as BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (w / 2) // -1..1
    pos.setZ(i, bend * (1 - u * u))
    const shade = 1 - 0.13 * Math.pow(Math.abs(u), 2.2)
    colors.set([shade, shade, shade], i * 3)
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

/* ---------------- معاينة لون مالوش صورة ----------------
   القماش بس هو اللي بيتلوّن: كل بكسل بنقارن «درجة لونه» (اللون بعد
   ما نشيل الإضاءة) بلون القماش الأساسي. اللي شبهه بياخد اللون الجديد
   بنفس إضاءته وظله وكسراته (اللون × نسبة الإضاءة). الطباعة والتطريز
   واللوجو مختلفين في الدرجة أو أفتح/أغمق بكتير → بيفضلوا زي ما هم. */
/* تحويل sRGB خطي ⇄ CIE Lab (D65) جوه الشيدر */
const LAB_GLSL = `
vec3 atlasLab(vec3 c) {
  vec3 x = mat3(0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505) * c;
  x /= vec3(0.95047, 1.0, 1.08883);
  vec3 f = mix(7.787 * x + 16.0 / 116.0, pow(max(x, vec3(1e-6)), vec3(1.0 / 3.0)), step(vec3(0.008856), x));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 atlasRgb(vec3 l) {
  float fy = (l.x + 16.0) / 116.0;
  vec3 f = vec3(fy + l.y / 500.0, fy, fy - l.z / 200.0);
  vec3 x = mix((f - 16.0 / 116.0) / 7.787, f * f * f, step(vec3(0.206893), f));
  x *= vec3(0.95047, 1.0, 1.08883);
  return mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * x;
}
`

type Tint = { uTint: { value: number }; uBase: { value: Color }; uTarget: { value: Color } }

function recolorable(mat: MeshBasicMaterial | MeshLambertMaterial): Tint {
  const u: Tint = { uTint: { value: 0 }, uBase: { value: new Color() }, uTarget: { value: new Color() } }
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.fragmentShader =
      'uniform float uTint;\nuniform vec3 uBase;\nuniform vec3 uTarget;\n' +
      LAB_GLSL +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (uTint > 0.001) {
          vec3 c = diffuseColor.rgb;
          vec3 L = atlasLab(c);
          vec3 B = atlasLab(uBase);
          vec3 T = atlasLab(uTarget);
          // القماش = نفس درجة لون القماش وفي حدود ظلاله (مش طباعة ولا تطريز)
          float dab = length(L.yz - B.yz);
          float dl = abs(L.x - B.x);
          float w = (1.0 - smoothstep(10.0, 24.0, dab)) * (1.0 - smoothstep(26.0, 44.0, dl));
          // الكسرات والظل بيتنقلوا زي ما هم (فرق الإضاءة)، واللون بس اللي بيتغيّر
          float gain = mix(0.55, 1.0, clamp(T.x / 70.0, 0.0, 1.0));
          vec3 N = vec3(clamp(T.x + (L.x - B.x) * gain, 0.0, 100.0), T.yz + (L.yz - B.yz) * 0.35);
          vec3 rec = max(atlasRgb(N), 0.0);
          diffuseColor.rgb = mix(c, rec, w * uTint);
        }`
      )
  }
  mat.customProgramCacheKey = () => 'atlas-recolor'
  return u
}

/* ---------------- حجم حقيقي للقطعة ----------------
   سطح القطعة كشبكة كثيفة بتبرز حسب خريطة العمق: الجسم لقدّام والحواف
   بتدوّر. الإضاءة بتقع على السطح ده بجد (ضل على الجناب ونور على اللي
   بارز)، ولما الكاميرا تلف القطعة بتبان مجسّمة — مش ورقة. الصورة
   نفسها (الألوان والتفاصيل) زي ما هي. */
const depthCache = new Map<string, Promise<{ w: number; h: number; data: Uint8ClampedArray } | null>>()

function loadDepth(src: string) {
  let p = depthCache.get(src)
  if (!p) {
    p = new Promise((res) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(img, 0, 0)
        res({ w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data })
      }
      img.onerror = () => res(null)
      img.src = src
    })
    depthCache.set(src, p)
  }
  return p
}

/** بيزق رؤوس الشبكة لقدّام (+z المحلي) حسب العمق — amount بالمتر */
function inflate(geo: PlaneGeometry, w: number, h: number, depth: { w: number; h: number; data: Uint8ClampedArray }, amount: number) {
  const pos = geo.attributes.position as BufferAttribute
  const sample = (u: number, v: number) => {
    const x = Math.min(depth.w - 1, Math.max(0, u * (depth.w - 1)))
    const y = Math.min(depth.h - 1, Math.max(0, v * (depth.h - 1)))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(depth.w - 1, x0 + 1)
    const y1 = Math.min(depth.h - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const at = (xx: number, yy: number) => depth.data[(yy * depth.w + xx) * 4] / 255
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
  }
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5
    const v = 0.5 - pos.getY(i) / h
    pos.setZ(i, pos.getZ(i) + sample(u, v) * amount)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
}

/* ---------------- قماش مجسّم (عينة على قطعة واحدة) ----------------
   الشكل من القطعة نفسها (شفافية صورتها): المسافة من حرف القماش هي
   اللي بتحدد السُمك — عند الحرف القماش بيلفّ لورا ويرفع، وفي الجسم
   مليان. وش لقدّام وضهر لورا بيتقفلوا عند الحرف، فمن الجنب القطعة ليها
   سُمك حقيقي ومش ورقة، والكُم (أضيق من الجسم) بيبان لوحده. تحت الصدر
   ثنيات سقوط خفيفة ومش منتظمة. الضل متخزّن في ألوان الرؤوس (اللي بيلفّ
   لورا أغمق، وجناب الثنيات بتاخد نور وضل) — والصورة نفسها (اللون
   واللوجو) زي ما هي بالظبط في الأماكن المستوية. */
type Img = CanvasImageSource & { width: number; height: number }

function fabricDistance(img: Img, gw: number, gh: number) {
  const c = document.createElement('canvas')
  c.width = gw
  c.height = gh
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, gw, gh)
  const a = g.getImageData(0, 0, gw, gh).data
  const d = new Float32Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) d[i] = a[i * 4 + 3] > 127 ? 1e9 : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : d[y * gw + x])
  // مسافة chamfer (٣ للجنب، ٤ للقطري) — باسين قدّام وورا
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  for (let y = gh - 1; y >= 0; y--)
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x
      if (!d[i]) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3 // بالبكسل
  // المسافة لأقرب حرف في نفس الصف بس (يمين/شمال) — للذيل: عشان يفضل ليه سُمك ومايتقفلش
  const dh = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    let last = -1e9
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      if (a[i * 4 + 3] > 127) dh[i] = x - last
      else last = x
    }
    last = 1e9
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x
      if (a[i * 4 + 3] > 127) dh[i] = Math.min(dh[i], last - x)
      else last = x
    }
  }
  // نص عرض الجسم (تحت الأكمام): أعرض صف متصل في الثلث التحتاني
  let body = 0
  for (let y = Math.round(gh * 0.6); y < Math.round(gh * 0.85); y++) {
    let n = 0
    for (let x = 0; x < gw; x++) if (a[(y * gw + x) * 4 + 3] > 127) n++
    body = Math.max(body, n)
  }
  return { d, dh, bodyHalf: body / 2 / gw }
}

function shellGeometry(img: Img, w: number, h: number, bend: number, long: boolean) {
  const gw = 160
  const gh = Math.max(8, Math.round(gw * (h / w)))
  const { d: dist, dh, bodyHalf } = fabricDistance(img, gw, gh)
  const pxM = w / gw
  const sample = (u: number, v: number, field = dist) => {
    const x = Math.min(gw - 1, Math.max(0, u * (gw - 1)))
    const y = Math.min(gh - 1, Math.max(0, v * (gh - 1)))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(gw - 1, x0 + 1)
    const y1 = Math.min(gh - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    const q = (xx: number, yy: number) => field[yy * gw + xx]
    return ((q(x0, y0) * (1 - fx) + q(x1, y0) * fx) * (1 - fy) + (q(x0, y1) * (1 - fx) + q(x1, y1) * fx) * fy) * pxM
  }
  const R = long ? 0.05 : 0.04 // عرض لفّة الحرف
  // تيشيرت متعلّق: وش + ضهر + هوا بينهم ≈ ٤–٥ سم عند الصدر، وأرفع شوية عند الذيل
  const T = long ? 0.02 : 0.025 // الوش لقدّام (الصدر)
  const TB = long ? 0.014 : 0.019 // الضهر لورا (الصدر)
  const seg = 120
  const rows = Math.max(12, Math.round(seg * (h / w)))
  const half = bodyHalf * w // نص عرض الجسم بالمتر
  const make = (sign: 1 | -1) => {
    const geo = new PlaneGeometry(w, h, seg, rows)
    const pos = geo.attributes.position as BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const u = x / w + 0.5
      const v = 0.5 - y / h
      // عند الذيل: السُمك من الجناب بس — الذيل نفسه مفتوح وليه سُمك (مش حرف رفيع)
      const hem = long ? 0 : Math.max(0, Math.min(1, (v - 0.72) / 0.2))
      const kFull = Math.min(1, sample(u, v) / R)
      const kSide = Math.min(1, sample(u, v, dh) / R)
      const k = kFull + (Math.max(kFull, kSide) - kFull) * hem
      // السُمك بيقل بالراحة من الصدر للذيل (القماش بيقع بوزنه)
      const taper = 1 - 0.3 * Math.max(0, Math.min(1, (v - 0.35) / 0.6))
      const roll = (1 - (1 - k) * (1 - k)) * taper
      // الكُم: بيطلع لقدّام شوية كل ما يبعد عن الجسم (مش لازق في نفس مستوى الصدر)
      const out = Math.max(0, Math.abs(x) - half)
      const sleeve = long ? 0 : Math.min(1, out / 0.03) * Math.min(0.016, out * 0.12) * (v < 0.55 ? 1 : 0)
      // ثنيات السقوط: بتبدأ تحت الإبط وبتكبر لتحت، وطولها مش منتظم
      const fall = Math.max(0, Math.min(1, (v - 0.25) / 0.65))
      const drape =
        roll *
        Math.sqrt(fall) *
        (0.0062 * Math.sin((x / 0.083) * Math.PI * 2 + 0.7 + v * 1.3) + 0.0038 * Math.sin((x / 0.137) * Math.PI * 2 + 2.1 - v * 0.8))
      const curve = bend * 0.5 * (1 - (2 * x / w) ** 2)
      pos.setZ(i, curve + drape + sleeve + sign * (sign > 0 ? T : TB) * roll)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    // ضل متخزّن: نور جاي من فوق شمال وقدّام
    const nrm = geo.attributes.normal as BufferAttribute
    const L = new Vector3(-0.32, 0.5, 0.8).normalize()
    const flat = L.z
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const nx = nrm.getX(i) * sign
      const ny = nrm.getY(i)
      const nz = nrm.getZ(i) * sign
      const s = Math.max(0, nx * L.x + ny * L.y + nz * L.z) / flat
      const shade = Math.max(0.6, Math.min(1, 0.5 + 0.5 * s)) * (sign > 0 ? 1 : 0.86)
      col.set([shade, shade, shade], i * 3)
    }
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }
  return { front: make(1), back: make(-1) }
}

/**
 * قطعة متطبّقة نايمة على الترابيزة: الوش مستوي والحواف بتلفّ لتحت بسُمك
 * الطيّة (~٢٫٥ سم) — من زاوية الكاميرا بتبان كتلة قماش مش ورقة. الضل
 * متخزّن في ألوان الرؤوس (النور من فوق)، والصورة نفسها زي ما هي في النص.
 */
function foldedGeometry(img: Img, w: number, d: number) {
  const gw = 120
  const gh = Math.max(8, Math.round(gw * (d / w)))
  const { d: dist } = fabricDistance(img, gw, gh)
  const pxM = w / gw
  const at = (x: number, y: number) => dist[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))]
  const sample = (u: number, v: number) => {
    const x = Math.min(gw - 1, Math.max(0, u * (gw - 1)))
    const y = Math.min(gh - 1, Math.max(0, v * (gh - 1)))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    return ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy) * pxM
  }
  const R = 0.016 // لفّة حرف الطيّة
  const T = 0.024 // سُمك الطيّة
  const seg = 150
  const rows = Math.max(12, Math.round(seg * (d / w)))
  const geo = new PlaneGeometry(w, d, seg, rows)
  const pos = geo.attributes.position as BufferAttribute
  const uv = geo.attributes.uv as BufferAttribute
  // لون الجنب = لون القماش اللي جوه الحرف بشوية (مش البكسلات الأخيرة متمطوطة)
  const uv1 = new Float32Array(uv.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5
    const v = 0.5 - pos.getY(i) / d
    const dm = sample(u, v)
    const k = Math.min(1, dm / R)
    pos.setZ(i, T * Math.sqrt(1 - (1 - k) * (1 - k)))
    let su = uv.getX(i)
    let sv = uv.getY(i)
    const shift = Math.max(0, R * 0.8 - dm)
    if (shift > 0) {
      const gx0 = Math.round(u * (gw - 1))
      const gy0 = Math.round(v * (gh - 1))
      let gx = at(gx0 + 2, gy0) - at(gx0 - 2, gy0)
      let gy = at(gx0, gy0 + 2) - at(gx0, gy0 - 2)
      const gl = Math.hypot(gx, gy)
      if (gl > 1e-6) {
        gx /= gl
        gy /= gl
        su += (gx * shift) / w
        sv -= (gy * shift) / d
      }
    }
    uv1[i * 2] = su
    uv1[i * 2 + 1] = sv
  }
  geo.setAttribute('uv1', new BufferAttribute(uv1, 2))
  pos.needsUpdate = true
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal as BufferAttribute
  // النور من فوق وناحية الكاميرا (بإحداثيات القطعة قبل ما تنام: z = لفوق)
  const L = new Vector3(-0.25, -0.35, 0.9).normalize()
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const s = Math.max(0, nrm.getX(i) * L.x + nrm.getY(i) * L.y + nrm.getZ(i) * L.z) / L.z
    const shade = Math.max(0.58, Math.min(1, 0.45 + 0.55 * s)) * 0.97
    col.set([shade, shade, shade], i * 3)
  }
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** ضهر القطعة: لون القماش الأساسي بس (من غير اللوجو المعكوس) وبنفس حدودها */
function shellBackMaterial(map: Texture, base: number[] | undefined) {
  const m = new MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, side: DoubleSide, vertexColors: true })
  const tone = new Color().setRGB(...((base ?? [230, 230, 230]).map((c) => c / 255) as [number, number, number]), SRGBColorSpace)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBack = { value: tone }
    sh.fragmentShader =
      'uniform vec3 uBack;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = uBack;')
  }
  m.customProgramCacheKey = () => 'atlas-shell-back'
  return m
}

/* ---------------- شماعة خشب ثلاثية الأبعاد ---------------- */
const woodMat = new MeshLambertMaterial({ color: '#b98048' })
const metalMat = new MeshLambertMaterial({ color: '#a9aeb5', emissive: '#2a2d31' })

/**
 * الخطاف: طالع من وسط الشماعة لفوق، ولافف حوالين القضيب لفّة واضحة
 * (قدّام القضيب ← فوقه ← وراه ونازل) — نفس الشكل على كل القطع.
 * dz = مكان القضيب بالنسبة للشماعة (لقدّام موجب).
 */
function hookCurve(from: number, dz: number) {
  const R = 0.011 + 0.0065 // نص قطر القضيب + خلوص
  const cy = HOOK_DROP
  return new CatmullRomCurve3([
    new Vector3(0, from, 0),
    new Vector3(0, (from + cy) * 0.5, dz * 0.5),
    new Vector3(0, cy - R * 0.95, dz + R * 0.55),
    new Vector3(0, cy, dz + R),
    new Vector3(0, cy + R * 0.72, dz + R * 0.7),
    new Vector3(0, cy + R, dz),
    new Vector3(0, cy + R * 0.7, dz - R * 0.72),
    new Vector3(0, cy, dz - R),
    new Vector3(0, cy - R * 0.55, dz - R * 0.8),
  ])
}

/** arm: نقط ذراع الشماعة (محلي) — لو مفيش، ذراع عادي بعرض span */
function hanger(span: number, dz: number, arm?: Vector3[]) {
  const g = new Group()
  const half = span / 2
  const pts = arm ?? [
    new Vector3(-half, -0.055, 0),
    new Vector3(-half * 0.5, -0.022, 0),
    new Vector3(0, -0.004, 0),
    new Vector3(half * 0.5, -0.022, 0),
    new Vector3(half, -0.055, 0),
  ]
  g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 32, 0.0105, 8, false), woodMat))
  const mid = pts[Math.floor(pts.length / 2)].y
  g.add(new Mesh(new TubeGeometry(hookCurve(mid, dz), 40, 0.0028, 6, false), metalMat))
  return g
}

/** شماعة بنطلون: بار معدن + مشبكين على الوسط + نفس الخطاف */
function clipHanger(span: number) {
  const g = new Group()
  const bar = new Mesh(new CylinderGeometry(0.0045, 0.0045, span, 10), metalMat)
  bar.rotation.z = Math.PI / 2
  g.add(bar)
  for (const sx of [-span / 2 + 0.03, span / 2 - 0.03]) {
    const clip = new Mesh(new BoxGeometry(0.03, 0.045, 0.014), metalMat)
    clip.position.set(sx, -0.016, 0.004)
    g.add(clip)
  }
  const hook = hookCurve(0, -0.012)
  hook.points.forEach((v) => (v.y += 0.02))
  g.add(new Mesh(new TubeGeometry(hook, 40, 0.0028, 6, false), metalMat))
  return g
}

/* ---------------- الطقم المطوي ----------------
   الصورة المفرودة نفسها متقسمة ألواح على خطوط الطي: الجنبين (بالأكمام)
   بيتطبقوا لورا، وبعدين النص التحتاني لورا — زي طي المحلات. الوش اللي
   باين وهو مطوي جزء من نفس الصورة بالظبط، ومفيش أي تفصيلة مرسومة.
   الفرد = نفس الحركة بالعكس. */
const FOLD_T = 0.004 // سُمك طبقة القماش

function foldable(spec: FoldSpec, front: MeshBasicMaterial, back: MeshBasicMaterial) {
  const Wm = spec.w / spec.ppm
  const Hm = spec.h / spec.ppm
  const X = (u: number) => (u - 0.5) * Wm
  const Y = (v: number) => (0.5 - v) * Hm
  const us = [0, ...spec.cuts, 1]
  const yF = Y(spec.foldV)
  const root = new Group()
  const meshes: Mesh[] = []
  const sides: { g: Group; sign: number }[] = []
  const bottoms: { g: Group; sign: number }[] = []
  const shaded: { attr: BufferAttribute; base: Float32Array }[] = []
  const t = FOLD_T

  const panel = (u0: number, u1: number, v0: number, v1: number, edges: boolean) => {
    const geo = new PlaneGeometry(X(u1) - X(u0), Y(v0) - Y(v1), 12, 12)
    const uv = geo.attributes.uv as BufferAttribute
    const pos = geo.attributes.position as BufferAttribute
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < uv.count; i++) {
      const a = uv.getX(i)
      const b = uv.getY(i)
      uv.setXY(i, u0 + a * (u1 - u0), 1 - (v0 + (1 - b) * (v1 - v0)))
      // الوش الأمامي وهو مطوي: الحافة اللي عندها الطية بتغمق سنة (القماش بيلف لورا)
      let s = 1
      if (edges) {
        const dx = Math.min(a, 1 - a) * (X(u1) - X(u0))
        const dy = b * (Y(v0) - Y(v1))
        s = 1 - 0.1 * Math.exp(-dx / 0.012) - 0.12 * Math.exp(-dy / 0.014)
      }
      col.set([s, s, s], i * 3)
    }
    geo.setAttribute('color', new BufferAttribute(col, 3))
    if (edges) shaded.push({ attr: geo.attributes.color as BufferAttribute, base: col.slice() })
    const f = new Mesh(geo, front)
    const bk = new Mesh(geo, back)
    const g = new Group()
    g.add(f, bk)
    g.position.set(X((u0 + u1) / 2), Y((v0 + v1) / 2), 0)
    meshes.push(f)
    return g
  }

  for (let c = 0; c < us.length - 1; c++) {
    const side = c === spec.anchor ? 0 : c < spec.anchor ? -1 : 1
    const col = new Group()
    root.add(col)
    let ox = 0
    let zl = 0
    if (side) {
      const px = X(side < 0 ? us[c + 1] : us[c])
      col.position.set(px, 0, -t / 2)
      ox = -px
      zl = t / 2
      sides.push({ g: col, sign: side })
    }
    const top = panel(us[c], us[c + 1], 0, spec.foldV, side === 0)
    top.position.x += ox
    top.position.z = zl
    col.add(top)
    const hz = side ? t * 1.5 : -t
    const bh = new Group()
    bh.position.set(0, yF, hz)
    col.add(bh)
    const bot = panel(us[c], us[c + 1], spec.foldV, 1, false)
    bot.position.x += ox
    bot.position.y -= yF
    bot.position.z = zl - hz
    bh.add(bot)
    bottoms.push({ g: bh, sign: side ? -1 : 1 })
  }

  // f: ١ = مطوي، ٠ = مفرود (لكل مرحلة لوحدها)
  const set = (sideF: number, bottomF: number) => {
    for (const s of sides) s.g.rotation.y = s.sign * Math.PI * sideF
    for (const b of bottoms) b.g.rotation.x = b.sign * Math.PI * bottomF
    // غمقان حافة الطية بيختفي مع الفرد
    const k = Math.min(sideF, bottomF)
    for (const s of shaded) {
      const arr = s.attr.array as Float32Array
      for (let i = 0; i < arr.length; i++) arr[i] = 1 - k * (1 - s.base[i])
      s.attr.needsUpdate = true
    }
  }
  const a0 = us[spec.anchor]
  const a1 = us[spec.anchor + 1]
  return {
    root,
    meshes,
    set,
    /** مقاسات بالمتر: الوش المطوي، والقطعة مفرودة */
    folded: { w: X(a1) - X(a0), h: Y(spec.top) - yF, cx: X((a0 + a1) / 2) },
    open: { w: Wm, h: Y(spec.top) - Y(spec.bottom) },
    topY: Y(spec.top),
  }
}

let soft: CanvasTexture | null = null
/** ظل مستطيل ناعم للقطع اللي مالهاش ظل مخبوز (البنطلون) */
function softShadow() {
  if (soft) return soft
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 160
  const g = c.getContext('2d')!
  // shadowBlur مدعوم في كل المتصفحات (filter مش مدعوم في Safari القديم)
  g.shadowColor = 'rgba(20,18,14,0.9)'
  g.shadowBlur = 22
  g.shadowOffsetX = 1000
  g.fillRect(24 - 1000, 24, 80, 112)
  soft = new CanvasTexture(c)
  soft.colorSpace = SRGBColorSpace
  return soft
}

/* ============================================================
   المشهد
   ============================================================ */
export function createStore(canvas: HTMLCanvasElement, opts: SceneOptions) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  const mobile = matchMedia('(pointer: coarse)').matches
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.75 : 2))

  const scene = new Scene()
  scene.background = new Color(WALL)
  const camera = new PerspectiveCamera(48, 1, 0.05, 40)

  scene.add(new HemisphereLight('#fffdf8', '#bdb6aa', 2.2))
  const sun = new DirectionalLight('#ffffff', 1.1)
  sun.position.set(-2, 6, 4)
  scene.add(sun)
  // ضوء ماشي مع الكاميرا: الوش اللي قدامك بلونه الحقيقي، والجناب بتغمق طبيعي
  const key = new DirectionalLight('#ffffff', 1.25)
  scene.add(key, key.target)

  const loader = new TextureLoader()
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const displayFont = cssFont('--font-display', 'sans-serif')
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x)

  /* ---------------- الأوضة ---------------- */
  const room = new Group()
  scene.add(room)

  const wallMat = (w: number) =>
    track(new MeshBasicMaterial({ map: track(wallTexture(w, ROOM_H, WALL)) }))

  const back = new Mesh(track(new PlaneGeometry(ROOM_W, ROOM_H)), wallMat(ROOM_W))
  back.position.set(0, ROOM_H / 2, BACK_Z)
  const front = new Mesh(track(new PlaneGeometry(ROOM_W, ROOM_H)), wallMat(ROOM_W))
  front.position.set(0, ROOM_H / 2, ROOM_D / 2)
  front.rotation.y = Math.PI
  const left = new Mesh(track(new PlaneGeometry(ROOM_D, ROOM_H)), wallMat(ROOM_D))
  left.position.set(-ROOM_W / 2, ROOM_H / 2, 0)
  left.rotation.y = Math.PI / 2
  const right = new Mesh(track(new PlaneGeometry(ROOM_D, ROOM_H)), wallMat(ROOM_D))
  right.position.set(ROOM_W / 2, ROOM_H / 2, 0)
  right.rotation.y = -Math.PI / 2
  const floor = new Mesh(
    track(new PlaneGeometry(ROOM_W, ROOM_D)),
    track(new MeshBasicMaterial({ map: track(floorTexture()) }))
  )
  floor.rotation.x = -Math.PI / 2
  const ceil = new Mesh(track(new PlaneGeometry(ROOM_W, ROOM_D)), track(new MeshBasicMaterial({ color: '#f3f1ed' })))
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = ROOM_H
  room.add(back, front, left, right, floor, ceil)

  // وزرة: خط رفيع بيفصل الحيطة عن الأرض زي المرجع
  const skirtMat = track(new MeshLambertMaterial({ color: '#e2ded7' }))
  const skirt = (len: number, x: number, z: number, yaw: number) => {
    const m = new Mesh(track(new BoxGeometry(len, 0.07, 0.014)), skirtMat)
    m.position.set(x, 0.035, z)
    m.rotation.y = yaw
    room.add(m)
  }
  skirt(ROOM_W, 0, BACK_Z + 0.007, 0)
  skirt(ROOM_D, -ROOM_W / 2 + 0.007, 0, Math.PI / 2)
  skirt(ROOM_D, ROOM_W / 2 - 0.007, 0, -Math.PI / 2)

  /* ---------------- الشعار ---------------- */
  void logoTexture(opts.logo, opts.brand, displayFont).then(({ texture, aspect }) => {
    if (disposed) return texture.dispose()
    track(texture)
    const w = 1.9
    const m = new Mesh(
      track(new PlaneGeometry(w, w / aspect)),
      track(new MeshBasicMaterial({ map: texture, transparent: true }))
    )
    m.position.set(SLOTS.back.origin.x, 2.84, BACK_Z + 0.01)
    scene.add(m)
    invalidate()
  })

  /* ---------------- الطقم المطوي على الترابيزة ---------------- */
  const SET_PAIR_GAP = 0.035
  const sstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }

  /** طقم (تيشيرت + بنطلون) مطويين جنب بعض؛ zTop = حافة الياقة/الوسط ناحية الحيطة */
  function buildFoldSet(p: ScenePiece, zoneSlug: string, g: Group, px: number, zTop: number, tableHalf: number): LaidPiece {
    const fs = p.foldSet!
    const mats = () => ({
      front: new MeshBasicMaterial({ transparent: true, alphaTest: 0.02, vertexColors: true, side: FrontSide }),
      // ضهر القماش (بيبان بس وقت الفرد): نفس الصورة أغمق شوية
      back: new MeshBasicMaterial({ transparent: true, alphaTest: 0.02, side: BackSide, color: new Color(0.78, 0.78, 0.78) }),
    })
    const tm = mats()
    const pm = mats()
    const tint = recolorable(tm.front)
    const tee = foldable(fs.tee, tm.front, tm.back)
    const pants = foldable(fs.pants, pm.front, pm.back)
    for (const f of [tee, pants]) {
      f.root.rotation.x = -Math.PI / 2 // الياقة/الوسط ناحية الحيطة
      f.root.traverse((o) => {
        const m = o as Mesh
        if (m.geometry) track(m.geometry)
      })
      g.add(f.root)
    }
    track(tm.front), track(tm.back), track(pm.front), track(pm.back)

    // مطويين: التيشيرت يمين والبنطلون شماله (RTL) — مفرودين: نفس الترتيب بمسافة
    const fw = tee.folded.w + SET_PAIR_GAP + pants.folded.w
    const ow = tee.open.w + SET_PAIR_GAP + pants.open.w
    const oh = Math.max(tee.open.h, pants.open.h)
    // الطقم المفرود بيفضل جوه حدود الترابيزة (مايعدّيش الحرف) — إزاحة ثابتة لكل طقم
    let shift = 0
    if (px - ow / 2 < -tableHalf + 0.05) shift = -tableHalf + 0.05 - (px - ow / 2)
    if (px + ow / 2 + shift > tableHalf - 0.05) shift = tableHalf - 0.05 - (px + ow / 2)
    const lay = [
      { f: tee, x0: fw / 2 - tee.folded.w / 2 - tee.folded.cx, x1: shift + ow / 2 - tee.open.w / 2 },
      { f: pants, x0: -fw / 2 + pants.folded.w / 2 - pants.folded.cx, x1: shift - ow / 2 + pants.open.w / 2 },
    ]
    // خط الوقفة: الاتنين واقفين على نفس الخط، عند الحرف القريب للرزمة نفسها (مكانها)
    const zStand = zTop + Math.max(tee.folded.h, pants.folded.h)
    const HEM = 0.03 // الديل فوق الترابيزة وهو واقف
    const BASE = FOLD_T * 3 + 0.002 // سُمك الرزمة المطوية

    /* ستاند عرض لكل قطعة (عمود معدن رفيع + قاعدة + بار ورا الياقة/الوسط):
       بيشيل القطعة طول الحركة — مفيش لحظة القطعة فيها طايرة من غير سند */
    const standMat = metalMat
    const rodGeo = track(new CylinderGeometry(0.005, 0.005, 1, 10))
    const baseGeo = track(new CylinderGeometry(0.055, 0.06, 0.008, 24))
    const barGeo = track(new CylinderGeometry(0.0055, 0.0055, 1, 10))
    const stands = lay.map(({ f }) => {
      const sg = new Group()
      const rod = new Mesh(rodGeo, standMat)
      const base = new Mesh(baseGeo, standMat)
      const bar = new Mesh(barGeo, standMat)
      bar.rotation.z = Math.PI / 2
      bar.scale.y = f.folded.w * 0.8
      base.position.y = TABLE_Y + 0.004
      sg.add(rod, base, bar)
      sg.visible = false
      g.add(sg)
      return { sg, rod, base, bar }
    })

    const shGeo = track(new PlaneGeometry(1, 1))
    const shMat = track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.22 }))
    const shadows = lay.map(() => {
      const m = new Mesh(shGeo, shMat)
      m.rotation.x = -Math.PI / 2
      g.add(m)
      return m
    })

    /* الحركة (s من ٠ مطوي لـ ١ واقف مفرود) — كل لحظة القطعة مسنودة:
       ١) الرزمة بتقوم على حرفها القريب (الحرف لازق في الترابيزة طول الوقت)
       ٢) الستاند بيشيلها لفوق من ورا الياقة لحد ما يبقى فيه مكان للديل
       ٣) نفس الفرد اللي اتوافق عليه: التحتاني الأول وبعدين الجنبين
       القفل = نفس الحركة بالعكس بالظبط */
    const apply = (s: number) => {
      const up = sstep(0, 0.25, s)
      const rise = sstep(0.22, 0.45, s)
      const bottomF = 1 - sstep(0.45, 0.72, s)
      const sideF = 1 - sstep(0.65, 0.95, s)
      const open = 1 - Math.max(sideF, bottomF)
      const a = -Math.PI / 2 * (1 - up)
      lay.forEach(({ f, x0, x1 }, i) => {
        f.set(sideF, bottomF)
        const yF = f.topY - f.folded.h // خط الطي التحتاني (محلي)
        const pz = zTop + f.folded.h // الحرف القريب للرزمة على الترابيزة
        const py = TABLE_Y + BASE
        // ١: لف حوالين الحرف ده
        let ry = py - yF * Math.cos(a)
        let rz = pz - yF * Math.sin(a)
        // ٢: طلوع على الستاند لحد الوضع النهائي (الديل عند HEM لما يتفرد)
        const yEnd = TABLE_Y + HEM - (f.topY - f.open.h)
        ry += (yEnd - (py - yF)) * rise
        rz += (zStand - pz) * rise
        const x = x0 + (x1 - x0) * rise
        f.root.rotation.x = a
        f.root.position.set(x, ry, rz)

        // الستاند: بيظهر مع القومة، وعموده من الترابيزة لحد ورا الياقة
        const st = stands[i]
        st.sg.visible = s > 0.001
        const barY = ry + f.topY - 0.03
        const rodTop = TABLE_Y + (barY - TABLE_Y) * Math.min(1, up * 1.4)
        // ورا الجزء الظاهر: نص الرزمة وهي مطوية، ونص القطعة لما تتفرد
        const sx = x + f.folded.cx * (1 - open)
        st.rod.scale.y = Math.max(0.001, rodTop - TABLE_Y)
        st.rod.position.set(sx, (rodTop + TABLE_Y) / 2, rz - 0.012)
        st.base.position.set(sx, TABLE_Y + 0.004, rz - 0.012)
        st.bar.position.set(sx, barY, rz - 0.014)
        st.bar.visible = up > 0.7

        // ضل التلامس: مطوي = تحت الرزمة، واقف = خط ناعم تحت الديل وحوالين القاعدة
        const sh = shadows[i]
        const fwid = f.folded.w + (f.open.w - f.folded.w) * open
        const flatW = fwid * 1.08
        const flatD = f.folded.h * 1.06
        const standW = fwid * 0.92
        const standD = 0.07 + 0.05 * (1 - open)
        sh.scale.set(flatW + (standW - flatW) * up, flatD + (standD - flatD) * up, 1)
        const flatZ = zTop + f.folded.h / 2 + 0.014
        sh.position.set(
          x + f.folded.cx * (1 - up) + 0.01,
          TABLE_Y + 0.001,
          flatZ + (zStand + 0.01 - flatZ) * up
        )
      })
      shMat.opacity = 0.22 + 0.06 * up
    }
    apply(0)

    const lp: LaidPiece = {
      ...p,
      src: fs.tee.src,
      srcSm: fs.tee.srcSm,
      zone: zoneSlug,
      x: px,
      mw: ow,
      mh: oh,
      group: g,
      body: tee.meshes[fs.tee.anchor * 2],
      ready: false,
      spread: 0,
      spreadTo: 0,
      lift: 0,
      liftTo: 0,
      box: { x0: -ow / 2, x1: ow / 2, y0: TABLE_Y, y1: TABLE_Y, z: zTop + oh / 2 },
      hits: [...tee.meshes, ...pants.meshes],
      onTable: true,
      tint,
      tintTo: 0,
      dim: 0,
      dimTo: 0,
      baseColor: tm.front.color.clone(),
      dimMats: [tm.back, pm.front, pm.back].map((mat) => ({ mat, base: mat.color.clone() })),
      folding: { s: 0, apply },
      stand: { x: shift, y: TABLE_Y + HEM + oh / 2, z: zStand, w: ow, h: oh + 0.04 },
    }
    const tex = (src: string, targets: MeshBasicMaterial[], done?: () => void) =>
      loader.load(
        src,
        (t) => {
          if (disposed) return t.dispose()
          track(t)
          t.colorSpace = SRGBColorSpace
          t.anisotropy = maxAniso
          for (const m of targets) {
            m.map = t
            m.needsUpdate = true
          }
          done?.()
          invalidate()
        },
        undefined,
        () => {}
      )
    tex(fs.pants.src, [pm.front, pm.back])
    tex(fs.tee.srcSm, [tm.front, tm.back], () => {
      lp.ready = true
      g.visible = true
      opts.onPieceReady(p.id)
    })
    all.push(lp)
    return lp
  }

  /* ---------------- الأقسام ---------------- */
  const used = new Set<string>()
  const zones: LaidZone[] = []
  const all: LaidPiece[] = []
  // معدن من غير env map بيطلع أسود — Lambert رمادي فاتح بيقرا كمعدن مصقول في الإضاءة دي
  const metalRail = track(new MeshLambertMaterial({ color: '#a9aeb5', emissive: '#2a2d31' }))
  const shadowMats: Material[] = []

  for (const z of opts.zones) {
    const key = PREFER[z.kind].find((k) => !used.has(k)) ?? 'front'
    used.add(key)
    const slot = SLOTS[key]
    const group = new Group()
    group.position.copy(slot.origin)
    group.rotation.y = slot.yaw
    scene.add(group)

    const long = z.kind === 'long'
    const railY = long ? 2.08 : 1.62

    // مقاس كل قطعة بالمتر
    const sized = z.pieces.map((p) => {
      const ppm = long ? (p.h * (1 - p.top)) / LONG_M : (p.shoulder * p.w) / SHOULDER_M
      return { p, mw: p.w / ppm, mh: p.h / ppm, ppm }
    })

    // الترتيب على القضيب من اليمين للشمال (RTL) — أول قطعة على اليمين
    const shoulderMax = Math.max(...sized.map((s) => s.mw * s.p.shoulder))
    // الطقم = وحدتين جنب بعض: تيشيرت على شماعة + بنطلون على شماعة مشابك
    const unitW = (s: (typeof sized)[number]) =>
      s.p.fold ? s.mw + SET_GAP + s.p.fold.w / s.ppm : s.mw * s.p.shoulder
    const unitMax = Math.max(...sized.map(unitW))
    const step = unitMax + (z.kind === 'set' ? GAP * 3 : GAP)
    /* التباعد: كل قطعة بعرضها الحقيقي من طرف الكم للطرف التاني (من خط القماش)
       + مسافة ثابتة — الأكمام والكفوف مابتلمسش اللي جنبها */
    const EDGE_GAP = 0.04
    const ext = sized.map(({ p, mw }) => {
      const r = p.rim
      if (!r || p.fold) return { l: unitW({ p, mw } as (typeof sized)[number]) / 2, r: unitW({ p, mw } as (typeof sized)[number]) / 2 }
      const i0 = r.findIndex((v) => v < 0.999)
      const i1 = r.length - 1 - [...r].reverse().findIndex((v) => v < 0.999)
      const u0 = Math.max(0, (i0 - 0.5) / (r.length - 1))
      const u1 = Math.min(1, (i1 + 0.5) / (r.length - 1))
      return { l: (p.hookX - u0) * mw, r: (u1 - p.hookX) * mw }
    })
    const hookXs: number[] = []
    if (z.kind !== 'set' && ext.length) {
      // من اليمين للشمال (RTL): القطعة اللي بعدها بتبدأ بعد طرف كم اللي قبلها
      let x = 0
      hookXs.push(0)
      for (let i = 1; i < ext.length; i++) {
        x -= ext[i - 1].l + EDGE_GAP + ext[i].r
        hookXs.push(x)
      }
      // القسم كله (من طرف أول كم لآخر كم) في نص القضيب
      const c = (ext[0].r + x - ext[ext.length - 1].l) / 2
      for (let i = 0; i < hookXs.length; i++) hookXs[i] -= c
    }
    const width = hookXs.length > 1 ? hookXs[0] - hookXs[hookXs.length - 1] : step * (sized.length - 1)
    const laid: LaidPiece[] = []

    // ترابيزة العرض: الأطقم نايمة عليها زي ما اتصوّرت — ٣ جنب بعض في صفوف
    const flatSize = (p: ScenePiece) => {
      if (p.foldSet) {
        // الطقم مطوي: التيشيرت والبنطلون جنب بعض
        const { tee, pants } = p.foldSet
        const tw = (tee.cuts[1] - tee.cuts[0]) * (tee.w / tee.ppm)
        const th = (tee.foldV - tee.top) * (tee.h / tee.ppm)
        const pw = (1 - pants.cuts[0]) * (pants.w / pants.ppm)
        const ph = (pants.foldV - pants.top) * (pants.h / pants.ppm)
        return { fw: tw + SET_PAIR_GAP + pw, fd: Math.max(th, ph) }
      }
      const fw = p.flat ? p.flat.span : p.w / ((p.shoulder * p.w) / SHOULDER_M)
      return { fw, fd: fw * (p.h / p.w) }
    }
    const cols = Math.min(3, z.pieces.length)
    const rows = Math.ceil(z.pieces.length / cols)
    const cellW = Math.max(...z.pieces.map((p) => flatSize(p).fw)) + 0.1
    const cellD = Math.max(...z.pieces.map((p) => flatSize(p).fd)) + 0.08
    const tableLen = cols * cellW + 0.3
    const tableD = rows * cellD + 0.26
    const tableZ = tableD / 2 + 0.25
    // عينة: قطع متطبّقة من أقسام تانية (التيشيرت الأبيض) — مكانها على طرف الترابيزة الشمال
    const samples = z.kind === 'set' ? opts.zones.flatMap((zz) => zz.pieces).filter((p) => p.folded) : []
    const sampleW = samples.length ? 0.46 : 0
    if (z.kind === 'set') {
      const fullLen = tableLen + sampleW
      const top = new Mesh(track(new BoxGeometry(fullLen, 0.05, tableD)), track(new MeshLambertMaterial({ color: '#cfc7ba' })))
      top.position.set(-sampleW / 2, TABLE_Y - 0.025, tableZ)
      const base = new Mesh(
        track(new BoxGeometry(fullLen - 0.1, TABLE_Y - 0.05, tableD - 0.1)),
        track(new MeshLambertMaterial({ color: '#c9c0b2' }))
      )
      base.position.set(-sampleW / 2, (TABLE_Y - 0.05) / 2, tableZ)
      const contact = new Mesh(
        track(new PlaneGeometry(fullLen + 0.3, tableD + 0.3)),
        track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.3 }))
      )
      contact.rotation.x = -Math.PI / 2
      contact.position.set(-sampleW / 2, 0.002, tableZ)
      group.add(top, base, contact)

      samples.forEach((p, k) => {
        const f = p.folded!
        const fw = f.span
        const fd = f.span * (f.h / f.w)
        const sx = -(cols * cellW) / 2 - sampleW / 2
        const sz = tableZ + (k - (samples.length - 1) / 2) * (fd + 0.06)
        // ظل التماس: ضلمة خفيفة لازقة في الترابيزة تحت الحرف
        const sh = new Mesh(
          track(new PlaneGeometry(fw * 1.14, fd * 1.1)),
          track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.42 }))
        )
        sh.rotation.x = -Math.PI / 2
        sh.position.set(sx + 0.008, TABLE_Y + 0.0008, sz + 0.012)
        group.add(sh)
        loader.load(f.src, (t) => {
          if (disposed) return t.dispose()
          track(t)
          t.colorSpace = SRGBColorSpace
          t.anisotropy = maxAniso
          // اللون من uv1 (جوه الحرف)، والقصّ من الشفافية الأصلية (حدود القطعة بالظبط)
          t.channel = 1
          const img = t.image as Img
          const ac = document.createElement('canvas')
          ac.width = img.width
          ac.height = img.height
          const ag = ac.getContext('2d', { willReadFrequently: true })!
          ag.drawImage(img, 0, 0)
          const px = ag.getImageData(0, 0, ac.width, ac.height)
          for (let q = 0; q < px.data.length; q += 4) {
            const al = px.data[q + 3]
            px.data[q] = px.data[q + 1] = px.data[q + 2] = al
            px.data[q + 3] = 255
          }
          ag.putImageData(px, 0, 0)
          const alphaTex = track(new CanvasTexture(ac))
          const mesh = new Mesh(
            track(foldedGeometry(img, fw, fd)),
            track(new MeshBasicMaterial({ map: t, alphaMap: alphaTex, transparent: true, alphaTest: 0.5, vertexColors: true }))
          )
          mesh.rotation.x = -Math.PI / 2 // الياقة ناحية الحيطة
          mesh.position.set(sx, TABLE_Y + 0.0015, sz)
          group.add(mesh)
          invalidate()
        })
      })
    }

    sized.forEach(({ p, mw, mh, ppm }, i) => {
      const x = hookXs.length ? hookXs[i] : width / 2 - i * step
      const g = new Group()
      g.visible = false
      group.add(g)

      // على الترابيزة: الطقم كله (تيشيرت + بنطلون فوقه) زي الصورة بالظبط
      if (z.kind === 'set') {
        const { fw, fd } = flatSize(p)
        const col = i % cols
        const row = Math.floor(i / cols)
        // أول قطعة يمين (RTL)، والصف الأول ناحية الحيطة
        const px = (cols - 1) / 2 * cellW - col * cellW
        const pz = tableZ - ((rows - 1) / 2) * cellD + row * cellD
        g.position.x = px
        if (p.foldSet) {
          laid.push(buildFoldSet(p, z.slug, g, px, pz - fd / 2, tableLen / 2))
          return
        }
        // الوش اللي لفوق بياخد نور السما والشمس وضوء الكاميرا مع بعض — بنرجّعه للونه الحقيقي
        const mat = new MeshLambertMaterial({ alphaTest: 0.5, alphaToCoverage: true, color: '#c4c4c4' })
        const tint = recolorable(mat)
        const tableGeo = track(new PlaneGeometry(fw, fd, 110, Math.round(110 * (fd / fw))))
        const mesh = new Mesh(tableGeo, mat)
        if (p.depth) {
          // تيشيرت متطبّق ~٢ سم + بنطلون متطبّق فوقه
          void loadDepth(p.depth).then((d) => {
            if (!d || disposed) return
            inflate(tableGeo, fw, fd, d, 0.04)
            invalidate()
          })
        }
        // نايم على الترابيزة بسُمكه (من خريطة العمق) — من غير ألواح تحته
        mesh.rotation.x = -Math.PI / 2 // الياقة ناحية الحيطة
        mesh.position.set(0, TABLE_Y + 0.004 + i * 0.0004, pz)
        const sh = new Mesh(
          track(new PlaneGeometry(fw * 1.06, fd * 1.05)),
          track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.24 }))
        )
        sh.rotation.x = -Math.PI / 2
        sh.position.set(0.012, TABLE_Y + 0.001, pz + 0.014)
        g.add(sh, mesh)
        const lp: LaidPiece = {
          ...p,
          zone: z.slug,
          x: px,
          mw: fw,
          mh: fd,
          group: g,
          body: mesh,
          ready: false,
          spread: 0,
          spreadTo: 0,
          lift: 0,
          liftTo: 0,
          box: { x0: -fw / 2, x1: fw / 2, y0: TABLE_Y, y1: TABLE_Y, z: pz },
          hits: [mesh],
          onTable: true,
          tint,
          tintTo: 0,
          dim: 0,
          dimTo: 0,
          baseColor: mat.color.clone(),
        }
        loader.load(
          p.srcSm,
          (t) => {
            if (disposed) return t.dispose()
            track(t)
            t.colorSpace = SRGBColorSpace
            t.anisotropy = maxAniso
            mat.map = t
            mat.needsUpdate = true
            lp.ready = true
            g.visible = true
            opts.onPieceReady(p.id)
            invalidate()
          },
          undefined,
          () => {}
        )
        laid.push(lp)
        all.push(lp)
        return
      }

      // في الطقم: التيشيرت يمين والبنطلون شماله (RTL)
      const fw = p.fold ? p.fold.w / ppm : 0
      const fh = p.fold ? p.fold.h / ppm : 0
      const total = p.fold ? mw + SET_GAP + fw : 0
      const ox = p.fold ? total / 2 - mw / 2 : 0

      // الجسم
      const bend = Math.min(0.06, mw * 0.1)
      const geo = track(bodyGeometry(mw, mh, bend))
      /* عينة الملف (Massimo الأبيض، Loewe الأبيض، 1975): ظلال الصورة الأصلية نفسها —
         من غير نفخ ولا إضاءة مضافة (كانت بتعمل مساحات مستوية شبه البلاستيك)،
         وحافة ناعمة متدرّجة (مش alpha-to-coverage اللي بيعمل تسنين) */
      // اتعمّمت بعد موافقة صاحب المشروع على العينة: كل القطع المتعلّقة بظلال صورتها الأصلية
      const natural = true
      const mat = natural
        ? new MeshBasicMaterial({ transparent: true, alphaTest: 0.02, side: DoubleSide })
        : new MeshLambertMaterial({ alphaTest: 0.5, alphaToCoverage: true, side: DoubleSide, color: '#eaeaea' })
      if (p.depth && !natural) {
        // العباية الطويلة بروزها أقل — من الجنب كانت بتبان منفوخة
        const amount = long ? 0.045 : 0.07
        void loadDepth(p.depth).then((d) => {
          if (!d || disposed) return
          inflate(geo, mw, mh, d, amount)
          invalidate()
        })
      }
      const tint = recolorable(mat)
      const body = new Mesh(geo, mat)
      // الخطاف (hookX, top) لازم ييجي على كتف الشماعة
      const hookLocalX = (p.hookX - 0.5) * mw
      const topY = railY - HOOK_DROP - (p.ownHanger ? -HOOK_DROP + 0.01 : 0)
      body.position.set(ox - hookLocalX, topY - mh / 2 + p.top * mh, RAIL_Z)
      g.add(body)

      if (!p.ownHanger) {
        // الشماعة جوه القطعة (ورا القماش): ذراعها ماشي تحت خط الكتف الحقيقي
        // للقطعة نفسها (rim) بـ ٢٫٤ سم — مفيش خشب برّه القماش في أي حتة
        const span = natural ? p.shoulder * mw * 0.74 : Math.max(0.3, Math.min(0.46, p.shoulder * mw * 0.92))
        let arm: Vector3[] | undefined
        if (p.rim) {
          const r = p.rim
          const rimAt = (u: number) => {
            const f = Math.min(1, Math.max(0, u)) * (r.length - 1)
            const k = Math.floor(f)
            const a = r[k]
            const b = r[Math.min(r.length - 1, k + 1)]
            return a + (b - a) * (f - k)
          }
          // نقطة القماش من فوق في مكان x (محلي من الخطاف)، بأقل قيمة حواليها (أمان)
          const topAt = (xl: number) => {
            let worst = Infinity
            for (const d of [-0.012, 0, 0.012]) {
              const u = p.hookX + (xl + d) / mw
              worst = Math.min(worst, (p.top - rimAt(u)) * mh)
            }
            return worst
          }
          const half = p.shoulder * mw * 0.5 * 0.86
          arm = []
          for (let k = -4; k <= 4; k++) {
            const xl = (k / 4) * half
            arm.push(new Vector3(xl, Math.min(-0.012, topAt(xl) - 0.024), 0))
          }
        }
        const hg = hanger(span, 0.012, arm)
        // القطعة المجسّمة: الشماعة جوه بين الوش والضهر
        hg.position.set(ox, railY - HOOK_DROP, p.volume ? RAIL_Z - 0.001 : natural ? RAIL_Z - 0.012 : RAIL_Z + bend + 0.004)
        g.add(hg)
      }

      // ظل القطعة على الحيطة — نفس شكلها متموّه، والضوء جاي من فوق شمال.
      // قريب من القطعة وخفيف (القطعة على بُعد ١٧ سم من الحيطة) — مش كتلة غامقة
      const sw = mw * 1.2
      const sh = mh * 1.14
      const smat = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.0 })
      shadowMats.push(smat)
      const shadow = new Mesh(track(new PlaneGeometry(sw, sh)), smat)
      // على الحيطة الجانبية: كل قطعة لافّة على شماعتها ناحية المحل (زي المحلات
      // الحقيقية) — من الكادر العام بتبان من قدّام مش من الجنب
      const turn = 0 // القطع بتفضل بنفس اتجاهها على القضيب
      if (turn) {
        g.rotation.y = turn
        // الضل يفضل لازق في الحيطة على قد عرض القطعة بعد اللف
        shadow.scale.x = Math.cos(turn)
        shadow.position.set(x + body.position.x * Math.cos(turn) + 0.02, body.position.y - 0.05, 0.006)
        smat.userData.max = 0.26
        shadow.visible = false
        group.add(shadow)
      } else {
        shadow.position.set(body.position.x + 0.025, body.position.y - 0.045, 0.006)
        smat.userData.max = long ? 0.16 : 0.22
        if (!slot.free) g.add(shadow)
      }
      if (!slot.free) loader.load(p.shadow, (t) => {
        if (disposed) return t.dispose()
        track(t)
        t.colorSpace = SRGBColorSpace
        smat.map = t
        smat.opacity = smat.userData.max ?? (natural ? 0.28 : 0.42)
        smat.needsUpdate = true
        invalidate()
      })

      // الطقم: البنطلون متعلّق من وسطه على شماعة مشابك جنب التيشيرت —
      // نفس صورته المتطبّقة بالظبط، من غير أي جزء مرسوم
      let boxBottom = body.position.y - mh / 2
      let boxLeft = body.position.x - mw / 2
      if (p.fold) {
        const px = -total / 2 + fw / 2
        const barY = railY - HOOK_DROP - 0.02
        // المشابك على حرف الوسط بالظبط (متقاس من الصورة نفسها)
        const f = p.fold
        const clipL = px + (f.clipX0 - 0.5) * fw + 0.02
        const clipR = px + (f.clipX1 - 0.5) * fw - 0.02
        const ch = clipHanger(clipR - clipL + 0.06)
        ch.position.set((clipL + clipR) / 2, barY, RAIL_Z + 0.012)
        g.add(ch)
        const pbend = Math.min(0.035, fw * 0.08)
        const fmat = new MeshBasicMaterial({ transparent: true, vertexColors: true, alphaTest: 0.04, side: DoubleSide })
        const pants = new Mesh(track(bodyGeometry(fw, fh, pbend)), fmat)
        pants.position.set(px, barY - 0.03 + f.clipY * fh - fh / 2 + 0.012, RAIL_Z)
        g.add(pants)
        const pshadow = new Mesh(
          track(new PlaneGeometry(fw * 1.3, fh * 1.22)),
          track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.36 }))
        )
        pshadow.position.set(px + 0.05, pants.position.y - 0.07, 0.006)
        g.add(pshadow)
        loader.load(p.fold.src, (t) => {
          if (disposed) return t.dispose()
          track(t)
          t.colorSpace = SRGBColorSpace
          t.anisotropy = maxAniso
          fmat.map = t
          fmat.needsUpdate = true
          invalidate()
        })
        boxBottom = Math.min(boxBottom, pants.position.y - fh / 2)
        boxLeft = px - fw / 2
      }

      const lp: LaidPiece = {
        ...p,
        zone: z.slug,
        x,
        mw,
        mh,
        group: g,
        body,
        ready: false,
        spread: 0,
        spreadTo: 0,
        lift: 0,
        liftTo: 0,
        box: {
          x0: boxLeft,
          x1: body.position.x + mw / 2,
          y0: boxBottom,
          y1: railY + 0.02,
          z: RAIL_Z + bend,
        },
        hits: [body],
        onTable: false,
        tint,
        tintTo: 0,
        dim: 0,
        dimTo: 0,
        baseColor: mat.color.clone(),
      }
      g.position.x = x
      laid.push(lp)
      all.push(lp)

      // الصورة الصغيرة الأول؛ القطعة (بشماعتها وظلها) بتظهر لما تجهز بس
      loader.load(
        p.srcSm,
        (t) => {
          if (disposed) return t.dispose()
          track(t)
          t.colorSpace = SRGBColorSpace
          t.anisotropy = maxAniso
          t.minFilter = LinearMipmapLinearFilter
          mat.map = t
          if (p.volume) {
            // قماش مجسّم: وش وضهر بسُمك من شكل القطعة نفسها
            const sg = shellGeometry(t.image as Img, mw, mh, bend, long)
            const flatGeo = body.geometry
            body.geometry = track(sg.front)
            flatGeo.dispose()
            mat.vertexColors = true
            body.add(new Mesh(track(sg.back), track(shellBackMaterial(t, p.base))))
          }
          mat.needsUpdate = true
          lp.ready = true
          g.visible = true
          shadow.visible = true
          opts.onPieceReady(p.id)
          invalidate()
        },
        undefined,
        () => {
          /* الصورة فشلت: القطعة بتفضل مخفية — مفيش شماعة فاضية */
        }
      )
    })

    // القضيب + الكوابيل (مش للترابيزة)
    const railLen = hookXs.length
      ? hookXs[0] + ext[0].r - (hookXs[hookXs.length - 1] - ext[ext.length - 1].l) + 0.36
      : width + unitMax + 0.7
    if (z.kind !== 'set' && slot.free) {
      // ستاند هدوم معدن واقف على الأرض: عمودين + رجلين + القضيب + لوحة الاسم
      const rail = new Mesh(track(new CylinderGeometry(0.012, 0.012, railLen, 16)), metalRail)
      rail.rotation.z = Math.PI / 2
      rail.position.set(0, railY, RAIL_Z)
      group.add(rail)
      const topY = railY + 0.42
      for (const sx of [-railLen / 2, railLen / 2]) {
        const post = new Mesh(track(new CylinderGeometry(0.016, 0.016, topY, 14)), metalRail)
        post.position.set(sx, topY / 2, RAIL_Z)
        const foot = new Mesh(track(new CylinderGeometry(0.014, 0.014, 0.62, 12)), metalRail)
        foot.rotation.x = Math.PI / 2
        foot.position.set(sx, 0.02, RAIL_Z)
        group.add(post, foot)
        for (const fz of [-0.31, 0.31]) {
          const cap = new Mesh(track(new CylinderGeometry(0.022, 0.022, 0.025, 12)), metalRail)
          cap.position.set(sx, 0.012, RAIL_Z + fz)
          group.add(cap)
        }
      }
      const head = new Mesh(track(new CylinderGeometry(0.012, 0.012, railLen, 16)), metalRail)
      head.rotation.z = Math.PI / 2
      head.position.set(0, topY, RAIL_Z)
      group.add(head)
      // ظل الستاند والهدوم على الأرض
      const floorSh = new Mesh(
        track(new PlaneGeometry(railLen + 0.5, 0.95)),
        track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.42 }))
      )
      floorSh.rotation.x = -Math.PI / 2
      floorSh.position.set(0.06, 0.003, RAIL_Z + 0.08)
      group.add(floorSh)
    } else if (z.kind !== 'set') {
      const rail = new Mesh(track(new CylinderGeometry(0.011, 0.011, railLen, 16)), metalRail)
      rail.rotation.z = Math.PI / 2
      rail.position.set(0, railY, RAIL_Z)
      group.add(rail)
      for (const sx of [-railLen / 2 + 0.05, railLen / 2 - 0.05]) {
        const arm = new Mesh(track(new CylinderGeometry(0.008, 0.008, RAIL_Z, 10)), metalRail)
        arm.rotation.x = Math.PI / 2
        arm.position.set(sx, railY, RAIL_Z / 2)
        const plate = new Mesh(track(new CylinderGeometry(0.03, 0.03, 0.008, 20)), metalRail)
        plate.rotation.x = Math.PI / 2
        plate.position.set(sx, railY, 0.004)
        group.add(arm, plate)
      }
    }

    // اسم القسم مكتوب على الحيطة فوق منتجاته في النص (زي الشعار) —
    // بدل اللافتة المتعلّقة: دايمًا جوه الكادر على أي شاشة
    const lt = track(labelTexture(z.name, displayFont))
    const labelW = 0.95
    const label = new Mesh(
      track(new PlaneGeometry(labelW, labelW / lt.aspect)),
      track(new MeshBasicMaterial({ map: lt.texture, transparent: true, depthWrite: false }))
    )
    let signY = railY + 0.42
    if (z.kind === 'set' && slot.free) {
      // لافتة صغيرة واقفة على طرف الترابيزة اللي ورا
      signY = TABLE_Y + 0.16
      const board = new Mesh(track(new BoxGeometry(0.7, 0.24, 0.025)), track(new MeshLambertMaterial({ color: '#fbfaf7' })))
      const bz = tableZ - tableD / 2 + 0.06
      board.position.set(0, signY, bz)
      board.rotation.x = -0.18
      label.scale.setScalar(0.66)
      label.position.set(0, signY + 0.004, bz + 0.016)
      label.rotation.x = -0.18
      group.add(board, label)
    } else if (slot.free) {
      // لوحة الاسم فوق الستاند
      signY = railY + 0.42 + 0.17
      const board = new Mesh(track(new BoxGeometry(0.9, 0.26, 0.02)), track(new MeshLambertMaterial({ color: '#fbfaf7' })))
      board.position.set(0, signY, RAIL_Z)
      label.scale.setScalar(0.78)
      label.position.set(0, signY + 0.004, RAIL_Z + 0.012)
      group.add(board, label)
    } else {
      if (z.kind === 'set') signY = TABLE_Y + 0.62
      label.position.set(0, signY, 0.012)
      group.add(label)
    }

    const heights = sized.map((s) => Math.max(s.mh, s.p.fold ? s.p.fold.h / s.ppm + 0.02 : 0))
    zones.push({
      ...z,
      slot,
      group,
      pieces: laid,
      width: z.kind === 'set' ? tableLen + sampleW : railLen,
      depth: z.kind === 'set' ? tableD : 0,
      tableZ,
      top: signY + 0.2,
      bottom: z.kind === 'set' ? TABLE_Y : railY - HOOK_DROP - Math.max(...heights) - 0.05,
    })
  }

  /* ---------------- الكاميرا ---------------- */
  let aspect = 1
  let width = 1
  let height = 1
  const portrait = () => aspect < 0.85

  /** نقطة محلية في مجموعة قسم → إحداثيات العالم */
  function toWorld(zone: LaidZone, x: number, y: number, z: number) {
    return zone.slot.origin
      .clone()
      .addScaledVector(zone.slot.right, x)
      .addScaledVector(new Vector3(0, 1, 0), y)
      .addScaledVector(zone.slot.normal, z)
  }

  /** مسافة تخلّي عرض×ارتفاع يدخلوا الكادر */
  function fit(w: number, h: number, fov: number, margin = 1.12) {
    const v = (fov * Math.PI) / 180
    const dh = (h * margin) / 2 / Math.tan(v / 2)
    const dw = (w * margin) / 2 / (Math.tan(v / 2) * aspect)
    return Math.max(dh, dw)
  }

  function shotStore(): Shot {
    if (portrait()) {
      // الفون: التيشرتات في النص؛ السحب/السكرول بيلف يمين (عبايات) وشمال (أطقم)
      return { pos: new Vector3(0, 1.62, BACK_Z + 4.6), target: new Vector3(0, 1.25, BACK_Z), fov: 62 }
    }
    // الكادر العام: الحيطة الورانية كلها في النص، والركنين باينين —
    // العبايات على الحيطة اليمين والطقم على الترابيزة شمال
    const square = aspect < 1.25
    return {
      pos: new Vector3(0, 1.8, BACK_Z + (square ? 9.4 : 8.6)),
      target: new Vector3(0, 1.25, BACK_Z),
      // أوسع شوية: العبايات بقت بمسافات (الكفوف مابتتداخلش) فالقضيب أطول ناحيتك
      fov: square ? 56 : 55,
    }
  }

  /** الترابيزة: الكاميرا من فوق بزاوية (~٦٠°) والاسم على الحيطة باين */
  function shotTable(z: LaidZone, cx: number, w: number, d: number, fov: number, margin: number, wall = false, cz = z.tableZ) {
    const up = new Vector3(0, 1, 0)
    const dir = z.slot.normal.clone().multiplyScalar(wall ? 0.9 : 0.58).add(up).normalize()
    const dist = fit(w, d, fov, margin)
    // مكان القسم: بنرفع النظرة شوية عشان اسم القسم على الحيطة يدخل الكادر
    const target = wall ? toWorld(z, cx, TABLE_Y + 0.3, cz - 0.35) : toWorld(z, cx, TABLE_Y + 0.04, cz - 0.08)
    return { pos: target.clone().addScaledVector(dir, dist), target, fov }
  }

  function shotZone(z: LaidZone): Shot {
    if (z.kind === 'set') {
      const fov = portrait() ? 60 : 46
      // الفون: الترابيزة كلها جوه الكادر (مش جزء منها)
      const w = portrait() ? z.width + 0.25 : z.width + 0.4
      return shotTable(z, pan.zone === z.slug ? pan.x : 0, w, z.depth + 1.1, fov, 1.12, true)
    }
    const fov = portrait() ? 58 : 44
    // مساحة تحت لشريط الأقسام (~١٢٪ من الكادر) عشان طرف القطعة مايستخبّاش وراه
    const bottom = z.bottom - (z.top - z.bottom) * 0.16
    const h = z.top - bottom
    // الفون: القسم كله جوه الكادر — القطع الطرفية باينة مش مقصوصة
    const visW = portrait() ? z.width * 1.04 : z.width
    const dist = Math.min(ROOM_D * 0.82, fit(visW, h, fov, 1.08))
    const c = toWorld(z, pan.zone === z.slug ? pan.x : 0, (z.top + bottom) / 2, 0)
    // الكاميرا في مستوى نص الكادر (من غير ميل) — زي ما بتقف قدام الحيطة
    const pos = c.clone().addScaledVector(z.slot.normal, dist)
    return { pos, target: c, fov }
  }

  function shotPiece(p: LaidPiece, withCard: boolean): Shot {
    const z = zones.find((zz) => zz.slug === p.zone)!
    if (p.stand) {
      // الطقم واقف على الستاند: الكاميرا قدّامه تقريبًا (مش من فوق)
      const st = p.stand
      const fov = portrait() ? 50 : 40
      const sheet = withCard && portrait()
      // الكارت على الكمبيوتر واخد ~٤٠٪ من العرض: الطقم كله لازم يدخل في الباقي
      const avail = withCard && !portrait() ? 0.54 : 1
      const dist = sheet ? fit(st.w * 1.08, st.h / 0.44, fov, 1) : fit((st.w * 1.12) / avail, st.h, fov, portrait() ? 1.25 : 1.18)
      const center = toWorld(z, p.x + st.x, st.y, st.z)
      const dir = z.slot.normal.clone().add(new Vector3(0, 0.32, 0)).normalize()
      const pos = center.clone().addScaledVector(dir, dist)
      const target = center.clone()
      if (withCard) {
        const v = (fov * Math.PI) / 180
        const visH = 2 * dist * Math.tan(v / 2)
        if (portrait()) {
          target.y -= visH * 0.24
          pos.y -= visH * 0.24
        } else {
          // نص المساحة اللي شمال الكارت
          const k = Math.min(0.22, 290 / width)
          target.addScaledVector(z.slot.right, visH * aspect * k)
          pos.addScaledVector(z.slot.right, visH * aspect * k)
        }
      }
      return { pos, target, fov }
    }
    if (p.onTable) {
      const fov = portrait() ? 52 : 40
      const w = p.box.x1 - p.box.x0
      const sheet = withCard && portrait()
      const s = sheet
        ? shotTable(z, p.x, w * 1.1, p.mh / 0.4, fov, 1, false, p.box.z)
        : shotTable(z, p.x, w * 1.45, p.mh * 1.6, fov, 1.3, false, p.box.z)
      if (withCard) {
        const v = (fov * Math.PI) / 180
        const visH = 2 * s.pos.distanceTo(s.target) * Math.tan(v / 2)
        const shift = sheet ? z.slot.normal.clone().multiplyScalar(visH * 0.3) : z.slot.right.clone().multiplyScalar(visH * aspect * 0.15)
        s.pos.add(shift)
        s.target.add(shift)
      }
      return s
    }
    const fov = portrait() ? 50 : 40
    const cx = p.x + (p.box.x0 + p.box.x1) / 2
    const cy = (p.box.y0 + p.box.y1) / 2
    const h = p.box.y1 - p.box.y0
    // الفون والبطاقة مفتوحة: القطعة كلها لازم تدخل في الـ ٤٠٪ اللي فوق الدرج
    const sheet = withCard && portrait()
    const dist = sheet ? fit(p.mw * 1.4, h / 0.44, fov, 1) : fit(p.mw * 1.35, h, fov, portrait() ? 1.35 : 1.3)
    const center = toWorld(z, cx, cy, p.box.z)
    const pos = center.clone().addScaledVector(z.slot.normal, dist)
    const target = center.clone()
    if (withCard) {
      const v = (fov * Math.PI) / 180
      const visH = 2 * dist * Math.tan(v / 2)
      if (portrait()) {
        // البطاقة تحت كشيت — القطعة تطلع فوق
        target.y -= visH * 0.24
        pos.y -= visH * 0.24
      } else {
        // البطاقة يمين (زي المرجع) — القطعة تروح شمال
        // القطعة في نص المساحة اللي شمال البطاقة بالظبط (البطاقة ~٤٣٠px + هامش)
        const visW = visH * aspect
        const k = Math.min(0.26, 235 / width)
        target.addScaledVector(z.slot.right, visW * k)
        pos.addScaledVector(z.slot.right, visW * k)
      }
    }
    return { pos, target, fov }
  }

  /* ---------------- الحركة ---------------- */
  const cur: Shot = { pos: new Vector3(0, 1.6, 4.4), target: new Vector3(0, 1.5, BACK_Z), fov: 50 }
  let tween: { from: Shot; to: Shot; t0: number; dur: number; mid: Vector3 } | null = null
  let goal: Shot = cur
  const pan = { zone: '', x: 0 }

  function apply(s: Shot) {
    camera.position.copy(s.pos)
    camera.fov = s.fov
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    camera.lookAt(s.target)
    key.position.copy(s.pos).add(new Vector3(-0.6, 1.2, 0))
    key.target.position.copy(s.target)
  }

  function go(to: Shot, instant = false) {
    goal = to
    const from: Shot = { pos: cur.pos.clone(), target: cur.target.clone(), fov: cur.fov }
    if (instant || opts.reducedMotion) {
      tween = null
      cur.pos.copy(to.pos)
      cur.target.copy(to.target)
      cur.fov = to.fov
      apply(cur)
      invalidate()
      return
    }
    // المدة بتزيد مع الدوران والمسافة — نفس إحساس المرجع (~١–١٫٥ ث)
    const d0 = from.target.clone().sub(from.pos).normalize()
    const d1 = to.target.clone().sub(to.pos).normalize()
    const angle = Math.acos(Math.max(-1, Math.min(1, d0.dot(d1))))
    const travel = from.pos.distanceTo(to.pos)
    const dur = Math.min(1700, Math.max(750, 700 + angle * 480 + travel * 70))
    // المسار بيعدّي جوه الأوضة (بيبعد عن الحيطة ويرجع) — مش خط مستقيم
    const mid = from.pos.clone().lerp(to.pos, 0.5)
    if (angle > 0.35) mid.lerp(new Vector3(0, 1.6, 0.8), Math.min(0.45, angle * 0.3))
    tween = { from, to, t0: -1, dur, mid }
    opts.onMotion(true)
    kick()
  }

  /* ---------------- الرسم ---------------- */
  let raf = 0
  let dirty = true
  let disposed = false
  let lastRects = ''

  function invalidate() {
    dirty = true
    kick()
  }

  function kick() {
    if (!raf && !disposed) raf = requestAnimationFrame(frame)
  }

  let lastNow = 0
  function frame(now: number) {
    raf = 0
    let moving = false
    const frameDt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 1 / 60
    lastNow = now

    if (tween) {
      if (tween.t0 < 0) tween.t0 = now // الساعة تبدأ من أول فريم مرسوم
      const k = Math.min(1, (now - tween.t0) / tween.dur)
      const e = ease(k)
      // منحنى بيزييه تربيعي للمكان، وخطي متنعّم للهدف
      const a = tween.from.pos.clone().lerp(tween.mid, e)
      const b = tween.mid.clone().lerp(tween.to.pos, e)
      cur.pos.copy(a.lerp(b, e))
      cur.target.copy(tween.from.target).lerp(tween.to.target, e)
      cur.fov = tween.from.fov + (tween.to.fov - tween.from.fov) * e
      if (k >= 1) {
        tween = null
        opts.onMotion(false)
      } else moving = true
      dirty = true
    }

    for (const p of all) {
      const dt = p.tintTo - p.tint.uTint.value
      if (Math.abs(dt) > 0.002) {
        p.tint.uTint.value += dt * (opts.reducedMotion ? 1 : 0.18)
        moving = true
        dirty = true
      } else if (dt !== 0) {
        p.tint.uTint.value = p.tintTo
        dirty = true
      }
      const dd = p.dimTo - p.dim
      if (Math.abs(dd) > 0.003) {
        p.dim += dd * (opts.reducedMotion ? 1 : 0.14)
        const m = p.body.material as MeshLambertMaterial | MeshBasicMaterial
        m.color.copy(p.baseColor).multiplyScalar(1 - 0.32 * p.dim)
        if (p.dimMats) for (const d of p.dimMats) d.mat.color.copy(d.base).multiplyScalar(1 - 0.32 * p.dim)
        moving = true
        dirty = true
      }
      // الطقم: بيتفرد لما يتختار، ويرجع يتطبق لما تسيبه (~١٫٦ ث)
      if (p.folding) {
        // تبديل لون/طقم: القديم يتطبق بالكامل الأول، وبعدين الجديد يتفرد —
        // عمر ما يبقى فيه طقمين مفتوحين أو بيتحركوا مع بعض
        const busy = all.some((q) => q !== p && q.folding && q.folding.s > 0)
        const target = p.id === focusId && !busy ? 1 : 0
        if (p.folding.s !== target) {
          const stepK = opts.reducedMotion ? 1 : frameDt / 1.6
          p.folding.s = target > p.folding.s ? Math.min(target, p.folding.s + stepK) : Math.max(target, p.folding.s - stepK)
          p.folding.apply(p.folding.s)
          moving = true
          dirty = true
        }
      }
      const ds = p.spreadTo - p.spread
      const dl = p.liftTo - p.lift
      if (Math.abs(ds) > 0.0005 || Math.abs(dl) > 0.0002) {
        const f = opts.reducedMotion ? 1 : 0.16
        p.spread += ds * f
        p.lift += dl * f
        p.group.position.x = p.x + p.spread
        p.group.position.z = p.lift
        moving = true
        dirty = true
      }
    }

    if (dirty) {
      apply(cur)
      renderer.render(scene, camera)
      dirty = false
      emitRects()
    }
    if (moving) kick()
    else lastNow = 0
  }

  const bx = new Box3()
  const corner = new Vector3()
  const camPos = new Vector3()

  /** مكان القطعة على الشاشة من صندوقها الحقيقي في المشهد */
  function screenRect(p: LaidPiece): Rect | null {
    bx.makeEmpty()
    for (const h of p.hits) bx.expandByObject(h)
    if (bx.isEmpty()) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z)
      corner.project(camera)
      if (corner.z > 1) return null // ورا الكاميرا
      const sx = ((corner.x + 1) / 2) * width
      const sy = ((1 - corner.y) / 2) * height
      x0 = Math.min(x0, sx)
      x1 = Math.max(x1, sx)
      y0 = Math.min(y0, sy)
      y1 = Math.max(y1, sy)
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  function emitRects() {
    const rects = new Map<string, Rect | null>()
    camera.getWorldPosition(camPos)
    const up = new Vector3(0, 1, 0)
    for (const p of all) {
      if (!p.ready) {
        rects.set(p.id, null)
        continue
      }
      const z = zones.find((zz) => zz.slug === p.zone)!
      // بنشوف وش القطعة؟ (مش ضهرها ولا من الجنب خالص)
      bx.makeEmpty()
      for (const h of p.hits) bx.expandByObject(h)
      const center = bx.getCenter(new Vector3())
      const look = center.sub(camPos).normalize()
      const facing = (p.onTable ? up : z.slot.normal).dot(look)
      if (facing > -0.12) {
        rects.set(p.id, null)
        continue
      }
      const r = screenRect(p)
      const off = !r || r.x + r.w < 0 || r.x > width || r.y + r.h < 0 || r.y > height
      rects.set(p.id, off ? null : r)
    }
    const sig = [...rects.values()].map((r) => (r ? `${r.x | 0},${r.y | 0},${r.w | 0}` : '-')).join('|')
    if (sig !== lastRects) {
      lastRects = sig
      opts.onRects(rects)
    }
  }

  /* ---------------- الواجهة اللي React بيستعملها ---------------- */
  let focusId: string | null = null
  let zoneSlug: string | null = null
  let withCard = false

  function setSpread(id: string | null) {
    for (const p of all) p.dimTo = 0
    for (const p of all) p.spreadTo = 0
    if (!id) return
    const p = all.find((x) => x.id === id)
    if (!p) return
    const z = zones.find((zz) => zz.slug === p.zone)!
    const i = z.pieces.indexOf(p)
    // المجاورين بيبعدوا عشان القطعة تبان لوحدها (زي المرجع)
    z.pieces.forEach((q, j) => {
      if (j === i) return
      q.spreadTo = 0 // القطع بتفضل مكانها — الكاميرا بس اللي بتتحرك
      q.dimTo = 1 // بس بتغمق شوية عشان القطعة المختارة تبقى البطل
    })
  }

  function reshoot(instant = false) {
    if (focusId) {
      const p = all.find((x) => x.id === focusId)
      if (p) return go(shotPiece(p, withCard), instant)
    }
    if (zoneSlug) {
      const z = zones.find((zz) => zz.slug === zoneSlug)
      if (z) return go(shotZone(z), instant)
    }
    go(shotStore(), instant)
  }

  const api = {
    resize(w: number, h: number) {
      width = Math.max(1, w)
      height = Math.max(1, h)
      aspect = width / height
      renderer.setSize(width, height, false)
      // الكادر بيتحسب تاني بالمقاس الجديد من غير حركة
      reshoot(true)
    },
    intro() {
      // دخول: من باب الأوضة للكادر العام
      const s = shotStore()
      cur.pos.copy(s.pos.clone().add(new Vector3(1.2, 0.05, 1.6)))
      cur.target.copy(s.target.clone().add(new Vector3(2.4, 0, 0)))
      cur.fov = s.fov
      apply(cur)
      go(s)
    },
    store() {
      focusId = null
      zoneSlug = null
      withCard = false
      pan.zone = ''
      setSpread(null)
      go(shotStore())
    },
    zone(slug: string) {
      focusId = null
      withCard = false
      zoneSlug = slug
      pan.zone = slug
      pan.x = 0
      setSpread(null)
      const z = zones.find((zz) => zz.slug === slug)
      if (z) go(shotZone(z))
    },
    focus(id: string, card: boolean) {
      const p = all.find((x) => x.id === id)
      if (!p) return
      focusId = id
      zoneSlug = p.zone
      withCard = card
      setSpread(id)
      go(shotPiece(p, card))
    },
    /** القطعة اللي بعدها/قبلها في نفس القسم (للأزرار والسحب) */
    sibling(dir: 1 | -1): string | null {
      const p = focusId ? all.find((x) => x.id === focusId) : null
      if (!p) return null
      const z = zones.find((zz) => zz.slug === p.zone)!
      const list = z.pieces.filter((q) => q.ready)
      const i = list.indexOf(p)
      if (i < 0 || list.length < 2) return null
      return list[(i + dir + list.length) % list.length].id
    },
    hover(id: string | null) {
      for (const p of all) p.liftTo = p.id === id && id !== focusId && !p.onTable ? 0.012 : 0
      invalidate()
    },
    /** سحب أفقي: بيمشي على الحيطة في حدود القسم/الأوضة */
    drag(dxPx: number) {
      if (focusId) return
      const dist = cur.pos.distanceTo(cur.target)
      const v = (cur.fov * Math.PI) / 180
      const metersPerPx = (2 * dist * Math.tan(v / 2)) / height
      const z = zoneSlug ? zones.find((zz) => zz.slug === zoneSlug) : zones[0]
      if (!z) return
      // حد السحب = الجزء اللي مش باين من القسم بس — القسم وعنوانه مايخرجوش برّه
      const visW = 2 * dist * Math.tan(v / 2) * aspect
      const limit = Math.max(0, (z.width - visW) / 2 + 0.05)
      const dx = -dxPx * metersPerPx
      const prev = pan.zone === z.slug ? pan.x : 0
      const next = Math.max(-limit, Math.min(limit, prev + dx))
      const delta = next - prev
      pan.zone = z.slug
      pan.x = next
      tween = null
      cur.pos.addScaledVector(z.slot.right, delta)
      cur.target.addScaledVector(z.slot.right, delta)
      goal = cur
      invalidate()
    },
    /** معاينة القطعة بلون مالوش صورة (hex) — null يرجّعها لصورتها */
    recolor(id: string | null, hex: string | null) {
      for (const p of all) {
        if (p.id === id && hex && p.base) {
          p.tint.uBase.value.setRGB(p.base[0] / 255, p.base[1] / 255, p.base[2] / 255, SRGBColorSpace)
          p.tint.uTarget.value.set(hex)
          p.tintTo = 1
        } else p.tintTo = 0
      }
      invalidate()
    },
    /** صورة أوضح لقطعة (النسخة الكاملة) — بتتبدّل لما تجهز */
    sharpen(id: string) {
      const p = all.find((x) => x.id === id)
      if (!p || p.src === p.srcSm) return
      loader.load(p.src, (t) => {
        if (disposed) return t.dispose()
        track(t)
        t.colorSpace = SRGBColorSpace
        t.anisotropy = maxAniso
        const m = p.body.material as MeshBasicMaterial
        m.map = t
        m.needsUpdate = true
        invalidate()
      })
    },
    /** مكان القطعة على الشاشة دلوقتي (لطيران الإضافة للسلة) */
    rectOf(id: string): Rect | null {
      const p = all.find((x) => x.id === id)
      return p ? screenRect(p) : null
    },
    get moving() {
      return !!tween
    },
    goal: () => goal,
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      scene.traverse((o: Object3D) => {
        const m = o as Mesh
        if (m.geometry) m.geometry.dispose()
        const mat = m.material as Material | Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
        const map = (mat as MeshBasicMaterial | undefined)?.map as Texture | undefined
        map?.dispose()
      })
      disposables.forEach((d) => d.dispose())
      woodMat.dispose()
      metalMat.dispose()
      renderer.dispose()
    },
  }
  return api
}

export type Store = ReturnType<typeof createStore>
