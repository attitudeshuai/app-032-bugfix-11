/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 */
import { reactive, watch } from 'vue'
import type { Lantern } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'

const KEY = 'lantern-frame-lofting.v1'

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '' })

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
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

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
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
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = { ...src, name: src.name + ' 副本' }
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

function persistNow() {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: state.lanterns }))
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样 */
export function loadStore() {
  if (state.ready) return
  if (suspendPersist) return
  const raw = localStorage.getItem(KEY)
  if (raw) {
    const data = JSON.parse(raw) as { lanterns?: Lantern[] }
    state.lanterns = data.lanterns || []
  }
  state.ready = true
  watch(
    () => state.lanterns,
    () => {
      schedulePersist()
    },
    { deep: true }
  )
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
    syncLayerDiameters
  }
}
