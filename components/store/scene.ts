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
  Box3,
  BufferAttribute,
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
  tintTo: number
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

/* ---------------- شماعة خشب ثلاثية الأبعاد ---------------- */
const woodMat = new MeshLambertMaterial({ color: '#b98048' })
const metalMat = new MeshLambertMaterial({ color: '#a9aeb5', emissive: '#2a2d31' })

function hanger(span: number) {
  const g = new Group()
  const half = span / 2
  const arm = new CatmullRomCurve3([
    new Vector3(-half, -0.055, 0),
    new Vector3(-half * 0.5, -0.022, 0),
    new Vector3(0, -0.004, 0),
    new Vector3(half * 0.5, -0.022, 0),
    new Vector3(half, -0.055, 0),
  ])
  g.add(new Mesh(new TubeGeometry(arm, 24, 0.0105, 8, false), woodMat))
  // الخطاف: طالع لفوق ومتلفّ حوالين القضيب
  const hook = new CatmullRomCurve3([
    new Vector3(0, -0.004, 0),
    new Vector3(0, HOOK_DROP * 0.55, 0),
    new Vector3(0, HOOK_DROP + 0.014, -0.006),
    new Vector3(0, HOOK_DROP + 0.022, -0.024),
    new Vector3(0, HOOK_DROP + 0.006, -0.04),
  ])
  g.add(new Mesh(new TubeGeometry(hook, 16, 0.0028, 6, false), metalMat))
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
  const hook = new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0, (HOOK_DROP + 0.02) * 0.55, 0),
    new Vector3(0, HOOK_DROP + 0.034, -0.006),
    new Vector3(0, HOOK_DROP + 0.042, -0.024),
    new Vector3(0, HOOK_DROP + 0.026, -0.04),
  ])
  g.add(new Mesh(new TubeGeometry(hook, 16, 0.0028, 6, false), metalMat))
  return g
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
    m.position.set(SLOTS.back.origin.x, 2.66, BACK_Z + 0.01)
    scene.add(m)
    invalidate()
  })

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
    const width = step * (sized.length - 1)
    const laid: LaidPiece[] = []

    // ترابيزة العرض: الأطقم نايمة عليها زي ما اتصوّرت — ٣ جنب بعض في صفوف
    const flatSize = (p: ScenePiece) => {
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
    if (z.kind === 'set') {
      const top = new Mesh(track(new BoxGeometry(tableLen, 0.05, tableD)), track(new MeshLambertMaterial({ color: '#cfc7ba' })))
      top.position.set(0, TABLE_Y - 0.025, tableZ)
      const base = new Mesh(
        track(new BoxGeometry(tableLen - 0.1, TABLE_Y - 0.05, tableD - 0.1)),
        track(new MeshLambertMaterial({ color: '#c9c0b2' }))
      )
      base.position.set(0, (TABLE_Y - 0.05) / 2, tableZ)
      const contact = new Mesh(
        track(new PlaneGeometry(tableLen + 0.3, tableD + 0.3)),
        track(new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, opacity: 0.3 }))
      )
      contact.rotation.x = -Math.PI / 2
      contact.position.set(0, 0.002, tableZ)
      group.add(top, base, contact)
    }

    sized.forEach(({ p, mw, mh, ppm }, i) => {
      const x = width / 2 - i * step
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
        // الوش اللي لفوق بياخد نور السما والشمس وضوء الكاميرا مع بعض — بنرجّعه للونه الحقيقي
        const mat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.04, color: '#c4c4c4' })
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
      const mat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.04, side: DoubleSide, color: '#eaeaea' })
      if (p.depth) {
        const amount = long ? 0.09 : 0.07
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
        const hg = hanger(Math.max(0.3, Math.min(0.46, p.shoulder * mw * 0.92)))
        hg.position.set(ox, railY - HOOK_DROP, RAIL_Z + bend + 0.004)
        g.add(hg)
      }

      // ظل القطعة على الحيطة — نفس شكلها متموّه، والضوء جاي من فوق شمال
      const sw = mw * 1.32
      const sh = mh * 1.24
      const smat = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.0 })
      shadowMats.push(smat)
      const shadow = new Mesh(track(new PlaneGeometry(sw, sh)), smat)
      shadow.position.set(body.position.x + 0.05, body.position.y - 0.07, 0.006)
      if (!slot.free) g.add(shadow)
      if (!slot.free) loader.load(p.shadow, (t) => {
        if (disposed) return t.dispose()
        track(t)
        t.colorSpace = SRGBColorSpace
        smat.map = t
        smat.opacity = 0.42
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
          mat.needsUpdate = true
          lp.ready = true
          g.visible = true
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
    const railLen = width + unitMax + 0.7
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
      width: z.kind === 'set' ? tableLen : railLen,
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
      fov: square ? 54 : 50,
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
      const w = portrait() ? Math.min(z.width, 1.5) : z.width + 0.4
      return shotTable(z, pan.zone === z.slug ? pan.x : 0, w, z.depth + 1.1, fov, 1.12, true)
    }
    const fov = portrait() ? 58 : 44
    // مساحة تحت لشريط الأقسام (~١٢٪ من الكادر) عشان طرف القطعة مايستخبّاش وراه
    const bottom = z.bottom - (z.top - z.bottom) * 0.16
    const h = z.top - bottom
    const visW = portrait() ? Math.min(z.width, 1.6) : z.width
    const dist = Math.min(ROOM_D * 0.82, fit(visW, h, fov, 1.08))
    const c = toWorld(z, pan.zone === z.slug ? pan.x : 0, (z.top + bottom) / 2, 0)
    // الكاميرا في مستوى نص الكادر (من غير ميل) — زي ما بتقف قدام الحيطة
    const pos = c.clone().addScaledVector(z.slot.normal, dist)
    return { pos, target: c, fov }
  }

  function shotPiece(p: LaidPiece, withCard: boolean): Shot {
    const z = zones.find((zz) => zz.slug === p.zone)!
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
    const dist = sheet ? fit(p.mw * 1.4, h / 0.38, fov, 1) : fit(p.mw * 1.6, h, fov, portrait() ? 1.4 : 1.6)
    const center = toWorld(z, cx, cy, p.box.z)
    const pos = center.clone().addScaledVector(z.slot.normal, dist)
    const target = center.clone()
    if (withCard) {
      const v = (fov * Math.PI) / 180
      const visH = 2 * dist * Math.tan(v / 2)
      if (portrait()) {
        // البطاقة تحت كشيت — القطعة تطلع فوق
        target.y -= visH * 0.28
        pos.y -= visH * 0.28
      } else {
        // البطاقة يمين (زي المرجع) — القطعة تروح شمال
        const visW = visH * aspect
        target.addScaledVector(z.slot.right, visW * 0.2)
        pos.addScaledVector(z.slot.right, visW * 0.2)
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

  function frame(now: number) {
    raf = 0
    let moving = false

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
      const limit = Math.max(0, z.width / 2 - 0.5)
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
