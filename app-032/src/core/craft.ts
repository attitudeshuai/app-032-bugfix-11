/** 本地打包的灯型库与工艺参数（断网可用，无运行期外部请求） */
import raw from '../data/lantern-types.json'
import type { Covering } from './types'

export interface CoveringSpec {
  id: Covering
  name: string
  gluePerM2: number
  wasteRatio: number
  color: string
  note: string
}

export interface PresetParams {
  maxDiameterMm: number
  totalHeightMm: number
  mouthDiameterMm: number
  baseDiameterMm: number
  sides: number
  layerCount: number
  mouthStyle: 'flat' | 'taper' | 'gourd'
  bottomStyle: 'flat' | 'taper' | 'gourd'
  smoothness: number
  divisions?: number
  ctrl1?: { x: number; y: number }
  ctrl2?: { x: number; y: number }
  covering: Covering
  layerColors: string[]
  color: string
}

export interface LanternPreset {
  id: string
  name: string
  kind: 'prism' | 'revolution' | 'polyhedron' | 'box'
  tagline: string
  description: string
  params: PresetParams
}

export const CRAFT = raw.craft as {
  defaultLashAllowanceMm: number
  defaultSeamAllowanceMm: number
  defaultOverlapMm: number
  defaultDivisions: number
  divMin: number
  divMax: number
  lashPerJointM: number
  led: { perLiter: number; min: number; rule: string }
}

export const COVERINGS = raw.coverings as CoveringSpec[]
export const PRESETS = raw.presets as LanternPreset[]

export function coveringSpec(id: Covering): CoveringSpec {
  return COVERINGS.find((c) => c.id === id) || COVERINGS[0]
}

export function presetById(id: string): LanternPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export const KIND_LABELS: Record<string, string> = {
  prism: '正多棱柱',
  revolution: '旋转体',
  polyhedron: '多面体',
  box: '方形走马灯'
}

export const STYLE_LABELS: Record<string, string> = {
  flat: '平口',
  taper: '收口',
  gourd: '葫芦口'
}

export const COVERING_LABELS: Record<string, string> = {
  xuan: '宣纸',
  silk: '绸布',
  parchment: '羊皮纸'
}

export function kindLabel(k: string): string {
  return KIND_LABELS[k] || k
}

export function styleLabel(s: string): string {
  return STYLE_LABELS[s] || s
}

export function coveringLabel(c: string): string {
  return COVERING_LABELS[c] || c
}
