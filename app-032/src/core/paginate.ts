/**
 * 1:1 放样图分页（规格书 §4.5 / §8）
 * 规则：按真实毫米绘制；**同一块裁片不拆到两页**；跨页只发生在骨架长条图上，
 * 且带对位十字与拼接编号，并标注重叠搭接量。
 */
import type { FrameMember, Lantern, Panel } from './types'
import { buildFrame } from './frame'
import { buildPanels } from './panels'

export type PaperSize = 'A4' | 'A3'

export const PAPER_DIMS: Record<PaperSize, { wMm: number; hMm: number }> = {
  A4: { wMm: 210, hMm: 297 },
  A3: { wMm: 297, hMm: 420 }
}

export interface SheetItemCalibration {
  type: 'calibration'
  xMm: number
  yMm: number
  wMm: number
  hMm: number
}

export interface SheetItemPanel {
  type: 'panel'
  panel: Panel
  xMm: number
  yMm: number
  wMm: number
  hMm: number
}

export interface SheetItemStrip {
  type: 'strip'
  member: FrameMember
  xMm: number
  yMm: number
  /** 本段绘制长度（1:1，mm） */
  lengthMm: number
  /** 该构件截取总长（含余量，mm） */
  totalMm: number
  segIndex: number
  segCount: number
  /** 本段起点在整根构件上的位置（mm），用于 1:1 图上标注标尺读数 */
  startMm: number
  /** 拼接编号，如 S4-1/2 */
  tag: string
  /** 相邻段编号（用于标注搭接方向） */
  prevTag?: string
  nextTag?: string
  overlapMm: number
}

export type SheetItem = SheetItemCalibration | SheetItemPanel | SheetItemStrip

export interface Sheet {
  index: number
  title: string
  wMm: number
  hMm: number
  headerMm: number
  contentX: number
  contentY: number
  contentWMm: number
  contentHMm: number
  items: SheetItem[]
  warn?: string
}

export interface LoftOptions {
  paper: PaperSize
  includePanels: boolean
  includeStrips: boolean
  includeCalibration: boolean
  overlapMm: number
}

export const DEFAULT_LOFT_OPTIONS: LoftOptions = {
  paper: 'A4',
  includePanels: true,
  includeStrips: true,
  includeCalibration: true,
  overlapMm: 10
}

const MARGIN = 8
const HEADER = 12
const PANEL_PAD_X = 4
const PANEL_PAD_BOTTOM = 13
const ROW_GAP = 4
const STRIP_ROW_H = 17
const STRIP_GUTTER = 9
const EPS = 0.001

export function paginate(l: Lantern, opts: LoftOptions): Sheet[] {
  const dims = PAPER_DIMS[opts.paper]
  const contentX = MARGIN
  const contentY = HEADER + 4
  const contentW = dims.wMm - MARGIN * 2
  const contentH = dims.hMm - contentY - MARGIN
  const right = contentX + contentW
  const bottom = contentY + contentH

  const sheets: Sheet[] = []
  let sheet!: Sheet
  let cx = contentX
  let cy = contentY
  let rowH = 0

  const startSheet = (warn?: string) => {
    sheet = {
      index: sheets.length + 1,
      title: `放样图 ${opts.paper} · 第 ${sheets.length + 1} 页`,
      wMm: dims.wMm,
      hMm: dims.hMm,
      headerMm: HEADER,
      contentX,
      contentY,
      contentWMm: contentW,
      contentHMm: contentH,
      items: [],
      warn
    }
    sheets.push(sheet)
    cx = contentX
    cy = contentY
    rowH = 0
    return sheet
  }
  const dropEmptySheet = () => {
    if (sheet && sheet.items.length === 0) sheets.pop()
  }
  /** 取当前图纸；若尚未开页（例如关闭了校验页）则先开一张 */
  const ensureSheet = () => {
    if (!sheet) startSheet()
    return sheet
  }
  const nextRow = () => {
    cx = contentX
    cy += rowH + ROW_GAP
    rowH = 0
  }
  const fitsRow = (w: number) => cx + w <= right + EPS
  const fitsPage = (h: number) => cy + h <= bottom + EPS

  if (opts.includeCalibration) {
    const s = startSheet()
    s.title = `1:1 校验页 · ${opts.paper}（请按 100% 打印，关闭「适应页面」）`
    s.items.push({ type: 'calibration', xMm: contentX, yMm: contentY, wMm: contentW, hMm: contentH })
    cx = right
    rowH = contentH
  }

  if (opts.includePanels) {
    for (const p of buildPanels(l).panels) {
      const w = p.widthTopMm + PANEL_PAD_X * 2
      const h = p.heightMm + PANEL_PAD_BOTTOM
      if (w > contentW + EPS || h > contentH + EPS) {
        // 超出可打印区：整块单独一页居中输出，绝不拆分
        dropEmptySheet()
        const s = startSheet(
          `裁片「${p.label}」裁切尺寸 ${f1(p.widthTopMm)}×${f1(p.heightMm)}mm 超出 ${opts.paper} 可打印区（${f1(contentW)}×${f1(contentH)}mm）：已整块居中输出、未拆分，请改用 A3 或按拼接编号手工接纸。`
        )
        s.items.push({
          type: 'panel',
          panel: p,
          xMm: contentX + Math.max(0, (contentW - w) / 2),
          yMm: contentY + Math.max(0, (contentH - h) / 2),
          wMm: w,
          hMm: h
        })
        cx = right
        cy = bottom
        rowH = 0
        continue
      }
      if (!fitsRow(w)) nextRow()
      if (!fitsPage(h)) startSheet()
      ensureSheet().items.push({ type: 'panel', panel: p, xMm: cx, yMm: cy, wMm: w, hMm: h })
      cx += w + ROW_GAP
      rowH = Math.max(rowH, h)
    }
  }

  if (opts.includeStrips) {
    const usable = contentW - STRIP_GUTTER - 4
    const overlap = Math.max(0, opts.overlapMm)
    for (const m of buildFrame(l).members) {
      const total = m.lengthMm
      const advanceMm = Math.max(10, usable - overlap)
      const segCount = total <= usable + EPS ? 1 : Math.ceil((total - overlap) / advanceMm)
      for (let i = 0; i < segCount; i++) {
        const start = i * advanceMm
        const len = Math.max(1, Math.min(total, start + usable) - start)
        if (!fitsRow(contentW)) nextRow()
        if (!fitsPage(STRIP_ROW_H)) startSheet()
        const cur = ensureSheet()
        const tag = `S${cur.index}-${i + 1}/${segCount}`
        cur.items.push({
          type: 'strip',
          member: m,
          xMm: cx + STRIP_GUTTER,
          yMm: cy,
          lengthMm: len,
          totalMm: total,
          segIndex: i,
          segCount,
          startMm: start,
          tag,
          overlapMm: segCount > 1 ? overlap : 0
        })
        cx = right
        rowH = STRIP_ROW_H
      }
    }
  }

  // 回填相邻段编号（拼接方向提示）
  const byMember = new Map<string, SheetItemStrip[]>()
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type !== 'strip') continue
      const arr = byMember.get(it.member.id) || []
      arr.push(it)
      byMember.set(it.member.id, arr)
    }
  }
  for (const arr of byMember.values()) {
    arr.sort((a, b) => a.segIndex - b.segIndex)
    arr.forEach((it, i) => {
      if (arr[i - 1]) it.prevTag = arr[i - 1].tag
      if (arr[i + 1]) it.nextTag = arr[i + 1].tag
    })
  }

  if (sheets.length === 0) startSheet()
  return sheets
}

function f1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1)
}

/** 断言：任一裁片不跨页（每块裁片在整份图纸中只出现一次且完整） */
export function assertNoPanelSplit(sheets: Sheet[]): { pass: boolean; detail: string; overflow: number } {
  const seen = new Map<string, number>()
  let overflow = 0
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type !== 'panel') continue
      seen.set(it.panel.id, (seen.get(it.panel.id) || 0) + 1)
      const fitsX = it.xMm >= s.contentX - EPS && it.xMm + it.wMm <= s.contentX + s.contentWMm + EPS
      const fitsY = it.yMm >= s.contentY - EPS && it.yMm + it.hMm <= s.contentY + s.contentHMm + EPS
      if (!fitsX || !fitsY) overflow++
    }
  }
  const split = [...seen.entries()].filter(([, n]) => n > 1)
  const pass = split.length === 0
  return {
    pass,
    overflow,
    detail: pass
      ? `共 ${seen.size} 种裁片，每块只出现在一页且完整（超区整块输出 ${overflow} 块）`
      : `存在跨页裁片：${split.map(([id, n]) => `${id}×${n}`).join('、')}`
  }
}
