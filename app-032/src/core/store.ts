/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 *
 * 三处同一份结论：
 *   1. 本机存档（localStorage，本文件持久化）
 *   2. 灯样列表（HomeView，直接读 state.lanterns）
 *   3. 放样/裁片页的分层直径表（DesignView / PanelsView 读同一对象的 layers）
 * state.lanterns 是唯一事实来源；layers[].diameterMm 是轮廓派生的缓存值，
 * 改任何轮廓参数后都要重新推算，存档前再整体刷一遍。
 *
 * 旧档兼容取舍（二选一，本实现选 B）：
 *   A. 整份判坏 → 清空、按预设补一盏。页面马上干净，但用户存过的灯全作废。
 *   B. 尽力抢救【采用】→ 逐灯修复，缺项按内置预设默认值顶上、缺的直径按当前
 *      参数重算；只丢弃一盏里「有效层高都读不出」的那一盏；整份 JSON 无法解析、
 *      或信封结构对不上（拿不到灯样数组）时才整份作废并补一盏预设灯。
 *      代价：留下来的灯未必与当初存档逐位一致。
 *   无论走 A 还是 B，都会在页面上挂一条说明，不会闷声换数；读档期间禁止写入。
 */
import { reactive, watch } from 'vue'
import type { Lantern, LanternKind, LayerSpec, MouthStyle, Covering, PageSize, Point2 } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, clamp, effectiveHeight, r1 } from './geometry'

const KEY = 'lantern-frame-lofting.v1'
const CURRENT_VERSION = 1

/** 读档后挂在页面上的说明（取了哪条兼容路线、作废/留下了谁） */
export interface StoreNotice {
  kind: 'reset' | 'partial'
  title: string
  detail: string
  /** 作废的灯样名（无法辨认时给占位说明） */
  dropped: string[]
  /** 留下的灯样名 */
  kept: string[]
}

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
  notice: StoreNotice | null
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '', notice: null })

/** 读档闸门：读档期间为 true，persistNow 直接退回，不许把正在读的这一份压掉 */
let loading = true
let timer: number | undefined
/** updatedAt 防抖：同一盏灯 1.5s 内的连续修改只记一次时间，也防止 watch 自激 */
const lastTouchAt = new Map<string, number>()

const KINDS: LanternKind[] = ['prism', 'revolution', 'polyhedron', 'box']
const STYLES: MouthStyle[] = ['flat', 'taper', 'gourd']
const COVERINGS: Covering[] = ['xuan', 'silk', 'parchment']

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function asPositiveNum(v: unknown, fallback: number): number {
  return isFiniteNum(v) && v > 0 ? v : fallback
}

function asNonNegativeNum(v: unknown, fallback: number): number {
  return isFiniteNum(v) && v >= 0 ? v : fallback
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function asPoint(v: unknown, fallback: Point2): Point2 {
  if (v && typeof v === 'object') {
    const x = (v as Point2).x
    const y = (v as Point2).y
    if (isFiniteNum(x) && isFiniteNum(y)) return { x, y }
  }
  return { ...fallback }
}

function asIso(v: unknown, fallback: string): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback
}

function asHexColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback
}

/** 依据灯型库预设新建灯样 */
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

/** 把轮廓算出的直径写回分层（数据模型：layers[].diameterMm 永远是派生值），同时按分层高之和回写总高 */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 用最新几何核对存档/界面里的分层直径是否还是老数；任一层对不上即视为陈旧 */
export function diameterStaleLayers(l: Lantern): boolean[] {
  const g = buildGeometry(l)
  return l.layers.map((ly, i) => {
    const sec = g.sections[i + 1]
    return !sec || Math.abs(ly.diameterMm - r1(sec.radiusMm * 2)) > 0.05
  })
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

/** 标记一盏灯刚被改过（刷新最近修改时间，带 1.5s 合并窗口） */
export function touchLantern(l: Lantern) {
  const nowMs = Date.now()
  const prev = lastTouchAt.get(l.id) ?? 0
  if (nowMs - prev < 1500) return
  lastTouchAt.set(l.id, nowMs)
  l.updatedAt = new Date(nowMs).toISOString()
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

/** 灯样深拷贝（structuredClone 不能克隆 Vue 的响应式 Proxy，这里按灯样结构手动拷） */
function cloneLantern(src: Lantern): Lantern {
  return {
    ...src,
    layers: src.layers.map((ly) => ({ heightMm: ly.heightMm, diameterMm: ly.diameterMm })),
    layerColors: [...src.layerColors],
    ctrl1: { ...src.ctrl1 },
    ctrl2: { ...src.ctrl2 }
  }
}

/** 深拷贝一盏灯：新编号、新名字、layers/layerColors/控制点各存一套，动副本不影响原件 */
export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const now = new Date().toISOString()
  const copy: Lantern = {
    ...cloneLantern(src),
    id: makeId(),
    name: uniqueName(src.name + ' 副本'),
    createdAt: now,
    updatedAt: now
  }
  state.lanterns.unshift(copy)
  return copy
}

function uniqueName(preferred: string): string {
  const taken = new Set(state.lanterns.map((l) => l.name))
  if (!taken.has(preferred)) return preferred
  for (let i = 2; ; i++) {
    const candidate = `${preferred} ${i}`
    if (!taken.has(candidate)) return candidate
  }
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

export function dismissNotice() {
  state.notice = null
}

/** 最近修改时间：年-月-日 时:分（列表用，不能只给年月日） */
export function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// 读档与兼容修复
// ---------------------------------------------------------------------------

/**
 * 把一盏读出来的旧/残灯修回当前形状。
 * 规则：缺的标量按内置预设默认值顶上；layers 逐个过滤，没有有效正高度的层丢掉；
 * 直径全部不信存档、由几何重算。一盏灯一层都救不回时返回 null（整条丢弃）。
 */
function repairLantern(raw: unknown): { lantern: Lantern; nameForNotice: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const base = PRESETS[0].params
  const now = new Date().toISOString()

  const rawLayers = Array.isArray(o.layers) ? (o.layers as unknown[]) : []
  const layers: LayerSpec[] = []
  for (const item of rawLayers) {
    if (!item || typeof item !== 'object') continue
    const h = (item as Record<string, unknown>).heightMm
    if (!isFiniteNum(h) || h <= 0) continue // 这一段读不成 → 丢掉这一段
    layers.push({ heightMm: r1v(Math.min(h, 3000)), diameterMm: 0 })
  }
  if (layers.length === 0) return null // 一段都救不回 → 整盏丢弃

  const kind = asEnum(o.kind, KINDS, PRESETS[0].kind)
  const covering = asEnum(o.covering, COVERINGS, base.covering)
  const color = asHexColor(o.color, base.color)
  const totalFromLayers = layers.reduce((s, x) => s + x.heightMm, 0)

  const rawColors = Array.isArray(o.layerColors) ? (o.layerColors as unknown[]) : []
  const layerColors = layers.map((_, i) => asHexColor(rawColors[i], color))

  const lantern: Lantern = {
    id: typeof o.id === 'string' && o.id ? o.id : makeId(),
    kind,
    name: typeof o.name === 'string' && o.name.trim() ? o.name : '未命名灯样',
    maxDiameterMm: asPositiveNum(o.maxDiameterMm, base.maxDiameterMm),
    // 存档总高不可信时以分层高之和为准
    totalHeightMm: asPositiveNum(o.totalHeightMm, totalFromLayers),
    mouthDiameterMm: asPositiveNum(o.mouthDiameterMm, base.mouthDiameterMm),
    baseDiameterMm: asPositiveNum(o.baseDiameterMm, base.baseDiameterMm),
    sides: Math.max(3, Math.round(asPositiveNum(o.sides, base.sides))),
    layers,
    mouthStyle: asEnum(o.mouthStyle, STYLES, base.mouthStyle),
    bottomStyle: asEnum(o.bottomStyle, STYLES, base.bottomStyle),
    smoothness: clamp(asNonNegativeNum(o.smoothness, base.smoothness), 0, 1),
    ctrl1: asPoint(o.ctrl1, base.ctrl1 ?? { x: 0.12, y: 0.3 }),
    ctrl2: asPoint(o.ctrl2, base.ctrl2 ?? { x: 0.85, y: 0.78 }),
    divisions: Math.max(
      CRAFT.divMin,
      Math.min(CRAFT.divMax, Math.round(asPositiveNum(o.divisions, base.divisions ?? CRAFT.defaultDivisions)))
    ),
    covering,
    seamAllowanceMm: asNonNegativeNum(o.seamAllowanceMm, CRAFT.defaultSeamAllowanceMm),
    lashAllowanceMm: asNonNegativeNum(o.lashAllowanceMm, CRAFT.defaultLashAllowanceMm),
    layerColors,
    color,
    batchCount: Math.max(1, Math.round(asPositiveNum(o.batchCount, 20))),
    wasteRatio: clamp(asNonNegativeNum(o.wasteRatio, coveringSpec(covering).wasteRatio), 0, 0.2),
    pageSize: asEnum(o.pageSize, ['A4', 'A3'] as PageSize[], 'A4'),
    overlapMm: asNonNegativeNum(o.overlapMm, CRAFT.defaultOverlapMm),
    createdAt: asIso(o.createdAt, now),
    updatedAt: asIso(o.updatedAt, now)
  }
  // 缺的直径、与层高对不上的总高，全部按当前参数重算
  syncLayerDiameters(lantern)
  return { lantern, nameForNotice: lantern.name }
}

function buildResetNotice(reason: string, droppedHint: string[]): StoreNotice {
  const fallback = createFromPreset(PRESETS[0].id)
  return {
    kind: 'reset',
    title: '本机存档读不出，已按预设灯型重建',
    detail:
      `读取本机存档时失败：${reason}。在「整份作废」与「逐盏抢救」两条路里，这份存档连一盏完整灯样都给不出，` +
      `只能走整份作废：以程序内置灯型库为准，已自动放入一盏「${fallback.name}」，页面可立即使用。` +
      '放弃的是原存档里的全部灯样（已无法辨认/恢复）。之后的修改照常保存在本机。',
    dropped: droppedHint,
    kept: [fallback.name]
  }
}

/** 载入本地灯样（同步执行，main.ts 在挂载前调用一次） */
export function loadStore() {
  if (state.ready) return
  loading = true // 读档闸门关上：期间任何 persistNow 都不许落盘
  if (timer !== undefined) window.clearTimeout(timer)

  let raw: string | null = null
  let readError = ''
  try {
    raw = localStorage.getItem(KEY)
  } catch (e) {
    readError = `本机存储不可读（${(e as Error).message}）`
  }

  if (readError || raw == null) {
    // 第一次使用（根本没有存档）：安静地给一盏；存储读不了才挂说明
    state.lanterns = [createFromPreset(PRESETS[0].id)]
    state.notice = readError ? buildResetNotice(readError, ['原存档无法读取']) : null
    state.storageError = readError
  } else if (raw === '') {
    state.lanterns = [createFromPreset(PRESETS[0].id)]
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      parsed = null
      state.notice = buildResetNotice(`存档不是合法 JSON（${(e as Error).message}）`, ['原存档内容无法解析，灯样数量未知'])
      state.lanterns = [createFromPreset(PRESETS[0].id)]
    }

    if (parsed !== null) {
      // 兼容两种信封：{version, lanterns:[]} 与更早的「顶层直接是数组」
      let rawList: unknown[] | null = null
      if (Array.isArray(parsed)) {
        rawList = parsed
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).lanterns)) {
        rawList = (parsed as Record<string, unknown>).lanterns as unknown[]
      }

      if (rawList === null) {
        state.notice = buildResetNotice('存档格式与当前版本对不上（找不到灯样列表）', ['原存档中的灯样'])
        state.lanterns = [createFromPreset(PRESETS[0].id)]
      } else {
        const kept: Lantern[] = []
        const keptNames: string[] = []
        const droppedNames: string[] = []
        for (const item of rawList) {
          const repaired = repairLantern(item)
          if (repaired) {
            kept.push(repaired.lantern)
            keptNames.push(repaired.nameForNotice)
          } else {
            const n =
              item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string'
                ? ((item as Record<string, unknown>).name as string)
                : '一盏名称读不出的灯样'
            droppedNames.push(n)
          }
        }

        if (kept.length === 0) {
          state.notice = buildResetNotice('存档里的灯样没有一盏能对上当前参数格式', droppedNames)
          state.lanterns = [createFromPreset(PRESETS[0].id)]
        } else {
          state.lanterns = kept
          if (droppedNames.length > 0) {
            state.notice = {
              kind: 'partial',
              title: `本机存档有 ${droppedNames.length} 盏灯读不成，已保留其余 ${kept.length} 盏`,
              detail:
                '读取本机存档时，部分灯样的参数与当前格式对不上。这里走的是「逐盏抢救」：能认出的灯样尽量保留继续用，' +
                '只把读不成的那一段/那一盏丢掉；保留灯样里缺的参数按内置预设默认值顶上，各层直径一律按当前参数重新推算。' +
                '代价：留下来的灯看到的数值可能与当初存档不完全一致（缺项已被默认值替换）。',
              dropped: droppedNames,
              kept: keptNames
            }
          }
          // 全救回但一盏灯都没有（空数组存档）：自动补一盏，不挂警告
          if (state.lanterns.length === 0) state.lanterns = [createFromPreset(PRESETS[0].id)]
        }
      }
    }
  }

  state.ready = true
  loading = false // 读档完成，闸门打开

  watch(
    () => state.lanterns,
    () => {
      schedulePersist()
    },
    { deep: true }
  )

  // 读档完成后的一次性落盘：把修复/重算后的干净结论写回去（此时已不在读档期间）
  persistNow()
}

function persistNow() {
  // 读档期间挡住写入，绝不能把正在读的那一份压掉
  if (loading) return
  try {
    // 存档前：每盏灯的每一层直径都按当前参数刷新一遍，总高也按分层高之和回写
    for (const l of state.lanterns) syncLayerDiameters(l)
    localStorage.setItem(KEY, JSON.stringify({ version: CURRENT_VERSION, lanterns: state.lanterns }))
    state.storageError = ''
  } catch (e) {
    state.storageError = `本机存储写入失败（${(e as Error).message}），刷新后可能丢失最近修改`
  }
}

function schedulePersist() {
  if (loading) return
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
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
    diameterStaleLayers,
    touchLantern,
    formatUpdatedAt,
    dismissNotice
  }
}
