/**
 * 几何计算（规格书 §8）
 *  - 正 n 棱柱底边（一根横篾）长 = 2 R sin(π/n)
 *  - 横篾圈周长 = 2πR（圆形）或 n × 底边长（多边形）
 *  - 竖篾长度 = 累计分段高（收口段按折线长累加）
 *  - 收口圈弯曲半径由口径与收口段高决定
 * 所有长度单位 mm，面积 mm²，体积 mm³。
 */
import type { Lantern, Point2 } from './types'

export const TAU = Math.PI * 2

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}

/** 保留 1 位小数（全项目长度按 mm 1 位小数） */
export function r1(v: number): number {
  return Math.round(v * 10) / 10
}

/** 保留 3 位小数（面积 m² 用） */
export function r3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** 轮廓采样点：x = 半径，y = 离底高度 */
export interface Section {
  index: number
  yMm: number
  radiusMm: number
}

export interface Geometry {
  kind: Lantern['kind']
  heightMm: number
  maxR: number
  mouthR: number
  baseR: number
  /** 棱数 / 母线根数 */
  n: number
  /** 侧面是否为平面多边形（棱柱/方灯） */
  polygon: boolean
  /** 上收口占高比例 */
  kTop: number
  /** 下收口占高比例 */
  kBot: number
  /** 分层截面（长度 = 层数 + 1，自底向上） */
  sections: Section[]
  /** 正视轮廓（密采样，用于绘图） */
  profile: Point2[]
}

export interface SegmentInfo {
  index: number
  y0Mm: number
  y1Mm: number
  r0Mm: number
  r1Mm: number
  /** 分段高 */
  heightMm: number
  /** 半径差 */
  drMm: number
  /** 母线折线长（竖篾/母线篾一段的长度） */
  slantMm: number
  /** 该段底边（一根横篾）长 */
  edgeBottomMm: number
  edgeTopMm: number
  /** 棱柱侧面梯形在自身平面内的高 */
  faceHeightMm: number
}

/** 手算公式：正 n 棱柱底边长 = 2 R sin(π/n) */
export function polygonEdge(r: number, n: number): number {
  return 2 * r * Math.sin(Math.PI / n)
}

/** 横篾圈周长：圆形 2πR / 多边形 n × 底边长 */
export function ringPerimeter(r: number, n: number, polygon: boolean): number {
  return polygon ? n * polygonEdge(r, n) : TAU * r
}

/** 顶/底盖面积：圆形 πR² / 正 n 边形 (n/2)R²sin(2π/n) */
export function capArea(r: number, n: number, polygon: boolean): number {
  return polygon ? ((n / 2) * r * r * Math.sin(TAU / n)) : Math.PI * r * r
}

/** 收口段曲率半径（弓高公式）：由口径变化与收口段高决定 */
export function shoulderBendRadius(dr: number, segHeight: number): number {
  if (dr <= 0.05) return 0
  return (segHeight * segHeight) / (2 * dr) + dr / 2
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/**
 * 生成母线（轮廓）采样点。
 * 结构：下肩部（可选）→ 直段（最大直径）→ 上肩部（可选/贝塞尔）
 */
function buildProfilePoints(l: Lantern, h: number, maxR: number, mouthR: number, baseR: number, kTop: number, kBot: number): Point2[] {
  const pts: Point2[] = []
  const yBotEnd = h * kBot
  const yTopStart = h * (1 - kTop)

  if (kBot > 0) {
    const p0 = { x: baseR, y: 0 }
    const p3 = { x: maxR, y: yBotEnd }
    // 下收口与上收口使用相同曲线形状（竖向镜像）
    let c1: Point2 = { x: 1 / 3, y: 1 / 3 }
    let c2: Point2 = { x: 2 / 3, y: 2 / 3 }
    if (l.bottomStyle === 'gourd') {
      c1 = l.ctrl1
      c2 = l.ctrl2
    }
    const p1 = { x: p0.x + (p3.x - p0.x) * c1.x, y: p0.y + (p3.y - p0.y) * c1.y }
    const p2 = { x: p0.x + (p3.x - p0.x) * c2.x, y: p0.y + (p3.y - p0.y) * c2.y }
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      pts.push({ x: cubic(p0.x, p1.x, p2.x, p3.x, t), y: cubic(p0.y, p1.y, p2.y, p3.y, t) })
    }
  } else {
    pts.push({ x: baseR, y: 0 })
  }

  if (yTopStart > yBotEnd + 0.001) {
    pts.push({ x: maxR, y: yBotEnd })
    pts.push({ x: maxR, y: yTopStart })
  }

  if (kTop > 0) {
    const p0 = { x: maxR, y: yTopStart }
    const p3 = { x: mouthR, y: h }
    let c1: Point2 = { x: 1 / 3, y: 1 / 3 }
    let c2: Point2 = { x: 2 / 3, y: 2 / 3 }
    if (l.mouthStyle === 'gourd') {
      c1 = { x: clamp(l.ctrl1.x, 0.02, 1.6), y: clamp(l.ctrl1.y, 0.02, 0.92) }
      c2 = { x: clamp(l.ctrl2.x, 0.02, 1.6), y: clamp(Math.max(l.ctrl2.y, c1.y + 0.04), c1.y + 0.04, 0.99) }
    }
    const p1 = { x: p0.x + (p3.x - p0.x) * c1.x, y: p0.y + (p3.y - p0.y) * c1.y }
    const p2 = { x: p0.x + (p3.x - p0.x) * c2.x, y: p0.y + (p3.y - p0.y) * c2.y }
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      pts.push({ x: cubic(p0.x, p1.x, p2.x, p3.x, t), y: cubic(p0.y, p1.y, p2.y, p3.y, t) })
    }
  } else {
    pts.push({ x: mouthR, y: h })
  }

  pts.sort((a, b) => a.y - b.y || a.x - b.x)
  // 去掉相邻重复点
  const out: Point2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - p.y) < 1e-4 && Math.abs(last.x - p.x) < 1e-4) continue
    out.push(p)
  }
  return out
}

/** 半径随高度变化函数（线性插值轮廓采样） */
export function radiusAtY(profile: Point2[], y: number): number {
  if (profile.length === 0) return 0
  if (y <= profile[0].y) return profile[0].x
  const last = profile[profile.length - 1]
  if (y >= last.y) return last.x
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]
    const b = profile[i]
    if (y <= b.y) {
      const span = b.y - a.y
      if (span < 1e-9) return b.x
      const t = (y - a.y) / span
      return a.x + (b.x - a.x) * t
    }
  }
  return last.x
}

export interface ShoulderPoints {
  p0: Point2
  p1: Point2
  p2: Point2
  p3: Point2
  c1: Point2
  c2: Point2
}

/** 上收口贝塞尔控制多边形（用于预览图上的可拖动控制点） */
export function topShoulder(l: Lantern, g: Geometry): ShoulderPoints | null {
  if (g.kTop <= 0) return null
  const p0: Point2 = { x: g.maxR, y: g.heightMm * (1 - g.kTop) }
  const p3: Point2 = { x: g.mouthR, y: g.heightMm }
  let c1: Point2 = { x: 1 / 3, y: 1 / 3 }
  let c2: Point2 = { x: 2 / 3, y: 2 / 3 }
  if (l.mouthStyle === 'gourd') {
    c1 = { x: clamp(l.ctrl1.x, 0.02, 1.6), y: clamp(l.ctrl1.y, 0.02, 0.92) }
    c2 = { x: clamp(l.ctrl2.x, 0.02, 1.6), y: clamp(Math.max(l.ctrl2.y, c1.y + 0.04), c1.y + 0.04, 0.99) }
  }
  return {
    p0,
    p1: { x: p0.x + (p3.x - p0.x) * c1.x, y: p0.y + (p3.y - p0.y) * c1.y },
    p2: { x: p0.x + (p3.x - p0.x) * c2.x, y: p0.y + (p3.y - p0.y) * c2.y },
    p3,
    c1,
    c2
  }
}

/** 有效总高 = 各分段高之和 */
export function effectiveHeight(l: Lantern): number {
  return l.layers.reduce((s, x) => s + Math.max(0, x.heightMm), 0)
}

/** 构建完整几何上下文 */
export function buildGeometry(l: Lantern): Geometry {
  const h = Math.max(1, effectiveHeight(l))
  const maxR = Math.max(1, l.maxDiameterMm / 2)
  // 多面体：n 保留 4 / 8 用于区分正四面体与正八面体；其余按棱数/母线根数
  const n = l.kind === 'polyhedron' ? (Math.round(l.sides) <= 4 ? 4 : 8) : Math.max(3, Math.round(l.sides))
  const polygon = l.kind === 'prism' || l.kind === 'box'
  const mouthR = l.mouthStyle === 'flat' ? maxR : clamp(l.mouthDiameterMm / 2, 1, maxR)
  const baseR = l.bottomStyle === 'flat' ? maxR : clamp(l.baseDiameterMm / 2, 1, maxR)

  let kTop = l.mouthStyle === 'flat' ? 0 : clamp(0.16 + 0.34 * l.smoothness, 0.06, 0.55)
  let kBot = l.bottomStyle === 'flat' ? 0 : clamp(0.16 + 0.34 * l.smoothness, 0.06, 0.55)
  if (kTop + kBot > 0.9) {
    const s = 0.9 / (kTop + kBot)
    kTop *= s
    kBot *= s
  }
  if (l.mouthStyle === 'flat') kTop = 0
  if (l.bottomStyle === 'flat') kBot = 0

  const profile = buildProfilePoints(l, h, maxR, mouthR, baseR, kTop, kBot)

  const sections: Section[] = []
  let y = 0
  sections.push({ index: 0, yMm: 0, radiusMm: radiusAtY(profile, 0) })
  l.layers.forEach((ly, i) => {
    y += Math.max(0, ly.heightMm)
    sections.push({ index: i + 1, yMm: y, radiusMm: radiusAtY(profile, y) })
  })

  return { kind: l.kind, heightMm: h, maxR, mouthR, baseR, n, polygon, kTop, kBot, sections, profile }
}

/** 分段明细：竖篾折线长、梯形面高、上下边长 */
export function segmentInfos(g: Geometry): SegmentInfo[] {
  const out: SegmentInfo[] = []
  for (let i = 0; i < g.sections.length - 1; i++) {
    const a = g.sections[i]
    const b = g.sections[i + 1]
    const dh = b.yMm - a.yMm
    const dr = b.radiusMm - a.radiusMm
    const slant = Math.sqrt(dh * dh + dr * dr)
    const edgeBottom = polygonEdge(a.radiusMm, g.n)
    const edgeTop = polygonEdge(b.radiusMm, g.n)
    const halfDelta = (edgeTop - edgeBottom) / 2
    const faceHeight = g.polygon
      ? Math.sqrt(Math.max(0, slant * slant - halfDelta * halfDelta))
      : slant
    out.push({
      index: i,
      y0Mm: a.yMm,
      y1Mm: b.yMm,
      r0Mm: a.radiusMm,
      r1Mm: b.radiusMm,
      heightMm: dh,
      drMm: dr,
      slantMm: slant,
      edgeBottomMm: edgeBottom,
      edgeTopMm: edgeTop,
      faceHeightMm: faceHeight
    })
  }
  return out
}

/** 面片化的灯体侧面积（棱柱 = 平面多边形面；旋转体 = 等分平面片） */
export function lateralSurfaceArea(g: Geometry, divisions: number): number {
  let area = 0
  for (const s of segmentInfos(g)) {
    if (g.polygon) {
      area += g.n * ((s.edgeBottomMm + s.edgeTopMm) / 2) * s.faceHeightMm
    } else {
      const d = Math.max(3, divisions)
      const chordBottom = 2 * s.r0Mm * Math.sin(Math.PI / d)
      const chordTop = 2 * s.r1Mm * Math.sin(Math.PI / d)
      const slant = Math.sqrt(s.heightMm * s.heightMm + (s.r1Mm - s.r0Mm) ** 2)
      const halfD = (chordTop - chordBottom) / 2
      const hh = Math.sqrt(Math.max(0, slant * slant - halfD * halfD))
      area += d * ((chordBottom + chordTop) / 2) * hh
    }
  }
  return area
}

/** 灯体表面积（侧面 + 顶盖 + 底盖），旋转体按等分面片计 */
export function bodySurfaceArea(g: Geometry, divisions: number): number {
  if (g.kind === 'polyhedron') {
    const p = polyhedronInfo(g)
    return p.faceCount * p.faceAreaMm2
  }
  const top = g.sections[g.sections.length - 1]
  const bottom = g.sections[0]
  const topArea = g.polygon ? capArea(top.radiusMm, g.n, true) : (divisions / 2) * top.radiusMm ** 2 * Math.sin(TAU / divisions)
  const botArea = g.polygon ? capArea(bottom.radiusMm, g.n, true) : (divisions / 2) * bottom.radiusMm ** 2 * Math.sin(TAU / divisions)
  return lateralSurfaceArea(g, divisions) + topArea + botArea
}

/** 灯体体积（圆台/棱台公式，直接由分段积分） */
export function bodyVolume(g: Geometry): number {
  if (g.kind === 'polyhedron') return polyhedronInfo(g).volumeMm3
  const coef = g.polygon ? (g.n / 2) * Math.sin(TAU / g.n) : Math.PI
  let v = 0
  for (const s of segmentInfos(g)) {
    v += coef * (s.heightMm / 3) * (s.r0Mm * s.r0Mm + s.r0Mm * s.r1Mm + s.r1Mm * s.r1Mm)
  }
  return v
}

export interface PolyhedronInfo {
  kind: 'tetra' | 'octa'
  /** 棱长 */
  edgeMm: number
  /** 面数 */
  faceCount: number
  /** 单面面积 */
  faceAreaMm2: number
  /** 外接球半径 */
  circumR: number
  /** 灯体总高（顶点到底面） */
  heightMm: number
  volumeMm3: number
}

/** 正多面体：外接球直径 = maxDiameterMm；sides=4 → 正四面体，sides=8 → 正八面体 */
export function polyhedronInfo(g: Geometry): PolyhedronInfo {
  const R = g.maxR
  const kind: 'tetra' | 'octa' = g.n <= 4 ? 'tetra' : 'octa'
  if (kind === 'tetra') {
    const edge = (4 * R) / Math.sqrt(6)
    const faceAreaMm2 = (Math.sqrt(3) / 4) * edge * edge
    return {
      kind,
      edgeMm: edge,
      faceCount: 4,
      faceAreaMm2,
      circumR: R,
      heightMm: edge * Math.sqrt(2 / 3),
      volumeMm3: (edge * edge * edge) / (6 * Math.sqrt(2))
    }
  }
  const edge = R * Math.SQRT2
  const faceAreaMm2 = (Math.sqrt(3) / 4) * edge * edge
  return {
    kind,
    edgeMm: edge,
    faceCount: 8,
    faceAreaMm2,
    circumR: R,
    heightMm: 2 * R,
    volumeMm3: (Math.SQRT2 / 3) * edge * edge * edge
  }
}
