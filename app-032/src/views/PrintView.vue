<script setup lang="ts">
/**
 * 1:1 放样图（分页与拼接标记）· 规格书 §4.5 / §4.7 / §8 / §9
 * - SVG 以毫米为绘图单位（viewBox 1 单位 = 1mm），width/height 用 mm，1:1 输出；
 * - 同一块裁片不拆到两页（由 paginate 保证，并在页面展示断言结果）；
 * - 骨架长条跨页处绘制对位十字、拼接编号与搭接量；
 * - 附 100mm 校验尺与 Ø100 校验圆，并显式提示「请关闭『适应页面』并按 100% 打印」。
 */
import { computed, onUnmounted, reactive, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import { CALIBRATION_CIRCLE_MM, CALIBRATION_RULER_MM, computeAll } from '../core/checks'
import {
  DEFAULT_LOFT_OPTIONS,
  PAPER_DIMS,
  assertNoPanelSplit,
  type LoftOptions,
  type SheetItem,
  type SheetItemPanel,
  type SheetItemStrip
} from '../core/paginate'
import { groupMembers } from '../core/frame'
import { kindName, shapeName } from '../core/exporter'
import { coveringLabel, kindLabel, styleLabel } from '../core/craft'
import type { Panel } from '../core/types'

type PrintMode = 'loft' | 'frame' | 'labels'

const route = useRoute()
const router = useRouter()

const lantern = computed(() => getLantern(route.params.id as string))
const mode = computed<PrintMode>(() => {
  const v = String(route.query.view || 'loft')
  return v === 'frame' || v === 'labels' ? v : 'loft'
})

const opts = reactive<LoftOptions>({ ...DEFAULT_LOFT_OPTIONS })

watch(
  lantern,
  (l) => {
    if (!l) return
    opts.paper = l.pageSize
    opts.overlapMm = l.overlapMm
  },
  { immediate: true }
)

// 打印设置回写到灯样（纸张 / 搭接量），与其它页面保持一致
watch(
  () => [opts.paper, opts.overlapMm] as const,
  ([paper, overlapMm]) => {
    const l = lantern.value
    if (!l) return
    l.pageSize = paper
    l.overlapMm = overlapMm
  }
)

const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...opts })
})

const sheets = computed(() => full.value?.sheets ?? [])
const splitCheck = computed(() => assertNoPanelSplit(sheets.value))
const frameGroups = computed(() => (full.value ? groupMembers(full.value.frame.members) : []))

const pageDims = computed(() => (mode.value === 'loft' ? PAPER_DIMS[opts.paper] : PAPER_DIMS.A4))

const coverDims = computed(() => {
  const g = full.value?.frame.geometry
  if (!g) return { topMm: 0, botMm: 0 }
  const s = g.sections
  return { topMm: s[s.length - 1].radiusMm * 2, botMm: s[0].radiusMm * 2 }
})

/** 动态注入 @page 尺寸，保证 1:1（含 A3 横向页面尺寸） */
watchEffect(() => {
  const dims = pageDims.value
  let el = document.getElementById('loft-page-style') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'loft-page-style'
    document.head.appendChild(el)
  }
  el.textContent = `@page { size: ${dims.wMm}mm ${dims.hMm}mm; margin: 0; }`
})

onUnmounted(() => {
  document.getElementById('loft-page-style')?.remove()
})

const labelPages = computed(() => {
  const list = full.value?.panels.panels ?? []
  const out: Panel[][] = []
  for (let i = 0; i < list.length; i += 10) out.push(list.slice(i, i + 10))
  return out.length ? out : [[]]
})

function setMode(m: PrintMode) {
  router.replace({ path: route.path, query: m === 'loft' ? {} : { view: m } })
}

function doPrint() {
  window.print()
}

const asPanel = (it: SheetItem): SheetItemPanel => it as SheetItemPanel
const asStrip = (it: SheetItem): SheetItemStrip => it as SheetItemStrip

const PANEL_PAD_LEFT = 4
const PANEL_PAD_TOP = 8

function panelBox(it: SheetItemPanel) {
  const p = it.panel
  return {
    x: it.xMm + PANEL_PAD_LEFT,
    y: it.yMm + PANEL_PAD_TOP,
    w: Math.max(p.widthTopMm, p.widthBottomMm),
    h: p.heightMm
  }
}

const isPlainCircle = (p: Panel) => p.shape === 'circle' && !p.polySides

function polygonPoints(n: number, circR: number, cx: number, cy: number): string {
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n
    return `${(cx + circR * Math.cos(a)).toFixed(2)},${(cy + circR * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

/** 裁切线（原点在裁片外接框左上角，y 向下，单位 mm，1:1） */
function cutPoints(p: Panel, w: number, h: number): string {
  if (p.shape === 'circle' && p.polySides) {
    return polygonPoints(p.polySides, w / 2 / Math.cos(Math.PI / p.polySides), w / 2, h / 2)
  }
  if (p.shape === 'triangle') return `0,${h} ${w},${h} ${w / 2},0`
  const { widthTopMm: wt, widthBottomMm: wb } = p
  return `${(w - wb) / 2},${h} ${(w + wb) / 2},${h} ${(w + wt) / 2},0 ${(w - wt) / 2},0`
}

/** 缝份折线（净样），相对裁切线向内缩 seamAllowanceMm */
function netPoints(p: Panel, w: number, h: number): string {
  const s = p.seamAllowanceMm
  if (p.shape === 'circle' && p.polySides) {
    const raw = p.rawWidthTopMm
    return polygonPoints(p.polySides, raw / 2 / Math.cos(Math.PI / p.polySides), w / 2, h / 2)
  }
  if (p.shape === 'triangle') {
    const rw = p.rawWidthBottomMm
    const rh = p.rawHeightMm
    return `${(w - rw) / 2},${h - s} ${(w + rw) / 2},${h - s} ${w / 2},${h - s - rh}`
  }
  const yb = h - s
  const yt = h - s - p.rawHeightMm
  return `${(w - p.rawWidthBottomMm) / 2},${yb} ${(w + p.rawWidthBottomMm) / 2},${yb} ${
    (w + p.rawWidthTopMm) / 2
  },${yt} ${(w - p.rawWidthTopMm) / 2},${yt}`
}

function markList(it: SheetItemPanel) {
  const b = panelBox(it)
  return (it.panel.marksMm || []).map((m, i) => ({
    n: i + 1,
    label: m.label,
    cx: b.x + m.x,
    cy: b.y + (b.h - m.y)
  }))
}

/** 长条标尺刻度：沿构件全长每 10mm 一格，每 50mm 标数 */
function stripTicks(it: SheetItemStrip) {
  const out: { x: number; major: boolean; label?: string }[] = []
  for (let d = 0; d <= it.lengthMm + 0.001; d += 10) {
    const mm = it.startMm + d
    const major = Math.round(mm) % 50 === 0
    out.push({ x: it.xMm + d, major, label: major ? String(Math.round(mm)) : undefined })
  }
  return out
}

function stripText(it: SheetItemStrip): string {
  const m = it.member
  const kind = kindName(m.kind)
  const name = m.label.includes(kind) ? m.label : `${m.label}（${kind}）`
  const parts = [
    `[${it.tag}] ${name}`,
    `全长 ${f1(it.totalMm)}mm`,
    `本段 ${f1(it.lengthMm)}mm（整根第 ${f1(it.startMm)}–${f1(it.startMm + it.lengthMm)}mm）`
  ]
  if (it.overlapMm > 0) {
    const mates = [it.prevTag, it.nextTag].filter(Boolean).join(' / ')
    parts.push(`与 ${mates} 搭接 ${f1(it.overlapMm)}mm`)
  }
  return parts.join(' · ')
}

function sheetFoot(s: { index: number }) {
  return `第 ${s.index}/${sheets.value.length} 页 · 请按 100% 打印（关闭「适应页面」）· 校验尺见第 1 页`
}

function f1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1)
}

function today(): string {
  return new Date().toLocaleDateString('zh-CN')
}
</script>

<template>
  <div v-if="!lantern || !full" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="print-view">
    <!-- 屏显控制区（打印时隐藏） -->
    <section class="controls no-print">
      <div class="ctl-head">
        <div>
          <h2>1:1 放样图 · {{ lantern.name }}</h2>
          <p class="sub">
            单位全 mm（1 位小数）· 图纸按真实毫米绘制，<b>打印时必须 100% 缩放</b>。
            1:1 依赖用户关闭缩放，本页已附 {{ CALIBRATION_RULER_MM }}mm 校验尺与 Ø{{ CALIBRATION_CIRCLE_MM }}mm 校验圆。
          </p>
        </div>
        <div class="ops">
          <button class="primary" @click="doPrint">打印 / 另存为 PDF</button>
          <button @click="router.push(`/panels/${lantern.id}`)">返回裁片页</button>
        </div>
      </div>

      <div class="tabs">
        <button :class="{ on: mode === 'loft' }" @click="setMode('loft')">1:1 放样图</button>
        <button :class="{ on: mode === 'frame' }" @click="setMode('frame')">构件清单（可打印）</button>
        <button :class="{ on: mode === 'labels' }" @click="setMode('labels')">裁片标签</button>
      </div>

      <div v-if="mode === 'loft'" class="fields">
        <label>
          纸张
          <select v-model="opts.paper">
            <option value="A4">A4（210×297mm）</option>
            <option value="A3">A3（297×420mm）</option>
          </select>
        </label>
        <label>
          长条搭接量 (mm)
          <input v-model.number="opts.overlapMm" type="number" min="0" max="60" step="1" />
        </label>
        <label class="chk"><input v-model="opts.includeCalibration" type="checkbox" /> 校验页（100mm 校验尺）</label>
        <label class="chk"><input v-model="opts.includePanels" type="checkbox" /> 蒙面裁片 1:1</label>
        <label class="chk"><input v-model="opts.includeStrips" type="checkbox" /> 骨架长条 1:1</label>
      </div>

      <p v-if="mode === 'loft'" class="warn">
        ⚠ 请在打印对话框里把缩放设为 <b>100%</b>（关闭「适应页面 / Fit to page」），纸张选
        {{ opts.paper }}，页边距选「无」；打印后先用第 1 页的 100mm 校验尺核对，误差应 ≤ 1mm。
      </p>

      <section v-if="mode === 'loft'" class="summary">
        <div class="stat"><span>图纸页数</span><b>{{ sheets.length }} 页</b></div>
        <div class="stat"><span>裁片类型</span><b>{{ full.panels.panels.length }} 种 / {{ full.panels.totalQty }} 块</b></div>
        <div class="stat"><span>裁片不跨页断言</span><b :class="splitCheck.pass ? 'ok' : 'bad'">{{ splitCheck.pass ? '通过' : '失败' }}</b></div>
        <div class="stat"><span>超区整块输出</span><b>{{ splitCheck.overflow }} 块</b></div>
        <div class="stat"><span>底盖净直径</span><b>{{ f1(coverDims.botMm) }} mm</b></div>
      </section>
      <p v-if="mode === 'loft'" class="sub detail">{{ splitCheck.detail }}</p>
    </section>

    <!-- ============ 1:1 放样图纸 ============ -->
    <div v-if="mode === 'loft'" class="sheets">
      <section
        v-for="s in sheets"
        :key="s.index"
        class="sheet"
        :style="{ width: s.wMm + 'mm', height: s.hMm + 'mm' }"
      >
        <svg
          :width="s.wMm + 'mm'"
          :height="s.hMm + 'mm'"
          :viewBox="`0 0 ${s.wMm} ${s.hMm}`"
          xmlns="http://www.w3.org/2000/svg"
        >
          <!-- 页眉 -->
          <text class="hdr" :x="s.contentX" y="5.6">{{ s.title }}</text>
          <text class="hdr-sub" :x="s.contentX + s.contentWMm" y="5.6" text-anchor="end">
            {{ lantern.name }} · {{ kindLabel(lantern.kind) }} · 最大直径 {{ lantern.maxDiameterMm }}mm · 总高
            {{ lantern.totalHeightMm }}mm · {{ lantern.layers.length }} 层
          </text>
          <text class="hdr-sub" :x="s.contentX" y="10.4">
            蒙面 {{ coveringLabel(lantern.covering) }} · 缝份四边各 {{ lantern.seamAllowanceMm }}mm（已计入裁片尺寸）·
            {{ styleLabel(lantern.mouthStyle) }}/{{ styleLabel(lantern.bottomStyle) }} · 单位 mm
          </text>
          <text class="hdr-sub" :x="s.contentX + s.contentWMm" y="10.4" text-anchor="end">
            {{ sheetFoot(s) }}
          </text>
          <line class="hair" :x1="s.contentX" :x2="s.contentX + s.contentWMm" y1="12.4" y2="12.4" />

          <text v-if="s.warn" class="warn-text" :x="s.contentX" :y="s.contentY + 4">{{ s.warn }}</text>

          <g v-for="(it, idx) in s.items" :key="idx">
            <!-- 100mm 校验页 -->
            <g v-if="it.type === 'calibration'">
              <text class="cal-title" :x="it.xMm" :y="it.yMm + 7">
                打印自检：请把打印缩放设为 100%（关闭「适应页面 / Fit to page」），纸张 {{ opts.paper }}，页边距「无」。
              </text>

              <text class="cal-note" :x="it.xMm" :y="it.yMm + 18">
                ① 水平校验尺 标称 {{ CALIBRATION_RULER_MM }}.0mm —— 打印后用钢尺实测此段，误差应 ≤ 1mm
              </text>
              <rect
                :x="it.xMm + 6"
                :y="it.yMm + 22"
                :width="CALIBRATION_RULER_MM"
                :height="8"
                class="cal-bar"
              />
              <g v-for="d in 11" :key="'h' + d">
                <line
                  class="cal-tick"
                  :x1="it.xMm + 6 + (d - 1) * 10"
                  :x2="it.xMm + 6 + (d - 1) * 10"
                  :y1="it.yMm + 22"
                  :y2="it.yMm + 22 + (d % 5 === 1 ? 8 : 4)"
                />
                <text
                  class="cal-label"
                  :x="it.xMm + 6 + (d - 1) * 10"
                  :y="it.yMm + 33.5"
                  text-anchor="middle"
                >
                  {{ (d - 1) * 10 }}
                </text>
              </g>

              <text class="cal-note" :x="it.xMm + 118" :y="it.yMm + 40">
                ② 垂直校验尺 标称 100.0mm
              </text>
              <rect :x="it.xMm + 6" :y="it.yMm + 44" width="8" :height="CALIBRATION_RULER_MM" class="cal-bar" />
              <g v-for="d in 11" :key="'v' + d">
                <line
                  class="cal-tick"
                  :x1="it.xMm + 6"
                  :x2="it.xMm + 6 + (d % 5 === 1 ? 8 : 4)"
                  :y1="it.yMm + 44 + (d - 1) * 10"
                  :y2="it.yMm + 44 + (d - 1) * 10"
                />
              </g>
              <text class="cal-label" :x="it.xMm + 18" :y="it.yMm + 96">100.0mm</text>

              <text class="cal-note" :x="it.xMm + 118" :y="it.yMm + 56">
                ③ Ø{{ CALIBRATION_CIRCLE_MM }}.0mm 校验圆（可对照底盖裁片实测）
              </text>
              <circle
                :cx="it.xMm + 118"
                :cy="it.yMm + 116"
                :r="CALIBRATION_CIRCLE_MM / 2"
                class="cal-circle"
              />
              <line
                class="cal-tick"
                :x1="it.xMm + 118 - 58"
                :x2="it.xMm + 118 + 58"
                :y1="it.yMm + 116"
                :y2="it.yMm + 116"
              />
              <line
                class="cal-tick"
                :x1="it.xMm + 118"
                :x2="it.xMm + 118"
                :y1="it.yMm + 116 - 58"
                :y2="it.yMm + 116 + 58"
              />
              <text class="cal-label" :x="it.xMm + 118" :y="it.yMm + 116 + 2" text-anchor="middle">
                Ø{{ CALIBRATION_CIRCLE_MM }}
              </text>
              <text class="cal-note" :x="it.xMm + 118" :y="it.yMm + 172" text-anchor="middle">
                打印后实测本圆直径，误差应 ≤ 1mm
              </text>

              <text class="cal-note" :x="it.xMm" :y="it.yMm + 200">
                ④ 本灯实际口径：底盖净直径 {{ f1(coverDims.botMm) }}mm、顶盖净直径 {{ f1(coverDims.topMm) }}mm ——
                在「蒙面裁片 1:1」页按同一比例绘制，可实测对照（误差 ≤ 1mm）。
              </text>
              <text class="cal-note" :x="it.xMm" :y="it.yMm + 210">
                ⑤ 同一块裁片不拆到两页；骨架长条跨页处带对位十字、拼接编号与搭接量（默认
                {{ f1(opts.overlapMm) }}mm），请按编号粘接。
              </text>
              <text class="cal-note" :x="it.xMm" :y="it.yMm + 220">
                ⑥ 导出 PDF：在打印对话框选择「另存为 PDF」，尺寸与打印完全一致（本页已按 {{ opts.paper }}
                设置 @page 尺寸）。
              </text>
              <text class="cal-foot" :x="it.xMm" :y="it.yMm + it.hMm - 2">
                {{ lantern.name }} · 1:1 校验页 · {{ today() }}
              </text>
            </g>

            <!-- 裁片 1:1 -->
            <g v-else-if="it.type === 'panel'">
              <g>
                <text class="panel-cap" :x="asPanel(it).xMm" :y="asPanel(it).yMm + 4">
                  {{ asPanel(it).panel.label }} ×{{ asPanel(it).panel.qty }} 块 ·
                  净 {{ f1(asPanel(it).panel.rawWidthTopMm) }}/{{ f1(asPanel(it).panel.rawWidthBottomMm) }}×{{
                    f1(asPanel(it).panel.rawHeightMm)
                  }}mm + 缝份 {{ asPanel(it).panel.seamAllowanceMm }}×2 · 实线=裁切线 虚线=净样 十字=对位
                </text>

                <circle
                  v-if="isPlainCircle(asPanel(it).panel)"
                  :cx="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                  :cy="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h / 2"
                  :r="panelBox(asPanel(it)).w / 2"
                  class="cut-area"
                />
                <polygon
                  v-else
                  :points="cutPoints(asPanel(it).panel, panelBox(asPanel(it)).w, panelBox(asPanel(it)).h)"
                  :transform="`translate(${panelBox(asPanel(it)).x} ${panelBox(asPanel(it)).y})`"
                  class="cut-area"
                />

                <circle
                  v-if="isPlainCircle(asPanel(it).panel)"
                  :cx="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                  :cy="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h / 2"
                  :r="asPanel(it).panel.rawWidthTopMm / 2"
                  class="net-line"
                />
                <polygon
                  v-else
                  :points="netPoints(asPanel(it).panel, panelBox(asPanel(it)).w, panelBox(asPanel(it)).h)"
                  :transform="`translate(${panelBox(asPanel(it)).x} ${panelBox(asPanel(it)).y})`"
                  class="net-line"
                />

                <!-- 对位标记 -->
                <g v-for="m in markList(asPanel(it))" :key="m.n" class="mark">
                  <line :x1="m.cx - 3.5" :x2="m.cx + 3.5" :y1="m.cy" :y2="m.cy" />
                  <line :x1="m.cx" :x2="m.cx" :y1="m.cy - 3.5" :y2="m.cy + 3.5" />
                  <circle :cx="m.cx" :cy="m.cy" r="2" />
                  <text :x="m.cx + 4.6" :y="m.cy - 3.4">{{ m.n }}</text>
                </g>

                <!-- 尺寸标注 -->
                <g class="dim">
                  <line
                    :x1="panelBox(asPanel(it)).x + (panelBox(asPanel(it)).w - asPanel(it).panel.widthTopMm) / 2"
                    :x2="panelBox(asPanel(it)).x + (panelBox(asPanel(it)).w + asPanel(it).panel.widthTopMm) / 2"
                    :y1="panelBox(asPanel(it)).y - 3.6"
                    :y2="panelBox(asPanel(it)).y - 3.6"
                  />
                  <text
                    :x="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                    :y="panelBox(asPanel(it)).y - 5"
                    text-anchor="middle"
                  >
                    上宽 {{ f1(asPanel(it).panel.widthTopMm) }}
                  </text>
                  <line
                    :x1="panelBox(asPanel(it)).x + (panelBox(asPanel(it)).w - asPanel(it).panel.widthBottomMm) / 2"
                    :x2="panelBox(asPanel(it)).x + (panelBox(asPanel(it)).w + asPanel(it).panel.widthBottomMm) / 2"
                    :y1="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h + 3"
                    :y2="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h + 3"
                  />
                  <text
                    :x="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                    :y="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h + 6.4"
                    text-anchor="middle"
                  >
                    下宽 {{ f1(asPanel(it).panel.widthBottomMm) }}（含缝份）
                  </text>
                  <line
                    :x1="panelBox(asPanel(it)).x - 2.6"
                    :x2="panelBox(asPanel(it)).x - 2.6"
                    :y1="panelBox(asPanel(it)).y"
                    :y2="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h"
                  />
                  <text
                    :x="panelBox(asPanel(it)).x - 4.4"
                    :y="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h / 2"
                    text-anchor="middle"
                    :transform="`rotate(-90 ${panelBox(asPanel(it)).x - 4.4} ${
                      panelBox(asPanel(it)).y + panelBox(asPanel(it)).h / 2
                    })`"
                  >
                    高 {{ f1(asPanel(it).panel.heightMm) }}
                  </text>
                  <text
                    :x="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                    :y="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h / 2 + 1"
                    text-anchor="middle"
                    class="net-label"
                  >
                    净 {{ f1(asPanel(it).panel.rawWidthTopMm) }}×{{ f1(asPanel(it).panel.rawHeightMm) }} + 缝份
                    {{ asPanel(it).panel.seamAllowanceMm }}×2 = 裁切 {{ f1(asPanel(it).panel.widthTopMm) }}×{{
                      f1(asPanel(it).panel.heightMm)
                    }}
                  </text>
                  <text
                    :x="panelBox(asPanel(it)).x + panelBox(asPanel(it)).w / 2"
                    :y="panelBox(asPanel(it)).y + panelBox(asPanel(it)).h + 10.6"
                    text-anchor="middle"
                    class="panel-cap"
                  >
                    {{ asPanel(it).panel.note }}
                  </text>
                </g>
              </g>
            </g>

            <!-- 骨架长条 1:1（跨页带对位十字与搭接量） -->
            <g v-else>
              <text class="strip-cap" :x="asStrip(it).xMm" :y="asStrip(it).yMm + 3.6">
                {{ stripText(asStrip(it)) }}
              </text>
              <rect
                class="strip-bar"
                :x="asStrip(it).xMm"
                :y="asStrip(it).yMm + 5"
                :width="asStrip(it).lengthMm"
                height="4"
              />
              <g v-for="t in stripTicks(asStrip(it))" :key="'t' + t.x">
                <line class="strip-tick" :x1="t.x" :x2="t.x" :y1="asStrip(it).yMm + 9" :y2="asStrip(it).yMm + (t.major ? 11.8 : 10.8)" />
                <text v-if="t.label" class="strip-tick-label" :x="t.x" :y="asStrip(it).yMm + 15" text-anchor="middle">
                  {{ t.label }}
                </text>
              </g>
              <g class="join" v-if="asStrip(it).segIndex > 0">
                <line :x1="asStrip(it).xMm - 4" :x2="asStrip(it).xMm + 4" :y1="asStrip(it).yMm + 7" :y2="asStrip(it).yMm + 7" />
                <line :x1="asStrip(it).xMm" :x2="asStrip(it).xMm" :y1="asStrip(it).yMm + 3" :y2="asStrip(it).yMm + 11" />
                <text class="join-text" :x="asStrip(it).xMm" :y="asStrip(it).yMm + 2.6" text-anchor="middle">
                  接 {{ asStrip(it).prevTag }} 搭接 {{ f1(asStrip(it).overlapMm) }}mm
                </text>
              </g>
              <g class="join" v-if="asStrip(it).nextTag">
                <line
                  :x1="asStrip(it).xMm + asStrip(it).lengthMm - 4"
                  :x2="asStrip(it).xMm + asStrip(it).lengthMm + 4"
                  :y1="asStrip(it).yMm + 7"
                  :y2="asStrip(it).yMm + 7"
                />
                <line
                  :x1="asStrip(it).xMm + asStrip(it).lengthMm"
                  :x2="asStrip(it).xMm + asStrip(it).lengthMm"
                  :y1="asStrip(it).yMm + 3"
                  :y2="asStrip(it).yMm + 11"
                />
                <text
                  class="join-text"
                  :x="asStrip(it).xMm + asStrip(it).lengthMm"
                  :y="asStrip(it).yMm + 2.6"
                  text-anchor="middle"
                >
                  续 {{ asStrip(it).nextTag }}
                </text>
              </g>
            </g>
          </g>

          <text class="sheet-foot" :x="s.contentX" :y="s.hMm - 3.4">
            {{ lantern.name }} · {{ sheetFoot(s) }} · 单位 mm · 1:1（100% 打印）
          </text>
        </svg>
      </section>
    </div>

    <!-- ============ 构件清单（可打印） ============ -->
    <section v-else-if="mode === 'frame'" class="doc">
      <h1>骨架构件清单</h1>
      <p class="doc-meta">
        灯样：{{ lantern.name }}（{{ kindLabel(lantern.kind) }}）· 最大直径 {{ lantern.maxDiameterMm }}mm · 总高
        {{ lantern.totalHeightMm }}mm · {{ lantern.layers.length }} 层 · {{ lantern.sides }} 棱 ·
        收口 {{ styleLabel(lantern.mouthStyle) }}/{{ styleLabel(lantern.bottomStyle) }} ·
        每端绑扎余量 {{ lantern.lashAllowanceMm }}mm · 蒙面 {{ coveringLabel(lantern.covering) }} ·
        打印日期 {{ today() }}
      </p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>构件名称</th>
            <th>类别</th>
            <th>分组</th>
            <th class="num">净长 (mm)</th>
            <th class="num">截取长度 (mm，含余量)</th>
            <th class="num">余量处数</th>
            <th class="num">数量</th>
            <th class="num">总截取长 (mm)</th>
            <th>弯曲半径 / 折角</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="grp in frameGroups" :key="grp.group">
            <tr class="doc-group">
              <td colspan="9">{{ grp.group }}</td>
            </tr>
            <tr v-for="m in grp.items" :key="m.id">
              <td>{{ m.label }}</td>
              <td>{{ kindName(m.kind) }}</td>
              <td>{{ m.group }}</td>
              <td class="num mono">{{ f1(m.rawLengthMm) }}</td>
              <td class="num mono strong">{{ f1(m.lengthMm) }}</td>
              <td class="num mono">×{{ m.lashJoints }}</td>
              <td class="num mono">{{ m.qty }}</td>
              <td class="num mono">{{ f1(m.lengthMm * m.qty) }}</td>
              <td class="mono">{{ m.bendRadiusMm ? `R${f1(m.bendRadiusMm)}mm` : m.bendAngleDeg ? `${f1(m.bendAngleDeg)}°` : '—' }}</td>
            </tr>
          </template>
        </tbody>
      </table>
      <p class="doc-foot">
        合计：构件 {{ full.frame.totalQty }} 根 · 备料（含余量）{{ (full.frame.stockLengthMm / 1000).toFixed(3) }}m ·
        净长 {{ (full.frame.rawLengthMm / 1000).toFixed(3) }}m · 绑扎余量合计
        {{ f1(full.frame.lashExtraMm) }}mm
      </p>
    </section>

    <!-- ============ 裁片标签 ============ -->
    <section v-if="mode === 'labels'" v-for="(page, pi) in labelPages" :key="'lp' + pi" class="label-page">
      <div class="label-grid">
        <div v-for="p in page" :key="p.id" class="label">
          <div class="lb-head">
            <span class="lb-code">{{ p.id }}</span>
            <span class="lb-name">{{ p.label }}</span>
            <span class="lb-qty">× {{ p.qty }} 块</span>
          </div>
          <div class="lb-rows">
            <div><span>形状</span><b>{{ shapeName(p.shape) }}{{ p.polySides ? `（正 ${p.polySides} 边形）` : '' }}</b></div>
            <div><span>净尺寸</span><b>上 {{ f1(p.rawWidthTopMm) }} / 下 {{ f1(p.rawWidthBottomMm) }} × 高 {{ f1(p.rawHeightMm) }} mm</b></div>
            <div><span>裁切尺寸</span><b>上 {{ f1(p.widthTopMm) }} / 下 {{ f1(p.widthBottomMm) }} × 高 {{ f1(p.heightMm) }} mm</b></div>
            <div><span>缝份</span><b>四边各 {{ p.seamAllowanceMm }}mm（已计入裁切尺寸）</b></div>
            <div>
              <span>位置 / 配色</span><b>{{ p.layerIndex >= 0 ? `第 ${p.layerIndex + 1} 层` : '顶/底盖' }} · {{ p.color }}</b>
            </div>
            <div><span>对位标记</span><b>{{ p.marksMm.length }} 处（见 1:1 图十字编号）</b></div>
          </div>
          <div class="lb-foot">
            {{ lantern.name }} · 蒙面 {{ coveringLabel(lantern.covering) }} · 逐块编号
            {{ p.id }}-01 … {{ p.id }}-{{ String(p.qty).padStart(2, '0') }}
          </div>
        </div>
      </div>
    </section>

    <ChecksPanel
      v-if="full && mode === 'loft'"
      class="no-print"
      :checks="full.checks.filter((c) => ['CHK-05', 'CHK-06', 'CHK-08'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="放样与分页自检"
    />
  </div>
</template>

<style scoped>
.print-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.controls {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow);
}

.ctl-head {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 900px;
}

.detail {
  font-size: 12px;
}

.ops {
  display: flex;
  gap: 8px;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 6px 12px;
  font-size: 12.5px;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tabs button.on {
  background: #f6e3ba;
  border-color: var(--gold);
  color: #8f1c19;
  font-weight: 600;
}

.fields {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 12.5px;
}

.fields label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-soft);
}

.fields select,
.fields input[type='number'] {
  font: inherit;
  font-size: 12.5px;
  padding: 4px 6px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--ink);
}

.fields input[type='number'] {
  width: 68px;
}

.chk {
  cursor: pointer;
}

.warn {
  margin: 0;
  font-size: 12.5px;
  color: #8f1c19;
  background: #fbeae6;
  border: 1px solid #e7c3bb;
  border-radius: 8px;
  padding: 8px 12px;
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 9px 14px;
  display: flex;
  flex-direction: column;
}

.stat span {
  font-size: 11px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 15px;
}

.ok {
  color: var(--jade);
}

.bad {
  color: var(--red);
}

/* ---------- 图纸 ---------- */
.sheets {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  overflow-x: auto;
}

.sheet {
  background: #fff;
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  flex: 0 0 auto;
}

.sheet svg {
  display: block;
}

.sheet text {
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.hdr {
  font-size: 4.2px;
  font-weight: 700;
  fill: #8f1c19;
}

.hdr-sub {
  font-size: 2.7px;
  fill: #6a5c52;
}

.hair {
  stroke: #c6b49b;
  stroke-width: 0.3;
}

.warn-text {
  font-size: 2.9px;
  fill: #b3241f;
}

.cut-area {
  fill: rgba(179, 36, 31, 0.06);
  stroke: #b3241f;
  stroke-width: 0.5;
}

.net-line {
  fill: none;
  stroke: #2f7a63;
  stroke-width: 0.35;
  stroke-dasharray: 3 1.6;
}

.mark line {
  stroke: #2f5f8a;
  stroke-width: 0.3;
}

.mark circle {
  fill: none;
  stroke: #2f5f8a;
  stroke-width: 0.3;
}

.mark text {
  fill: #2f5f8a;
  font-size: 2.4px;
}

.dim line {
  stroke: #2f5f8a;
  stroke-width: 0.3;
}

.dim text {
  fill: #2f5f8a;
  font-size: 2.6px;
}

.dim text.net-label {
  fill: rgba(60, 30, 20, 0.5);
  font-size: 2.6px;
}

.panel-cap {
  font-size: 2.5px;
  fill: #6a5c52;
}

.strip-cap {
  font-size: 2.4px;
  fill: #2b2320;
}

.strip-bar {
  fill: rgba(184, 137, 31, 0.14);
  stroke: #b3241f;
  stroke-width: 0.3;
}

.strip-tick {
  stroke: #2f5f8a;
  stroke-width: 0.25;
}

.strip-tick-label {
  font-size: 2.1px;
  fill: #2f5f8a;
}

.join line {
  stroke: #b3241f;
  stroke-width: 0.4;
}

.join-text {
  font-size: 2.1px;
  fill: #b3241f;
}

.cal-title {
  font-size: 4px;
  font-weight: 700;
  fill: #8f1c19;
}

.cal-note {
  font-size: 3px;
  fill: #2b2320;
}

.cal-foot {
  font-size: 2.6px;
  fill: #6a5c52;
}

.cal-bar {
  fill: rgba(184, 137, 31, 0.16);
  stroke: #2b2320;
  stroke-width: 0.3;
}

.cal-tick {
  stroke: #2b2320;
  stroke-width: 0.3;
}

.cal-label {
  font-size: 2.6px;
  fill: #2b2320;
}

.cal-circle {
  fill: none;
  stroke: #b3241f;
  stroke-width: 0.5;
}

.sheet-foot {
  font-size: 2.5px;
  fill: #6a5c52;
}

/* ---------- 构件清单 ---------- */
.doc {
  width: 210mm;
  min-height: 297mm;
  padding: 14mm 12mm;
  background: #fff;
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  margin: 0 auto;
  box-sizing: border-box;
}

.doc h1 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
}

.doc-meta {
  margin: 0 0 10px;
  font-size: 11.5px;
  color: var(--ink-soft);
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.doc-table th {
  text-align: left;
  border-bottom: 1px solid var(--line-strong);
  padding: 4px 5px;
  font-size: 10.5px;
  color: var(--ink-soft);
  font-weight: 500;
}

.doc-table td {
  padding: 3.4px 5px;
  border-bottom: 1px dashed var(--line);
  vertical-align: top;
}

.doc-group td {
  background: var(--surface-2);
  font-weight: 700;
  color: #8f1c19;
}

.doc-foot {
  margin-top: 10px;
  font-size: 11px;
  color: var(--ink-soft);
}

.num {
  text-align: right;
}

.mono {
  font-family: var(--mono);
}

.strong {
  font-weight: 700;
  color: #8f1c19;
}

/* ---------- 裁片标签 ---------- */
.label-page {
  width: 210mm;
  height: 297mm;
  padding: 10mm;
  background: #fff;
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  margin: 0 auto;
  box-sizing: border-box;
}

.label-grid {
  display: grid;
  grid-template-columns: repeat(2, 88mm);
  grid-auto-rows: 50mm;
  gap: 4mm;
}

.label {
  border: 0.4mm dashed #8a7a68;
  border-radius: 2mm;
  padding: 2.4mm 3mm;
  display: flex;
  flex-direction: column;
  gap: 1mm;
  overflow: hidden;
  background: #fff;
}

.lb-head {
  display: flex;
  align-items: baseline;
  gap: 2mm;
  border-bottom: 0.2mm solid #ddd0bd;
  padding-bottom: 1mm;
}

.lb-code {
  font-family: var(--mono);
  font-size: 3.6mm;
  font-weight: 700;
  color: #8f1c19;
}

.lb-name {
  font-size: 3.3mm;
  font-weight: 600;
  flex: 1;
}

.lb-qty {
  font-family: var(--mono);
  font-size: 3mm;
  color: #b3241f;
}

.lb-rows {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6mm 2mm;
  font-size: 2.6mm;
}

.lb-rows div {
  display: flex;
  gap: 1.4mm;
  align-items: baseline;
}

.lb-rows span {
  color: #6a5c52;
  flex: 0 0 11mm;
}

.lb-rows b {
  font-family: var(--mono);
  font-weight: 500;
}

.lb-foot {
  margin-top: auto;
  font-size: 2.4mm;
  color: #6a5c52;
  border-top: 0.2mm solid #ddd0bd;
  padding-top: 0.8mm;
}

.missing {
  padding: 40px;
  text-align: center;
}

/* ---------- 打印 ---------- */
@media print {
  .print-view {
    gap: 0;
  }

  .sheets {
    gap: 0;
    overflow: visible;
  }

  .sheet,
  .doc,
  .label-page {
    border: none;
    box-shadow: none;
    margin: 0;
  }

  .sheet {
    break-after: page;
    page-break-after: always;
  }

  .doc,
  .label-page {
    break-after: page;
    page-break-after: always;
  }

  .sheet:last-child,
  .doc:last-child,
  .label-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .doc-table {
    font-size: 10.5px;
  }
}
</style>
