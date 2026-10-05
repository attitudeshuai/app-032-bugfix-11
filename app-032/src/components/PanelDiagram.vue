<script setup lang="ts">
/** 裁片图：实线为裁切线，虚线为净样（缝份折线），标注尺寸与对位标记 */
import { computed } from 'vue'
import type { Panel } from '../core/types'

const props = defineProps<{ panel: Panel; showMarks?: boolean; showDims?: boolean }>()

const cutW = computed(() => Math.max(props.panel.widthTopMm, props.panel.widthBottomMm))
const cutH = computed(() => props.panel.heightMm)
const pad = 22
const viewBox = computed(() => `${-pad} ${-pad} ${cutW.value + pad * 2} ${cutH.value + pad * 2}`)
const fs = computed(() => Math.max(3, Math.min(8, Math.max(cutW.value, cutH.value) / 26)))
const sw = computed(() => Math.max(0.25, Math.max(cutW.value, cutH.value) / 420))

const sy = (y: number) => cutH.value - y

const cutPoints = computed(() => {
  const p = props.panel
  const W = cutW.value
  const H = cutH.value
  if (p.shape === 'circle' && !p.polySides) return ''
  if (p.shape === 'circle' && p.polySides) {
    const n = p.polySides
    const R = W / 2 / Math.cos(Math.PI / n)
    return Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n
      return `${(W / 2 + R * Math.cos(a)).toFixed(2)},${(H / 2 + R * Math.sin(a)).toFixed(2)}`
    }).join(' ')
  }
  if (p.shape === 'triangle') {
    return `0,${H} ${W},${H} ${W / 2},0`
  }
  const wt = p.widthTopMm
  const wb = p.widthBottomMm
  return `${(W - wb) / 2},${H} ${(W + wb) / 2},${H} ${(W + wt) / 2},0 ${(W - wt) / 2},0`
})

const netPoints = computed(() => {
  const p = props.panel
  const W = cutW.value
  const s = p.seamAllowanceMm
  if (p.shape === 'circle' && !p.polySides) return ''
  if (p.shape === 'circle' && p.polySides) {
    const n = p.polySides
    const R = p.rawWidthTopMm / 2 / Math.cos(Math.PI / n)
    return Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n
      return `${(W / 2 + R * Math.cos(a)).toFixed(2)},${(cutH.value / 2 + R * Math.sin(a)).toFixed(2)}`
    }).join(' ')
  }
  if (p.shape === 'triangle') {
    const H = p.rawHeightMm
    const y0 = sy(s)
    const w = p.rawWidthBottomMm
    return `${(W - w) / 2},${y0} ${(W + w) / 2},${y0} ${W / 2},${y0 - H}`
  }
  const wt = p.rawWidthTopMm
  const wb = p.rawWidthBottomMm
  const yb = sy(s)
  const yt = sy(s + p.rawHeightMm)
  return `${(W - wb) / 2},${yb} ${(W + wb) / 2},${yb} ${(W + wt) / 2},${yt} ${(W - wt) / 2},${yt}`
})

const markList = computed(() =>
  (props.panel.marksMm || []).map((m, i) => ({ ...m, n: i + 1, cx: m.x, cy: sy(m.y) }))
)
</script>

<template>
  <svg class="panel-svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
    <!-- 裁切线 -->
    <polygon
      v-if="panel.shape !== 'circle' || panel.polySides"
      :points="cutPoints"
      fill="rgba(179,36,31,0.06)"
      stroke="#b3241f"
      :stroke-width="sw * 1.6"
    />
    <circle
      v-else
      :cx="cutW / 2"
      :cy="cutH / 2"
      :r="cutW / 2"
      fill="rgba(179,36,31,0.06)"
      stroke="#b3241f"
      :stroke-width="sw * 1.6"
    />

    <!-- 缝份内缩线（净样）为虚线 -->
    <polygon
      v-if="panel.shape !== 'circle' || panel.polySides"
      :points="netPoints"
      fill="none"
      stroke="#2f7a63"
      :stroke-width="sw * 1.2"
      stroke-dasharray="4 2.5"
    />
    <circle
      v-else
      :cx="cutW / 2"
      :cy="cutH / 2"
      :r="panel.rawWidthTopMm / 2"
      fill="none"
      stroke="#2f7a63"
      :stroke-width="sw * 1.2"
      stroke-dasharray="4 2.5"
    />

    <!-- 对位标记 -->
    <g v-if="showMarks !== false" class="marks">
      <g v-for="m in markList" :key="m.n">
        <line :x1="m.cx - 3" :x2="m.cx + 3" :y1="m.cy" :y2="m.cy" />
        <line :x1="m.cx" :x2="m.cx" :y1="m.cy - 3" :y2="m.cy + 3" />
        <circle :cx="m.cx" :cy="m.cy" r="2.2" />
        <text :x="m.cx + 4.4" :y="m.cy - 3.6" :font-size="fs * 0.85">{{ m.n }}</text>
      </g>
    </g>

    <!-- 尺寸标注 -->
    <g v-if="showDims !== false" class="dims">
      <line :x1="(cutW - panel.widthTopMm) / 2" :x2="(cutW + panel.widthTopMm) / 2" :y1="-9" :y2="-9" />
      <text :x="cutW / 2" :y="-11.5" text-anchor="middle" :font-size="fs">
        上宽 {{ panel.widthTopMm.toFixed(1) }}
      </text>

      <line :x1="(cutW - panel.widthBottomMm) / 2" :x2="(cutW + panel.widthBottomMm) / 2" :y1="cutH + 9" :y2="cutH + 9" />
      <text :x="cutW / 2" :y="cutH + 9 + fs * 1.3" text-anchor="middle" :font-size="fs">
        下宽 {{ panel.widthBottomMm.toFixed(1) }}
      </text>

      <line :x1="-9" :x2="-9" :y1="0" :y2="cutH" />
      <text
        :x="-12"
        :y="cutH / 2"
        text-anchor="middle"
        :font-size="fs"
        :transform="`rotate(-90 -12 ${cutH / 2})`"
      >
        高 {{ cutH.toFixed(1) }}
      </text>
    </g>

    <text :x="cutW / 2" :y="cutH / 2 + fs * 0.5" text-anchor="middle" :font-size="fs * 1.05" class="net-label">
      净 {{ panel.rawWidthTopMm.toFixed(1) }}×{{ panel.rawHeightMm.toFixed(1) }} + 缝份
      {{ panel.seamAllowanceMm }}×2
    </text>
  </svg>
</template>

<style scoped>
.panel-svg {
  width: 100%;
  height: auto;
  display: block;
  max-height: 340px;
}

.marks line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.marks circle {
  fill: none;
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.marks text {
  fill: #2f5f8a;
}

.dims line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.dims text {
  fill: #2f5f8a;
}

.net-label {
  fill: rgba(60, 30, 20, 0.45);
}
</style>
