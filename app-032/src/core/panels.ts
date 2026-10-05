/**
 * 蒙面裁片放样（规格书 §4.4 / §8）
 * 裁片尺寸 = 展开净尺寸 + 缝份 × 2（每个尺寸方向的两条边各加一道缝份）。
 * 对位标记坐标位于「裁片坐标系」：原点为裁片（含缝份）外接框左下角，x 向右，y 向上，单位 mm。
 */
import type { Lantern, Panel, PanelMark, PanelShape } from './types'
import {
  buildGeometry,
  capArea,
  polyhedronInfo,
  r1,
  segmentInfos,
  TAU,
  type Geometry
} from './geometry'

export interface PanelResult {
  geometry: Geometry
  panels: Panel[]
  /** 净面积合计（不含缝份，mm²） */
  netAreaMm2: number
  /** 裁片面积合计（含缝份，mm²） */
  cutAreaMm2: number
  /** 裁片总块数 */
  totalQty: number
}

function areaOf(p: Panel, withSeam: boolean): number {
  switch (p.shape) {
    case 'circle': {
      if (p.polySides && p.polySides >= 3) {
        // 正多边形：面积 = n · apothem² · tan(π/n)，apothem = 对边距/2
        const a = p.widthTopMm / 2
        return p.polySides * a * a * Math.tan(Math.PI / p.polySides)
      }
      const d = withSeam ? p.widthTopMm : p.rawWidthTopMm
      return Math.PI * (d / 2) ** 2
    }
    case 'triangle':
      return (p.widthTopMm * p.heightMm) / 2
    default:
      return ((p.widthTopMm + p.widthBottomMm) / 2) * p.heightMm
  }
}

export function panelCutArea(p: Panel): number {
  return areaOf(p, true)
}

export function panelNetArea(p: Panel): number {
  if (p.shape === 'circle' && p.polySides && p.polySides >= 3) {
    const a = p.rawWidthTopMm / 2
    return p.polySides * a * a * Math.tan(Math.PI / p.polySides)
  }
  if (p.shape === 'triangle') {
    return (p.rawWidthTopMm * p.rawHeightMm) / 2
  }
  if (p.shape === 'circle') {
    return Math.PI * (p.rawWidthTopMm / 2) ** 2
  }
  return ((p.rawWidthTopMm + p.rawWidthBottomMm) / 2) * p.rawHeightMm
}

/** 生成四边对位标记（裁片坐标系） */
function trapezoidMarks(cutW: number, cutH: number, seam: number, tag: string): PanelMark[] {
  return [
    { x: r1(cutW / 2), y: 0, label: `${tag} 下沿中点` },
    { x: r1(cutW / 2), y: r1(cutH), label: `${tag} 上沿中点` },
    { x: r1(seam), y: r1(seam), label: `${tag} 左下角` },
    { x: r1(cutW - seam), y: r1(seam), label: `${tag} 右下角` }
  ]
}

export function buildPanels(l: Lantern): PanelResult {
  const g = buildGeometry(l)
  const s = Math.max(0, l.seamAllowanceMm)
  const panels: Panel[] = []
  let seq = 0
  const push = (p: Omit<Panel, 'id'>) => {
    panels.push({ ...p, id: `P${String(++seq).padStart(3, '0')}` })
  }

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const h = (info.edgeMm * Math.sqrt(3)) / 2
    const cutW = info.edgeMm + 2 * s
    const cutH = h + 2 * s
    const marks: PanelMark[] = [
      { x: 0, y: 0, label: '顶点 A' },
      { x: r1(cutW), y: 0, label: '顶点 B' },
      { x: r1(cutW / 2), y: r1(cutH), label: '顶点 C' }
    ]
    push({
      shape: 'triangle',
      label: info.kind === 'tetra' ? '正三角侧片（四面体）' : '正三角侧片（八面体）',
      rawWidthTopMm: r1(info.edgeMm),
      rawWidthBottomMm: r1(info.edgeMm),
      rawHeightMm: r1(h),
      widthTopMm: r1(cutW),
      widthBottomMm: r1(cutW),
      heightMm: r1(cutH),
      seamAllowanceMm: s,
      marksMm: marks,
      qty: info.faceCount,
      layerIndex: -1,
      color: l.layerColors[0] || l.color,
      note: `棱长 ${r1(info.edgeMm)}mm，三边各加 ${s}mm 缝份`
    })
    return finish(g, panels)
  }

  const segs = segmentInfos(g)
  const divisions = Math.max(3, Math.round(l.divisions))

  segs.forEach((sg, i) => {
    const color = l.layerColors[i] || l.color
    const isPolygon = g.polygon
    const rawBottom = isPolygon ? sg.edgeBottomMm : (TAU * sg.r0Mm) / divisions
    const rawTop = isPolygon ? sg.edgeTopMm : (TAU * sg.r1Mm) / divisions
    const rawH = isPolygon ? sg.faceHeightMm : sg.slantMm
    const cutW = Math.max(rawTop, rawBottom) + 2 * s
    const cutH = rawH + 2 * s
    const shape: PanelShape = Math.abs(rawTop - rawBottom) < 0.05 ? 'rectangle' : 'trapezoid'
    push({
      shape,
      label: isPolygon ? `侧面（第 ${i + 1} 层）` : `展开片（第 ${i + 1} 层）`,
      rawWidthTopMm: r1(rawTop),
      rawWidthBottomMm: r1(rawBottom),
      rawHeightMm: r1(rawH),
      widthTopMm: r1(rawTop + 2 * s),
      widthBottomMm: r1(rawBottom + 2 * s),
      heightMm: r1(cutH),
      seamAllowanceMm: s,
      marksMm: trapezoidMarks(cutW, cutH, s, `${i + 1}层`),
      qty: isPolygon ? g.n : divisions,
      layerIndex: i,
      color,
      note: isPolygon
        ? `上下边各加 ${s}mm 缝份，${g.n} 块围成一圈`
        : `按 ${divisions} 等分近似展开，每块上下边各加 ${s}mm 缝份`
    })
  })

  // 顶盖 / 底盖
  const topR = g.sections[g.sections.length - 1].radiusMm
  const botR = g.sections[0].radiusMm
  const coverPanel = (r: number, label: string, tag: string, color: string) => {
    if (g.polygon) {
      const apothem = r * Math.cos(Math.PI / g.n)
      const rawW = 2 * apothem
      const cutW = rawW + 2 * s
      const cutR = (apothem + s) / Math.cos(Math.PI / g.n)
      const marks: PanelMark[] = []
      for (let k = 0; k < g.n; k++) {
        const ang = -Math.PI / 2 + (TAU * k) / g.n
        marks.push({
          x: r1(cutW / 2 + cutR * Math.cos(ang)),
          y: r1(cutW / 2 + cutR * Math.sin(ang)),
          label: `${tag} ${k + 1} 号棱对位`
        })
      }
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: r1(rawW),
        rawWidthBottomMm: r1(rawW),
        rawHeightMm: r1(rawW),
        widthTopMm: r1(cutW),
        widthBottomMm: r1(cutW),
        heightMm: r1(cutW),
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(r),
        polySides: g.n,
        layerIndex: -1,
        color,
        note: `正 ${g.n} 边形裁片，对边距 ${r1(rawW)}mm，四周各加 ${s}mm 折边`
      })
    } else {
      const cutD = 2 * r + 2 * s
      const marks: PanelMark[] = [
        { x: r1(cutD / 2), y: r1(cutD / 2), label: `${tag} 中心` },
        { x: r1(cutD / 2), y: 0, label: `${tag} 0°` },
        { x: r1(cutD), y: r1(cutD / 2), label: `${tag} 90°` },
        { x: r1(cutD / 2), y: r1(cutD), label: `${tag} 180°` },
        { x: 0, y: r1(cutD / 2), label: `${tag} 270°` }
      ]
      push({
        shape: 'circle',
        label,
        rawWidthTopMm: r1(2 * r),
        rawWidthBottomMm: r1(2 * r),
        rawHeightMm: r1(2 * r),
        widthTopMm: r1(cutD),
        widthBottomMm: r1(cutD),
        heightMm: r1(cutD),
        seamAllowanceMm: s,
        marksMm: marks,
        qty: 1,
        radiusMm: r1(r),
        layerIndex: -1,
        color,
        note: `圆形裁片，净直径 ${r1(2 * r)}mm，含折边（四周各 ${s}mm）`
      })
    }
  }
  coverPanel(topR, '顶盖圆片', '顶盖', l.layerColors[l.layerColors.length - 1] || l.color)
  coverPanel(botR, '底盖圆片', '底盘', l.layerColors[0] || l.color)

  return finish(g, panels)
}

function finish(geometry: Geometry, panels: Panel[]): PanelResult {
  let net = 0
  let cut = 0
  let qty = 0
  for (const p of panels) {
    net += panelNetArea(p) * p.qty
    cut += panelCutArea(p) * p.qty
    qty += p.qty
  }
  return { geometry, panels, netAreaMm2: net, cutAreaMm2: cut, totalQty: qty }
}

/** 顶/底盖净面积（用于面积核对，与裁片公式独立来源） */
export function coverReferenceArea(g: Geometry, divisions: number): number {
  if (g.kind === 'polyhedron') return 0
  const top = g.sections[g.sections.length - 1].radiusMm
  const bot = g.sections[0].radiusMm
  if (g.polygon) return capArea(top, g.n, true) + capArea(bot, g.n, true)
  const d = Math.max(3, divisions)
  return (
    ((d / 2) * top * top * Math.sin(TAU / d)) + ((d / 2) * bot * bot * Math.sin(TAU / d))
  )
}
