<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { COVERINGS, PRESETS, coveringLabel, kindLabel, styleLabel } from '../core/craft'
import { addLantern, createFromPreset, duplicateLantern, removeLantern, state } from '../core/store'

const router = useRouter()

function create(presetId: string) {
  const l = createFromPreset(presetId)
  addLantern(l)
  router.push(`/design/${l.id}`)
}

function open(id: string) {
  router.push(`/design/${id}`)
}

function dup(id: string) {
  const c = duplicateLantern(id)
  if (c) router.push(`/design/${c.id}`)
}

function del(id: string, name: string) {
  if (window.confirm(`确定删除灯样「${name}」？该操作不可撤销。`)) removeLantern(id)
}

const lanterns = computed(() => state.lanterns)

/** 最近修改：本机时间，写到「年-月-日 时:分」，不再只给年月日 */
function updatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="home">
    <section class="hero">
      <h1>选灯型 → 填尺寸 → 出骨架件表 → 出裁片 → 1:1 打印</h1>
      <p>
        做花灯不用再拿尺子在纸上比划：每根竹篾要截多长、弯什么角度，每块蒙面要裁多大（缝份已算进去），
        一页一页按 1:1 打印出来就能拓印到纸上用。
      </p>
      <ul class="steps">
        <li><b>1</b> 选灯型并填最大直径、总高、收口、层数</li>
        <li><b>2</b> 看骨架件表：竖篾/横篾/收口圈的净长与含余量截取长度</li>
        <li><b>3</b> 出蒙面裁片：实际尺寸 + 缝份 + 对位标记</li>
        <li><b>4</b> 打印 1:1 放样图（含 100mm 校验尺）与备料单</li>
      </ul>
    </section>

    <section class="block">
      <h2>灯型库 <em>（本地打包，断网可用）</em></h2>
      <div class="cards">
        <article v-for="p in PRESETS" :key="p.id" class="card">
          <header>
            <h3>{{ p.name }}</h3>
            <span class="kind">{{ kindLabel(p.kind) }}</span>
          </header>
          <p class="tagline">{{ p.tagline }}</p>
          <p class="desc">{{ p.description }}</p>
          <dl>
            <div><dt>最大直径</dt><dd>{{ p.params.maxDiameterMm }}mm</dd></div>
            <div><dt>总高</dt><dd>{{ p.params.totalHeightMm }}mm</dd></div>
            <div>
              <dt>{{ p.kind === 'revolution' ? '母线根数' : p.kind === 'polyhedron' ? '面数' : '棱数' }}</dt>
              <dd>{{ p.params.sides }}</dd>
            </div>
            <div><dt>收口</dt><dd>{{ styleLabel(p.params.mouthStyle) }}</dd></div>
            <div><dt>蒙面</dt><dd>{{ coveringLabel(p.params.covering) }}</dd></div>
          </dl>
          <button class="primary" @click="create(p.id)">新建这种灯</button>
        </article>
      </div>
    </section>

    <section class="block">
      <h2>我的灯样 <em>（保存在本机浏览器，不上传；一盏都没有时会自动给一盏预设灯样）</em></h2>
      <table class="list">
        <thead>
          <tr>
            <th>名称</th>
            <th>类别</th>
            <th>尺寸</th>
            <th>层数 / 棱数</th>
            <th>蒙面</th>
            <th>最近修改</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lanterns" :key="l.id">
            <td class="name">{{ l.name }}</td>
            <td>{{ kindLabel(l.kind) }}</td>
            <td class="mono">⌀{{ l.maxDiameterMm }} × H{{ l.totalHeightMm }}</td>
            <td class="mono">{{ l.layers.length }} 层 / {{ l.sides }} 棱</td>
            <td>{{ coveringLabel(l.covering) }}</td>
            <td class="mono">{{ updatedAt(l.updatedAt) }}</td>
            <td class="ops">
              <button @click="open(l.id)">打开</button>
              <button @click="dup(l.id)">复制</button>
              <button class="danger" @click="del(l.id, l.name)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>蒙面与工艺参数</h2>
      <div class="covers">
        <article v-for="c in COVERINGS" :key="c.id" class="cover">
          <span class="swatch" :style="{ background: c.color }" />
          <div>
            <b>{{ c.name }}</b>
            <span class="mono">用胶 {{ c.gluePerM2 }}g/m² · 默认损耗 {{ Math.round(c.wasteRatio * 100) }}%</span>
            <p>{{ c.note }}</p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.hero {
  background: linear-gradient(135deg, #fff8ea, #f7e9d2);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: var(--shadow);
}

.hero h1 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #8f1c19;
}

.hero p {
  margin: 0 0 14px;
  color: var(--ink-soft);
  max-width: 900px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.steps li {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.steps b {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--red);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 12px;
  flex: none;
}

.block h2 {
  font-size: 16px;
  margin: 0 0 12px;
  color: var(--ink);
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.block h2 em {
  font-style: normal;
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 400;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: 14px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow);
}

.card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card h3 {
  margin: 0;
  font-size: 15px;
}

.kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f6e3ba;
  color: #8f1c19;
  border: 1px solid #e0c78a;
}

.tagline {
  margin: 0;
  font-size: 12px;
  color: var(--red);
}

.desc {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
  min-height: 34px;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  font-size: 12px;
}

dl div {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 2px;
}

dt {
  color: var(--ink-soft);
}

dd {
  margin: 0;
  font-family: var(--mono);
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--ink);
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

button.danger:hover {
  border-color: var(--red);
  color: var(--red);
  background: #fdecea;
}

.list {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
}

.list th {
  text-align: left;
  background: var(--surface-2);
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
  font-size: 12px;
  color: var(--ink-soft);
}

.list td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}

.list tr:last-child td {
  border-bottom: none;
}

.name {
  font-weight: 600;
}

.mono {
  font-family: var(--mono);
}

.ops {
  display: flex;
  gap: 6px;
}

.empty {
  color: var(--ink-soft);
  font-size: 13px;
}

.covers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.cover {
  display: flex;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: var(--shadow);
}

.swatch {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  flex: none;
}

.cover b {
  font-size: 14px;
}

.cover .mono {
  display: block;
  font-size: 11px;
  color: var(--ink-soft);
}

.cover p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
}
</style>
