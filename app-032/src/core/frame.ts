/**
 * 骨架构件表（规格书 §4.3）
 * 绑扎余量：竖篾两端各加 lashAllowanceMm；横篾圈接头处按「圆形 1 处 / 多边形 n 处」加。
 * lengthMm（含余量）用于备料，rawLengthMm（净长）用于核对。
 */
import type { FrameMember, Lantern } from './types'
import {
  buildGeometry,
  polygonEdge,
  polyhedronInfo,
  r1,
  segmentInfos,
  shoulderBendRadius,
  TAU,
  type Geometry
} from './geometry'

export interface FrameResult {
  geometry: Geometry
  members: FrameMember[]
  /** 构件总根数 */
  totalQty: number
  /** 备料总长（含余量，mm） */
  stockLengthMm: number
  /** 净长合计（mm） */
  rawLengthMm: number
  /** 全部绑扎余量合计（mm） */
  lashExtraMm: number
}

export function buildFrame(l: Lantern): FrameResult {
  const g = buildGeometry(l)
  const lash = Math.max(0, l.lashAllowanceMm)
  const members: FrameMember[] = []
  let seq = 0
  const push = (m: Omit<FrameMember, 'id'>) => {
    members.push({ ...m, id: `FM${String(++seq).padStart(3, '0')}` })
  }

  if (l.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const isTetra = info.kind === 'tetra'
    push({
      kind: 'vertical',
      label: isTetra ? '棱篾（正四面体）' : '棱篾（正八面体）',
      rawLengthMm: r1(info.edgeMm),
      lengthMm: r1(info.edgeMm + 2 * lash),
      qty: isTetra ? 6 : 12,
      lashJoints: 2,
      bendAngleDeg: 60,
      group: '棱篾',
      note: `端头夹角 60°（正三角形面角，两端各留 ${lash}mm 绑扎余量）`
    })
    return summarize(g, members)
  }

  const n = g.n
  const segs = segmentInfos(g)
  const cornerLength = segs.reduce((s, x) => s + x.slantMm, 0)

  if (l.kind === 'prism' || l.kind === 'box') {
    push({
      kind: 'vertical',
      label: '竖篾',
      rawLengthMm: r1(cornerLength),
      lengthMm: r1(cornerLength + 2 * lash),
      qty: n,
      lashJoints: 2,
      group: '竖篾',
      note: `沿轮廓折线长（${segs.length} 段累计），两端各留 ${lash}mm`
    })
    const bendAngle = 180 - 360 / n
    for (let i = 1; i < g.sections.length - 1; i++) {
      const r = g.sections[i].radiusMm
      const edge = polygonEdge(r, n)
      push({
        kind: 'ring',
        label: `第 ${i} 层横篾`,
        rawLengthMm: r1(edge),
        lengthMm: r1(edge + lash),
        qty: n,
        lashJoints: 1,
        bendAngleDeg: r1(bendAngle),
        group: `横篾（第 ${i} 层）`,
        note: `圈直径 ${r1(r * 2)}mm，合围 ${n} 根，含 1 处接头余量`
      })
    }
    const topR = g.sections[g.sections.length - 1].radiusMm
    const botR = g.sections[0].radiusMm
    const topEdge = polygonEdge(topR, n)
    const botEdge = polygonEdge(botR, n)
    push({
      kind: 'mouth_ring',
      label: '收口圈',
      rawLengthMm: r1(topEdge),
      lengthMm: r1(topEdge + lash),
      qty: n,
      lashJoints: 1,
      bendAngleDeg: r1(bendAngle),
      bendRadiusMm: r1(shoulderBendRadius(g.maxR - topR, g.heightMm * g.kTop)),
      group: '收口圈',
      note: `收口外接直径 ${r1(topR * 2)}mm，收口段曲率半径建议值`
    })
    push({
      kind: 'base_ring',
      label: '底盘圈',
      rawLengthMm: r1(botEdge),
      lengthMm: r1(botEdge + lash),
      qty: n,
      lashJoints: 1,
      bendAngleDeg: r1(bendAngle),
      bendRadiusMm: r1(shoulderBendRadius(g.maxR - botR, g.heightMm * g.kBot)),
      group: '底盘圈',
      note: `底盘外接直径 ${r1(botR * 2)}mm`
    })
    if (l.kind === 'box') {
      push({
        kind: 'spoke',
        label: '中轴（走马灯转轴）',
        rawLengthMm: r1(g.heightMm),
        lengthMm: r1(g.heightMm + 2 * lash),
        qty: 1,
        lashJoints: 2,
        group: '走马机构',
        note: '贯穿灯体中轴，两端各留绑扎余量'
      })
      const spokeLen = (botR + topR) / 2
      push({
        kind: 'spoke',
        label: '上下辐条',
        rawLengthMm: r1(spokeLen),
        lengthMm: r1(spokeLen + lash),
        qty: n * 2,
        lashJoints: 1,
        group: '走马机构',
        note: `上 ${n} 根 + 下 ${n} 根，由中心到棱角支撑中轴`
      })
    }
  } else {
    // 旋转体
    push({
      kind: 'rib',
      label: '竖篾（母线篾）',
      rawLengthMm: r1(cornerLength),
      lengthMm: r1(cornerLength + 2 * lash),
      qty: n,
      lashJoints: 2,
      group: '竖篾',
      note: `按母线折线长（${segs.length} 段累计），两端各留 ${lash}mm`
    })
    for (let i = 1; i < g.sections.length - 1; i++) {
      const r = g.sections[i].radiusMm
      const circ = TAU * r
      push({
        kind: 'ring',
        label: `第 ${i} 层横篾圈`,
        rawLengthMm: r1(circ),
        lengthMm: r1(circ + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(r),
        group: `横篾圈（第 ${i} 层）`,
        note: `圈直径 ${r1(r * 2)}mm，圆形圈 1 处接头`
      })
    }
    const topR = g.sections[g.sections.length - 1].radiusMm
    const botR = g.sections[0].radiusMm
    push({
      kind: 'mouth_ring',
      label: '收口圈',
      rawLengthMm: r1(TAU * topR),
      lengthMm: r1(TAU * topR + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(topR),
      group: '收口圈',
      note: `圈直径 ${r1(topR * 2)}mm，弯曲半径 = 口径/2 = ${r1(topR)}mm`
    })
    push({
      kind: 'base_ring',
      label: '底盘圈',
      rawLengthMm: r1(TAU * botR),
      lengthMm: r1(TAU * botR + lash),
      qty: 1,
      lashJoints: 1,
      bendRadiusMm: r1(botR),
      group: '底盘圈',
      note: `圈直径 ${r1(botR * 2)}mm`
    })
    if (l.mouthStyle !== 'flat') {
      push({
        kind: 'ring',
        label: '收口支撑篾',
        rawLengthMm: r1(TAU * ((topR + g.maxR) / 2)),
        lengthMm: r1(TAU * ((topR + g.maxR) / 2) + lash),
        qty: 1,
        lashJoints: 1,
        bendRadiusMm: r1(shoulderBendRadius(g.maxR - topR, g.heightMm * g.kTop)),
        group: '收口圈',
        note: '撑起收口肩部曲线，弯曲半径由收口口径与收口段高决定'
      })
    }
  }

  return summarize(g, members)
}

function summarize(geometry: Geometry, members: FrameMember[]): FrameResult {
  let totalQty = 0
  let stockLengthMm = 0
  let rawLengthMm = 0
  for (const m of members) {
    totalQty += m.qty
    stockLengthMm += m.lengthMm * m.qty
    rawLengthMm += m.rawLengthMm * m.qty
  }
  return {
    geometry,
    members,
    totalQty,
    stockLengthMm: r1(stockLengthMm),
    rawLengthMm: r1(rawLengthMm),
    lashExtraMm: r1(stockLengthMm - rawLengthMm)
  }
}

/** 构件按分组归并（构件表按类别分组展示） */
export function groupMembers(members: FrameMember[]): { group: string; items: FrameMember[] }[] {
  const order: string[] = []
  const map = new Map<string, FrameMember[]>()
  for (const m of members) {
    if (!map.has(m.group)) {
      map.set(m.group, [])
      order.push(m.group)
    }
    map.get(m.group)!.push(m)
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }))
}
