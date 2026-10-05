<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PanelDiagram from '../components/PanelDiagram.vue'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { bodySurfaceArea } from '../core/geometry'
import { downloadText, panelsCsv, shapeName } from '../core/exporter'
import { coveringSpec } from '../core/craft'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

const ratio = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return 1
  const ref = bodySurfaceArea(full.value.frame.geometry, Math.max(3, Math.round(l.divisions)))
  return ref > 0 ? full.value.panels.netAreaMm2 / ref : 1
})

const palette = computed(() => {
  const l = lantern.value
  if (!l) return []
  return l.layers.map((ly, i) => ({
    i: i + 1,
    color: l.layerColors[i] || l.color,
    height: ly.heightMm,
    diameter: ly.diameterMm,
    panels: full.value?.panels.panels.filter((p) => p.layerIndex === i).length || 0
  }))
})

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-蒙面裁片清单.csv`, panelsCsv(l, full.value.panels.panels))
}
</script>

<template>
  <div v-if="!lantern || !full" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="panels-view">
    <section class="head">
      <div>
        <h2>蒙面裁片与缝份 · {{ lantern.name }}</h2>
        <p class="sub">
          蒙面 {{ coveringSpec(lantern.covering).name }} ·
          <b>缝份四边各 {{ lantern.seamAllowanceMm }}mm（已加进裁片尺寸）</b> ·
          实线 = 裁切线，绿色虚线 = 净样（折到背面的缝份线），蓝色十字 = 对位标记
          <template v-if="lantern.kind === 'revolution'">
            · 旋转体按 <b>{{ lantern.divisions }} 等分</b>近似展开，等分数可调
          </template>
        </p>
      </div>
      <div class="ops">
        <button @click="exportCsv">导出裁片清单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=labels`)">打印裁片标签</button>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
      <div class="stat"><span>裁片净面积</span><b>{{ (full.panels.netAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>含缝份裁片面积</span><b>{{ (full.panels.cutAreaMm2 / 1e6).toFixed(3) }} m²</b></div>
      <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
      <div class="stat"><span>净面积 / 表面积</span><b>{{ (ratio * 100).toFixed(2) }}%</b></div>
    </section>

    <div class="cards">
      <article v-for="p in full.panels.panels" :key="p.id" class="card">
        <header>
          <h3>
            <span class="dot" :style="{ background: p.color }" />
            {{ p.label }}
          </h3>
          <span class="qty">× {{ p.qty }} 块</span>
        </header>
        <div class="diagram">
          <PanelDiagram :panel="p" />
        </div>
        <table class="dims">
          <tbody>
            <tr>
              <td>展开净尺寸</td>
              <td class="mono">上 {{ p.rawWidthTopMm.toFixed(1) }} / 下 {{ p.rawWidthBottomMm.toFixed(1) }} × 高 {{ p.rawHeightMm.toFixed(1) }}</td>
            </tr>
            <tr class="cut">
              <td>裁切尺寸</td>
              <td class="mono">上 {{ p.widthTopMm.toFixed(1) }} / 下 {{ p.widthBottomMm.toFixed(1) }} × 高 {{ p.heightMm.toFixed(1) }}</td>
            </tr>
            <tr>
              <td>形状 / 缝份</td>
              <td class="mono">{{ shapeName(p.shape) }} · +{{ p.seamAllowanceMm }}×2</td>
            </tr>
            <tr v-if="p.radiusMm">
              <td>净半径</td>
              <td class="mono">{{ p.radiusMm.toFixed(1) }}mm</td>
            </tr>
          </tbody>
        </table>
        <p class="note">{{ p.note }}</p>
        <details>
          <summary>对位标记（{{ p.marksMm.length }} 处）</summary>
          <ol>
            <li v-for="(m, i) in p.marksMm" :key="i">
              <b>{{ i + 1 }}</b> {{ m.label }}：x={{ m.x.toFixed(1) }} y={{ m.y.toFixed(1) }} mm
            </li>
          </ol>
        </details>
      </article>
    </div>

    <section class="palette">
      <h3>灯身分段配色清单（不做 3D 渲染）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>颜色</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">该层直径 (mm)</th>
            <th class="num">该层裁片种类</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in palette" :key="p.i">
            <td class="mono">第 {{ p.i }} 层</td>
            <td>
              <span class="dot" :style="{ background: p.color }" />
              <span class="mono">{{ p.color }}</span>
            </td>
            <td class="num mono">{{ p.height.toFixed(1) }}</td>
            <td class="num mono">{{ p.diameter.toFixed(1) }}</td>
            <td class="num mono">{{ p.panels }} 种</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ChecksPanel
      :checks="full.checks.filter((c) => ['CHK-03', 'CHK-05', 'CHK-06'].includes(c.id))"
      :elapsed-ms="full.elapsedMs"
      title="裁片与分页自检"
    />
  </div>
</template>

<style scoped>
.panels-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
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

.stats {
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
  padding: 10px 14px;
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

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 14px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow);
}

.card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.card h3 {
  margin: 0;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--line-strong);
}

.qty {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--red);
  background: #fbeae6;
  border-radius: 999px;
  padding: 2px 9px;
}

.diagram {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px;
}

.dims {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dims td {
  padding: 3px 6px;
  border-bottom: 1px dashed var(--line);
}

.dims td:first-child {
  color: var(--ink-soft);
  width: 96px;
}

.dims tr.cut td {
  color: #8f1c19;
  font-weight: 600;
}

.mono {
  font-family: var(--mono);
}

.note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
}

details {
  font-size: 12px;
  color: var(--ink-soft);
}

summary {
  cursor: pointer;
}

ol {
  margin: 6px 0 0;
  padding-left: 18px;
}

.palette {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.palette table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.palette th {
  text-align: left;
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
}

.palette td {
  padding: 6px 10px;
  border-bottom: 1px dashed var(--line);
}

.num {
  text-align: right;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
