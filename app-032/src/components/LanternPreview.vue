<script setup lang="ts">
/** 灯体预览：正视 / 俯视 / 等轴测示意（不做 3D 渲染，等轴测为线框投影） */
import { computed, ref } from 'vue'
import type { Lantern } from '../core/types'
import { buildGeometry, radiusAtY, segmentInfos, topShoulder } from '../core/geometry'

const props = defineProps<{
  lantern: Lantern
  mode: 'front' | 'top' | 'iso'
  interactive?: boolean
}>()
const emit = defineEmits<{ (e: 'update-ctrl', v: { which: 1 | 2; x: number; y: number }): void }>()

const g = computed(() => buildGeometry(props.lantern))
const dragging = ref<0 | 1 | 2>(0)

const PAD = 46
const viewBox = computed(() => {
  const geo = g.value
  if (props.mode === 'front') {
    return `0 0 ${geo.maxR * 2 + PAD * 2} ${geo.heightMm + PAD * 2}`
  }
  if (props.mode === 'top') {
    const s = geo.maxR * 2 + PAD * 1.2
    return `0 0 ${s} ${s}`
  }
  const p = isoProjection.value
  return `${p.minX} ${p.minY} ${p.w} ${p.h}`
})

const FRONT_W = computed(() => g.value.maxR * 2 + PAD * 2)
const FRONT_H = computed(() => g.value.heightMm + PAD * 2)
const sx = (x: number) => FRONT_W.value / 2 + x
const sy = (y: number) => FRONT_H.value - PAD - y

/** 每层的侧面色带 */
const bands = computed(() => {
  const geo = g.value
  const segs = segmentInfos(geo)
  return segs.map((s, i) => {
    const pts: { x: number; y: number }[] = []
    const steps = 18
    for (let k = 0; k <= steps; k++) {
      const y = s.y0Mm + ((s.y1Mm - s.y0Mm) * k) / steps
      pts.push({ x: radiusAtY(geo.profile, y), y })
    }
    const right = pts.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    const left = [...pts].reverse().map((p) => `${sx(-p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    return {
      d: `M ${right.join(' L ')} L ${left.join(' L ')} Z`,
      color: props.lantern.layerColors[i] || props.lantern.color,
      y0: s.y0Mm,
      y1: s.y1Mm
    }
  })
})

const outlinePath = computed(() => {
  const geo = g.value
  const pts: { x: number; y: number }[] = []
  const N = 64
  for (let k = 0; k <= N; k++) {
    const y = (geo.heightMm * k) / N
    pts.push({ x: radiusAtY(geo.profile, y), y })
  }
  const right = pts.map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
  const left = [...pts].reverse().map((p) => `${sx(-p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
  return `M ${right.join(' L ')} L ${left.join(' L ')} Z`
})

const rings = computed(() => {
  const geo = g.value
  return geo.sections.map((s) => ({
    y: sy(s.yMm),
    x1: sx(-s.radiusMm),
    x2: sx(s.radiusMm),
    r: s.radiusMm,
    label: s.index === 0 ? '底' : s.index === geo.sections.length - 1 ? '口' : String(s.index)
  }))
})

/** 棱柱可见棱线（前后面投影） */
const cornerLines = computed(() => {
  const geo = g.value
  if (!geo.polygon) return []
  const cosA = Math.cos(Math.PI / geo.n)
  return [
    { x: sx(geo.maxR * cosA), mirror: false },
    { x: sx(-geo.maxR * cosA), mirror: true }
  ]
})

const gridLines = computed(() => {
  const geo = g.value
  const out: { y: number; label: string }[] = []
  const step = geo.heightMm > 600 ? 200 : geo.heightMm > 300 ? 100 : 50
  for (let y = step; y < geo.heightMm; y += step) out.push({ y: sy(y), label: String(y) })
  return out
})

const shoulder = computed(() => topShoulder(props.lantern, g.value))

function clientToMm(evt: PointerEvent, el: SVGSVGElement) {
  const rect = el.getBoundingClientRect()
  const vb = viewBox.value.split(' ').map(Number)
  // 与 preserveAspectRatio="xMidYMid meet" 一致：等比缩放并按居中留白偏移
  const scale = Math.min(rect.width / vb[2], rect.height / vb[3])
  const offX = (rect.width - vb[2] * scale) / 2
  const offY = (rect.height - vb[3] * scale) / 2
  const xMm = (evt.clientX - rect.left - offX) / scale + vb[0]
  const yMm = (evt.clientY - rect.top - offY) / scale + vb[1]
  return { xMm, yMm }
}

function startDrag(which: 1 | 2, evt: PointerEvent) {
  if (!props.interactive || props.lantern.mouthStyle !== 'gourd') return
  dragging.value = which
  const el = evt.currentTarget as SVGSVGElement
  try {
    el.setPointerCapture?.(evt.pointerId)
  } catch {
    // 指针已释放或不被支持时忽略，拖动仍由 svg 上的 pointermove 继续
  }
}

function onMove(evt: PointerEvent) {
  if (!dragging.value || !shoulder.value) return
  const el = evt.currentTarget as SVGSVGElement
  const { xMm, yMm } = clientToMm(evt, el)
  // clientToMm 给出的是 SVG 用户坐标：x 以画布中线为原点（sx 加了 FRONT_W/2），y 向下。
  // 控制点用的是「半径」与「离底高度」，两轴都要换算回来。
  const xRadius = xMm - FRONT_W.value / 2
  const yHeight = FRONT_H.value - PAD - yMm
  const s = shoulder.value
  const dx = s.p3.x - s.p0.x
  const dy = s.p3.y - s.p0.y
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return
  const which = dragging.value
  const nx = (xRadius - s.p0.x) / dx
  const ny = (yHeight - s.p0.y) / dy
  emit('update-ctrl', {
    which,
    x: Math.min(1.6, Math.max(0.02, nx)),
    y: Math.min(0.92, Math.max(0.02, ny))
  })
}

function endDrag() {
  dragging.value = 0
}

/** 等轴测线框投影 */
const isoProjection = computed(() => {
  const geo = g.value
  const n = geo.polygon ? geo.n : Math.max(12, geo.n)
  const ringsPts = geo.sections.map((s) =>
    Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n
      return { x: s.radiusMm * Math.cos(a), y: s.yMm, z: s.radiusMm * Math.sin(a) }
    })
  )
  const proj = (p: { x: number; y: number; z: number }) => ({
    X: (p.x - p.z) * 0.866,
    Y: p.y - (p.x + p.z) * 0.5
  })
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of ringsPts) {
    for (const p of ring) {
      const q = proj(p)
      minX = Math.min(minX, q.X)
      maxX = Math.max(maxX, q.X)
      minY = Math.min(minY, q.Y)
      maxY = Math.max(maxY, q.Y)
    }
  }
  const pad = 24
  return {
    minX: minX - pad,
    minY: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
    ringsPts,
    proj
  }
})

const isoPaths = computed(() => {
  const p = isoProjection.value
  const rings = p.ringsPts.map((ring) => ring.map((q) => {
    const s = p.proj(q)
    return `${s.X.toFixed(2)},${s.Y.toFixed(2)}`
  }))
  const verticals: string[] = []
  const n = p.ringsPts[0]?.length || 0
  for (let k = 0; k < n; k++) {
    const a = p.ringsPts[0][k]
    const b = p.ringsPts[p.ringsPts.length - 1][k]
    const pa = p.proj(a)
    const pb = p.proj(b)
    verticals.push(`${pa.X.toFixed(2)},${pa.Y.toFixed(2)} ${pb.X.toFixed(2)},${pb.Y.toFixed(2)}`)
  }
  const topRing = rings[rings.length - 1]
  const bottomRing = rings[0]
  return { rings, verticals, bottomFill: bottomRing.join(' L '), topFill: topRing.join(' L ') }
})
</script>

<template>
  <div class="preview" :class="`preview-${mode}`">
    <!-- 正视图 -->
    <svg
      v-if="mode === 'front'"
      class="svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      @pointermove="onMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <g class="grid">
        <line v-for="gl in gridLines" :key="gl.y" :x1="6" :x2="FRONT_W - 6" :y1="gl.y" :y2="gl.y" />
        <text v-for="gl in gridLines" :key="'t' + gl.y" :x="8" :y="gl.y - 2" class="grid-label">
          {{ gl.label }}
        </text>
      </g>

      <path
        v-for="(b, i) in bands"
        :key="i"
        :d="b.d"
        :fill="b.color"
        fill-opacity="0.62"
        stroke="rgba(60,30,20,0.35)"
        stroke-width="0.4"
      />
      <path :d="outlinePath" fill="none" stroke="#7a2b1c" stroke-width="1.1" />

      <g class="rings">
        <line v-for="(r, i) in rings" :key="i" :x1="r.x1" :x2="r.x2" :y1="r.y" :y2="r.y" />
      </g>
      <g class="corners">
        <line
          v-for="(c, i) in cornerLines"
          :key="i"
          :x1="c.x"
          :x2="c.x"
          :y1="sy(0)"
          :y2="sy(g.heightMm)"
        />
      </g>

      <!-- 尺寸标注 -->
      <g class="dim">
        <line :x1="sx(-g.maxR)" :x2="sx(g.maxR)" :y1="FRONT_H - 16" :y2="FRONT_H - 16" />
        <line :x1="sx(-g.maxR)" :x2="sx(-g.maxR)" :y1="FRONT_H - 20" :y2="FRONT_H - 12" />
        <line :x1="sx(g.maxR)" :x2="sx(g.maxR)" :y1="FRONT_H - 20" :y2="FRONT_H - 12" />
        <text :x="FRONT_W / 2" :y="FRONT_H - 5" text-anchor="middle">
          最大直径 {{ g.maxR * 2 }}mm
        </text>
        <line :x1="FRONT_W - 14" :x2="FRONT_W - 14" :y1="sy(0)" :y2="sy(g.heightMm)" />
        <line :x1="FRONT_W - 18" :x2="FRONT_W - 10" :y1="sy(0)" :y2="sy(0)" />
        <line :x1="FRONT_W - 18" :x2="FRONT_W - 10" :y1="sy(g.heightMm)" :y2="sy(g.heightMm)" />
        <text
          :x="FRONT_W - 6"
          :y="sy(g.heightMm / 2)"
          text-anchor="middle"
          :transform="`rotate(90 ${FRONT_W - 6} ${sy(g.heightMm / 2)})`"
        >
          总高 {{ g.heightMm }}mm
        </text>
        <text :x="sx(0)" :y="sy(0) + 16" text-anchor="middle" class="dim-sub">
          底口 ⌀{{ (g.sections[0].radiusMm * 2).toFixed(1) }} / 收口 ⌀{{
            (g.sections[g.sections.length - 1].radiusMm * 2).toFixed(1)
          }}mm
        </text>
      </g>

      <!-- 收口贝塞尔控制点（葫芦/花瓶形可拖动） -->
      <g v-if="shoulder" class="ctrl">
        <line :x1="sx(shoulder.p0.x)" :y1="sy(shoulder.p0.y)" :x2="sx(shoulder.p1.x)" :y2="sy(shoulder.p1.y)" />
        <line :x1="sx(shoulder.p3.x)" :y1="sy(shoulder.p3.y)" :x2="sx(shoulder.p2.x)" :y2="sy(shoulder.p2.y)" />
        <line :x1="sx(shoulder.p1.x)" :y1="sy(shoulder.p1.y)" :x2="sx(shoulder.p2.x)" :y2="sy(shoulder.p2.y)" />
        <template v-if="interactive && lantern.mouthStyle === 'gourd'">
          <circle
            :cx="sx(shoulder.p1.x)"
            :cy="sy(shoulder.p1.y)"
            r="5"
            class="handle"
            :class="{ active: dragging === 1 }"
            @pointerdown.stop="startDrag(1, $event)"
          />
          <circle
            :cx="sx(shoulder.p2.x)"
            :cy="sy(shoulder.p2.y)"
            r="5"
            class="handle"
            :class="{ active: dragging === 2 }"
            @pointerdown.stop="startDrag(2, $event)"
          />
          <text :x="sx(shoulder.p1.x) + 7" :y="sy(shoulder.p1.y) - 6" class="ctrl-label">控制点 1</text>
          <text :x="sx(shoulder.p2.x) + 7" :y="sy(shoulder.p2.y) - 6" class="ctrl-label">控制点 2</text>
        </template>
      </g>
    </svg>

    <!-- 俯视图 -->
    <svg v-else-if="mode === 'top'" class="svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
      <g :transform="`translate(${(g.maxR * 2 + PAD * 1.2) / 2},${(g.maxR * 2 + PAD * 1.2) / 2})`">
        <g class="plan-grid">
          <circle :r="g.maxR" fill="none" stroke-dasharray="3 3" />
          <line :x1="-g.maxR - 10" :x2="g.maxR + 10" :y1="0" :y2="0" />
          <line :x1="0" :x2="0" :y1="-g.maxR - 10" :y2="g.maxR + 10" />
        </g>
        <g v-for="(s, i) in [...g.sections].reverse()" :key="i">
          <polygon
            v-if="g.polygon"
            :points="
              Array.from({ length: g.n }, (_, k) => {
                const a = -Math.PI / 2 + (2 * Math.PI * k) / g.n
                return `${(s.radiusMm * Math.cos(a)).toFixed(2)},${(s.radiusMm * Math.sin(a)).toFixed(2)}`
              }).join(' ')
            "
            fill="none"
            :stroke="i === g.sections.length - 1 ? '#7a2b1c' : 'rgba(122,43,28,0.35)'"
            :stroke-width="i === g.sections.length - 1 ? 1.2 : 0.5"
            :stroke-dasharray="i === 0 ? '' : '3 2'"
          />
          <circle
            v-else
            :r="s.radiusMm"
            fill="none"
            :stroke="i === g.sections.length - 1 ? '#7a2b1c' : 'rgba(122,43,28,0.35)'"
            :stroke-width="i === g.sections.length - 1 ? 1.2 : 0.5"
            :stroke-dasharray="i === 0 ? '' : '3 2'"
          />
        </g>
        <g class="ribs">
          <template v-if="g.polygon">
            <circle
              v-for="k in g.n"
              :key="k"
              :cx="g.maxR * Math.cos(-Math.PI / 2 + (2 * Math.PI * (k - 1)) / g.n)"
              :cy="g.maxR * Math.sin(-Math.PI / 2 + (2 * Math.PI * (k - 1)) / g.n)"
              r="3"
            />
          </template>
        </g>
        <text :x="0" :y="-g.maxR - 16" text-anchor="middle" class="dim-text">
          俯视 · 外接 ⌀{{ (g.maxR * 2).toFixed(1) }}mm / {{ g.polygon ? g.n + ' 棱' : '旋转体' }}
        </text>
      </g>
    </svg>

    <!-- 等轴测 -->
    <svg v-else class="svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
      <polygon :points="isoPaths.bottomFill" fill="rgba(179,36,31,0.08)" stroke="none" />
      <polyline
        v-for="(r, i) in isoPaths.rings"
        :key="i"
        :points="r.join(' ')"
        fill="none"
        stroke="rgba(122,43,28,0.7)"
        stroke-width="0.8"
      />
      <line
        v-for="(v, i) in isoPaths.verticals"
        :key="'v' + i"
        :x1="v.split(' ')[0].split(',')[0]"
        :y1="v.split(' ')[0].split(',')[1]"
        :x2="v.split(' ')[1].split(',')[0]"
        :y2="v.split(' ')[1].split(',')[1]"
        stroke="rgba(122,43,28,0.35)"
        stroke-width="0.5"
      />
      <text :x="isoProjection.minX + 12" :y="isoProjection.minY + 16" class="dim-text">
        等轴测示意（骨架线框，非 3D 渲染）
      </text>
    </svg>
  </div>
</template>

<style scoped>
.preview {
  width: 100%;
  height: 100%;
  min-height: 240px;
  background: radial-gradient(circle at 50% 30%, #fffdf7, #f6efe3 70%);
  border-radius: 10px;
  overflow: hidden;
}

.svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.grid line {
  stroke: rgba(160, 140, 110, 0.22);
  stroke-width: 0.3;
}

.grid-label {
  font-size: 7px;
  fill: #a08c6e;
}

.rings line {
  stroke: rgba(60, 30, 20, 0.75);
  stroke-width: 0.7;
}

.corners line {
  stroke: rgba(60, 30, 20, 0.3);
  stroke-width: 0.4;
  stroke-dasharray: 2 2;
}

.dim line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.dim text {
  font-size: 9px;
  fill: #2f5f8a;
}

.dim .dim-sub {
  font-size: 8px;
  fill: #6a5c52;
}

.ctrl line {
  stroke: #2f7a63;
  stroke-width: 0.4;
  stroke-dasharray: 2 1.5;
}

.handle {
  fill: #fff;
  stroke: #2f7a63;
  stroke-width: 1.4;
  cursor: grab;
  pointer-events: all;
}

.handle.active {
  fill: #2f7a63;
  cursor: grabbing;
}

.ctrl-label {
  font-size: 7.5px;
  fill: #2f7a63;
}

.plan-grid line,
.plan-grid circle {
  stroke: rgba(160, 140, 110, 0.5);
  stroke-width: 0.4;
}

.ribs circle {
  fill: #b3241f;
}

.dim-text {
  font-size: 8px;
  fill: #6a5c52;
}
</style>
