<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { state, dismissLoadNotice } from './core/store'

const route = useRoute()
const lanternId = computed(() => (route.params.id as string) || '')
const currentName = computed(() => {
  const l = state.lanterns.find((x) => x.id === lanternId.value)
  return l ? l.name : ''
})

const nav = computed(() => {
  const id = lanternId.value
  if (!id) return []
  return [
    { to: `/design/${id}`, label: '参数与预览' },
    { to: `/frame/${id}`, label: '骨架件表' },
    { to: `/panels/${id}`, label: '蒙面裁片' },
    { to: `/print/${id}`, label: '1:1 放样图' },
    { to: `/materials/${id}`, label: '材料与备料' }
  ]
})

/** 本机时间，写到「年-月-日 时:分」 */
function formatSaved(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="app">
    <header class="app-header no-print">
      <router-link to="/" class="brand">
        <span class="brand-mark">灯</span>
        <span class="brand-text">
          <strong>花灯骨架放样与蒙面裁片</strong>
          <em>Lantern Frame Lofting · 全 mm 单位 · 1:1 可打印</em>
        </span>
      </router-link>
      <nav v-if="nav.length" class="app-nav">
        <span class="app-nav-name" :title="currentName">{{ currentName }}</span>
        <router-link v-for="n in nav" :key="n.to" :to="n.to">{{ n.label }}</router-link>
      </nav>
    </header>

    <main class="app-main">
      <div v-if="state.loadNotice" class="load-notice no-print" role="alert">
        <span class="load-notice-icon">!</span>
        <p class="load-notice-text">{{ state.loadNotice }}</p>
        <button class="load-notice-close" @click="dismissLoadNotice">知道了</button>
      </div>
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <footer class="app-footer no-print">
      骨架放样 + 蒙面裁片 + 1:1 图纸 + 备料单｜灯型库与工艺参数本地打包，断网可用
      <span class="save-state" :class="{ bad: state.storageError }">
        {{ state.storageError ? `本机存储异常：${state.storageError}` : state.lastSavedAt ? `本机存档已于 ${formatSaved(state.lastSavedAt)} 保存` : '' }}
      </span>
    </footer>
  </div>
</template>

<style>
:root {
  --parchment: #f3ece0;
  --surface: #fffdf8;
  --surface-2: #faf4e9;
  --ink: #2b2320;
  --ink-soft: #6a5c52;
  --line: #ddd0bd;
  --line-strong: #c6b49b;
  --red: #b3241f;
  --red-soft: #d8534a;
  --gold: #b8891f;
  --jade: #2f7a63;
  --blue: #2f5f8a;
  --shadow: 0 1px 2px rgba(60, 40, 20, 0.06), 0 6px 18px rgba(60, 40, 20, 0.06);
  --mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--parchment);
  color: var(--ink);
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', 'Source Han Sans SC', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--red);
  text-decoration: none;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 22px;
  background: linear-gradient(180deg, #8f1c19, #b3241f 60%, #9c1f1b);
  color: #fdf4e3;
  box-shadow: 0 2px 10px rgba(80, 20, 10, 0.25);
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: inherit;
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: #f6e3ba;
  color: #b3241f;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  box-shadow: inset 0 0 0 2px #c9a227;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text strong {
  font-size: 15px;
  letter-spacing: 0.5px;
}

.brand-text em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.78;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

.app-nav-name {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-nav a {
  color: #fdf4e3;
  font-size: 13px;
  padding: 5px 11px;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}

.app-nav a:hover {
  background: rgba(255, 255, 255, 0.12);
}

.app-nav a.router-link-active {
  background: #f6e3ba;
  color: #8f1c19;
  border-color: #c9a227;
  font-weight: 600;
}

.app-main {
  flex: 1;
  padding: 18px 22px 40px;
  max-width: 1560px;
  width: 100%;
  margin: 0 auto;
}

.app-footer {
  padding: 14px 22px;
  font-size: 12px;
  color: var(--ink-soft);
  border-top: 1px solid var(--line);
  display: flex;
  gap: 16px;
  justify-content: center;
}

.load-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
  padding: 10px 14px;
  background: #fdf3e2;
  border: 1px solid #e0b86f;
  border-left: 5px solid #b8891f;
  border-radius: 8px;
  color: #6f4c10;
  font-size: 13px;
  line-height: 1.55;
}

.load-notice-icon {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #b8891f;
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
}

.load-notice-text {
  margin: 0;
  flex: 1;
}

.load-notice-close {
  flex: none;
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border: 1px solid #d9b571;
  border-radius: 6px;
  background: #fff;
  color: #6f4c10;
  cursor: pointer;
}

.load-notice-close:hover {
  background: #f7e8c8;
}

.save-state {
  color: var(--jade);
}

.save-state.bad {
  color: var(--red);
}

@media print {
  .app-header,
  .app-footer,
  .no-print {
    display: none !important;
  }

  .app-main {
    padding: 0;
    max-width: none;
  }

  body {
    background: #fff;
  }
}
</style>
