/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 *
 * 单一事实来源：本机存档、灯样列表、放样页直径表三处必须是同一份结论。
 *  - 每一层的直径由当前参数（最大直径 / 收口 / 曲线强度 / 分段高 …）几何派生，
 *    只在参数变化后回写存档；任何一次写入本机前都会再按当前参数整灯刷新一遍。
 *  - 读取旧存档：选定「尽力挽救」策略（见 loadStore 注释），
 *    认得出的灯样逐盏修好留下、读不成的段落丢弃，页面上必须给出说明。
 *  - 读档期间加写锁，任何写盘都不允许压掉正在读的这一份。
 */
import { reactive, watch } from 'vue'
import type { Lantern, LayerSpec, LanternKind, MouthStyle, Covering, PageSize, Point2 } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'

const KEY = 'lantern-frame-lofting.v1'
/** 当前写入格式版本；读到更旧/更新的版本都按挽救路径处理 */
const CURRENT_VERSION = 2

const KINDS: LanternKind[] = ['prism', 'revolution', 'polyhedron', 'box']
const STYLES: MouthStyle[] = ['flat', 'taper', 'gourd']
const COVERINGS: Covering[] = ['xuan', 'silk', 'parchment']
const PAGES: PageSize[] = ['A4', 'A3']

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
  /** 读档后的说明（旧档修复 / 丢段 / 全清等），页面必须展示，不允许静默写换 */
  loadNotice: string
  /** 最近一次写盘时间（显示用，空字符串表示从未写过） */
  lastSavedAt: string
}

export const state = reactive<StoreState>({
  lanterns: [],
  ready: false,
  storageError: '',
  loadNotice: '',
  lastSavedAt: ''
})

/** 写盘去抖句柄 */
let timer: number | undefined
/** 读档写锁：读档期间为 true，任何写盘一律跳过，绝不允许把正在读的这一份压掉 */
let reading = false
/** 每盏灯可变内容的签名：签名变了才刷新 updatedAt（避免自动回写触发无限刷新） */
const signatures = new Map<string, string>()

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function point(v: unknown, fallback: Point2): Point2 {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return { x: num(o.x, fallback.x), y: num(o.y, fallback.y) }
  }
  return { ...fallback }
}

/** 依据灯型库预设新建灯样（不放入列表） */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  return lantern
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm，派生值） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  while (l.layerColors.length < count) l.layerColors.push(l.color)
  l.layerColors = l.layerColors.slice(0, count)
  syncLayerDiameters(l)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  signatures.set(l.id, mutableSignature(l))
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

/**
 * 复制灯样：副本是完全独立的一份——
 * 自己另给编号与名字，分段、配色、控制点各存一套（深拷贝），
 * 此后改副本的任何参数（名字 / 分段 / 配色 …）原灯样一处都不会跟着变。
 */
export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const now = new Date().toISOString()
  const copy: Lantern = {
    ...structuredClone(toPlain(src)),
    id: makeId(),
    name: uniqueCopyName(src.name),
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(copy)
  return addLantern(copy)
}

function uniqueCopyName(srcName: string): string {
  const used = new Set(state.lanterns.map((l) => l.name))
  const base = srcName + ' 副本'
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`
    if (!used.has(name)) return name
  }
}

/** 响应式代理转普通对象（structuredClone 不能直接处理代理，先过 JSON 保险） */
function toPlain(l: Lantern): Lantern {
  return JSON.parse(JSON.stringify(l)) as Lantern
}

/**
 * 删除灯样。删到一盏都不剩时按预设自动补一盏——
 * 本机存档与列表都不允许长期空着。
 */
export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i < 0) return
  state.lanterns.splice(i, 1)
  signatures.delete(id)
  if (state.ready && state.lanterns.length === 0) {
    addLantern(createFromPreset(PRESETS[0].id))
  }
}

/** 用户可手动关掉读档说明（只关本次会话的提示，不动数据） */
export function dismissLoadNotice() {
  state.loadNotice = ''
}

// ---- 存档读档：旧格式 / 缺项的兼容 ----

/**
 * 逐盏挽救一盏旧灯样。
 * 策略（两选一，此处明确选第二条）：
 *
 *  选「整份判坏清掉、再按预设给一盏」——页面马上能用，
 *  但用户存进本机的灯样无论好坏全部作废；
 *
 *  本实现选「尽量把还认得出的灯样留下来接着用」：
 *  还能认出是一盏灯（有 id 或 name 或 layers，且像对象）就按当前字段逐项校验，
 *  缺的 / 类型不对的参数用预设默认值顶上，分段高度非法时整段重排，
 *  留下后按当前参数重算每层直径与总高；完全读不成的那一“段”（整条记录）
 *  才丢掉。代价是留下的灯未必与当初存下的完全一致——缺项位置看到的是
 *  默认值而不是旧值，所以页面上必须把修过哪几盏、丢了几条讲清楚。
 *
 * 返回 null 表示这一条读不成、应丢弃。
 */
function salvageLantern(raw: unknown): { lantern: Lantern | null; repairs: string[] } {
  if (!raw || typeof raw !== 'object') return { lantern: null, repairs: [] }
  const o = raw as Record<string, unknown>
  // 连一个灯样该有的样子都不像（既无名称也无分层也无 id），判为读不成的一段
  const looksLikeLantern =
    typeof o.name === 'string' || Array.isArray(o.layers) || typeof o.id === 'string'
  if (!looksLikeLantern) return { lantern: null, repairs: [] }

  const kind = oneOf(o.kind, KINDS, PRESETS[0].kind)
  const preset = PRESETS.find((p) => p.kind === kind) || PRESETS[0]
  const d = preset.params
  const repairs: string[] = []
  const name: string =
    typeof o.name === 'string' && o.name.trim() ? o.name : `${preset.name}（修复）`
  if (!(typeof o.name === 'string' && o.name.trim())) repairs.push('名称缺失，已按灯型命名')

  // 分段：逐层高做数值校验；坏的那一层不拖垮其余层，缺高度按总高均摊补上
  let layers: LayerSpec[] = []
  if (Array.isArray(o.layers)) {
    const rawHeights = o.layers.map((x) =>
      x && typeof x === 'object' ? num((x as Record<string, unknown>).heightMm, NaN, 10, 3000) : NaN
    )
    const valid = rawHeights.filter((h) => Number.isFinite(h))
    const totalGuess =
      valid.length > 0
        ? valid.reduce((s, h) => s + h, 0) / valid.length * rawHeights.length
        : num(o.totalHeightMm, d.totalHeightMm, 40, 3000)
    const fallback = r1v(totalGuess / rawHeights.length)
    if (valid.length < rawHeights.length) repairs.push(`有 ${rawHeights.length - valid.length} 层分段高度不可读，已按均摊高度补上`)
    layers = rawHeights.map((h) => ({ heightMm: r1v(Number.isFinite(h) ? h : fallback), diameterMm: 0 }))
  }
  if (layers.length === 0) {
    const count = Math.max(1, Math.min(12, Math.round(num((o as unknown as { layerCount?: number }).layerCount, d.layerCount, 1, 12))))
    const each = num(o.totalHeightMm, d.totalHeightMm, 40, 3000) / count
    layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
    repairs.push('分段高度缺失或不可读，已按总高均分')
  }

  const totalFromLayers = layers.reduce((s, x) => s + x.heightMm, 0)
  const layerColors = (
    Array.isArray(o.layerColors)
      ? (o.layerColors as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c))
      : []
  )
  const mainColor = typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : d.color
  while (layerColors.length < layers.length) layerColors.push(mainColor)

  const isoNow = new Date().toISOString()
  const createdAt = typeof o.createdAt === 'string' && !Number.isNaN(Date.parse(o.createdAt)) ? o.createdAt : isoNow
  const updatedAt = typeof o.updatedAt === 'string' && !Number.isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : createdAt

  const covering = oneOf(o.covering, COVERINGS, d.covering)
  if (o.covering !== covering) repairs.push('蒙面类型缺失或不可读，已按预设补上')

  const lantern: Lantern = {
    id: typeof o.id === 'string' && o.id ? o.id : makeId(),
    kind,
    name,
    maxDiameterMm: num(o.maxDiameterMm, d.maxDiameterMm, 20, 3000),
    totalHeightMm: r1v(totalFromLayers),
    mouthDiameterMm: num(o.mouthDiameterMm, d.mouthDiameterMm, 1, 3000),
    baseDiameterMm: num(o.baseDiameterMm, d.baseDiameterMm, 1, 3000),
    sides: Math.round(num(o.sides, d.sides, 3, 96)),
    layers,
    mouthStyle: oneOf(o.mouthStyle, STYLES, d.mouthStyle),
    bottomStyle: oneOf(o.bottomStyle, STYLES, d.bottomStyle),
    smoothness: num(o.smoothness, d.smoothness, 0, 1),
    ctrl1: point(o.ctrl1, d.ctrl1 ?? { x: 0.12, y: 0.3 }),
    ctrl2: point(o.ctrl2, d.ctrl2 ?? { x: 0.85, y: 0.78 }),
    divisions: Math.round(num(o.divisions, d.divisions ?? CRAFT.defaultDivisions, CRAFT.divMin, CRAFT.divMax)),
    covering,
    seamAllowanceMm: num(o.seamAllowanceMm, CRAFT.defaultSeamAllowanceMm, 0, 40),
    lashAllowanceMm: num(o.lashAllowanceMm, CRAFT.defaultLashAllowanceMm, 0, 80),
    layerColors,
    color: mainColor,
    batchCount: Math.round(num(o.batchCount, 20, 1, 500)),
    // 损耗率缺省时跟随修复后的蒙面类型，而不是写死的预设蒙面
    wasteRatio: num(o.wasteRatio, coveringSpec(covering).wasteRatio, 0, 0.2),
    pageSize: oneOf(o.pageSize, PAGES, 'A4'),
    overlapMm: num(o.overlapMm, CRAFT.defaultOverlapMm, 0, 60),
    createdAt,
    updatedAt
  }
  // 缺项一律按当前参数重算每层直径，保证三处读数一致
  syncLayerDiameters(lantern)
  return { lantern, repairs }
}

function persistNow() {
  // 读档写锁：读档期间不写
  if (reading || !state.ready) return
  try {
    // 写入本机以前，每一层的直径按当前参数刷新一遍
    for (const l of state.lanterns) syncLayerDiameters(l)
    localStorage.setItem(KEY, JSON.stringify({ version: CURRENT_VERSION, lanterns: state.lanterns }))
    state.storageError = ''
    state.lastSavedAt = new Date().toISOString()
  } catch (err) {
    state.storageError = `本机存档写入失败：${(err as Error).message || err}；本次修改刷新后可能丢失。`
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/**
 * 一盏灯「会影响结果的可变内容」签名（不含 updatedAt 与派生直径）。
 * 签名变化才认为用户真的改过、才刷新 updatedAt。
 */
function mutableSignature(l: Lantern): string {
  return JSON.stringify({
    ...toPlain(l),
    updatedAt: '',
    layers: l.layers.map((ly) => ly.heightMm)
  })
}

/** 载入本地灯样（应用启动时调用一次） */
export function loadStore() {
  if (state.ready) return
  reading = true // —— 读档期间挡住一切写入 ——
  try {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(KEY)
    } catch (err) {
      state.storageError = `本机存档无法读取：${(err as Error).message || err}`
    }

    if (raw == null) {
      // 本机一盏灯样都没有（或存储被禁）：自动按预设给一盏，不允许空着
      addLantern(createFromPreset(PRESETS[0].id))
    } else {
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        // 整份 JSON 都读不成：挽救路径也无从逐盏下手，只能清掉坏档、补一盏预设
        state.loadNotice =
          '本机那份存档已损坏、整份无法读取，已按预设灯型自动补了一盏；原先存进本机的灯样无法找回。'
        try {
          localStorage.removeItem(KEY)
        } catch {
          /* 存储不可写时忽略，至少内存里给一盏可用 */
        }
        addLantern(createFromPreset(PRESETS[0].id))
        data = null
      }

      if (data != null) {
        const root = (data && typeof data === 'object' ? data : {}) as { version?: unknown; lanterns?: unknown }
        const versionMsg =
          typeof root.version === 'number' && root.version !== CURRENT_VERSION
            ? `本机存档为早先版本（v${root.version}，当前 v${CURRENT_VERSION}），已按新格式兼容读取。`
            : ''
        const structureBad = !Array.isArray(root.lanterns)
        const list = Array.isArray(root.lanterns) ? root.lanterns : Array.isArray(data) ? (data as unknown[]) : []
        const kept: Lantern[] = []
        const repairedNames: string[] = []
        let dropped = structureBad ? 1 : 0 // 外层结构都不对，视为读不成的一大段
        const seenIds = new Set<string>()
        for (const item of list) {
          const { lantern, repairs } = salvageLantern(item)
          if (!lantern) {
            dropped++
            continue
          }
          if (seenIds.has(lantern.id)) lantern.id = makeId()
          seenIds.add(lantern.id)
          if (repairs.length || versionMsg) {
            repairedNames.push(`${lantern.name}（${repairs.length ? repairs.join('、') : '格式已按当前版本校正'}）`)
          }
          kept.push(lantern)
        }

        if (kept.length === 0) {
          state.loadNotice =
            (versionMsg ? versionMsg + ' ' : '') +
            (structureBad
              ? '本机存档的整体结构与当前版本对不上，里面的灯样无法逐盏辨认，已全部判作读不成的记录丢弃。'
              : `存档里 ${dropped ? `${dropped} 盏灯样都读不成、已丢弃` : '没有可用的灯样'}。`) +
            '已按预设自动补一盏；缺的参数显示为预设默认值，与当初存下的数可能不完全一致。'
          addLantern(createFromPreset(PRESETS[0].id))
        } else {
          state.lanterns = kept
          for (const l of kept) signatures.set(l.id, mutableSignature(l))
          const parts: string[] = []
          if (versionMsg) parts.push(versionMsg)
          if (structureBad) parts.push('存档外层结构与当前版本不符，已只抢救其中还能认出的灯样。')
          if (repairedNames.length) parts.push(`已尽力保留 ${repairedNames.length} 盏并补齐缺项：${repairedNames.join('；')}。`)
          if (dropped) parts.push(`另有 ${dropped} 段记录完全读不成，已丢弃。`)
          parts.push('补齐的参数按预设默认值顶上，显示的数与当初存下的可能不完全一致。')
          if (versionMsg || repairedNames.length || dropped) state.loadNotice = parts.join('')
        }
      }
    }
  } finally {
    state.ready = true
    reading = false // —— 读档结束，放行写入 ——
  }

  watch(
    () => state.lanterns,
    () => {
      if (reading || !state.ready) return
      // 用户真改过的灯：刷新最近修改时间（直径回写不会造成连锁刷新）
      for (const l of state.lanterns) {
        const sig = mutableSignature(l)
        if (signatures.get(l.id) !== sig) {
          signatures.set(l.id, sig)
          l.updatedAt = new Date().toISOString()
        }
      }
      schedulePersist()
    },
    { deep: true }
  )
  // 读档完成后立刻把当前（已刷新直径的）这份落盘，把旧格式/缺项统一成当前格式
  persistNow()
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    dismissLoadNotice
  }
}
