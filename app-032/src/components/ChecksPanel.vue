<script setup lang="ts">
/** 自检面板：逐条展示 §10 验收断言的实时结果 */
import type { CheckResult } from '../core/types'

defineProps<{ checks: CheckResult[]; title?: string; elapsedMs?: number }>()
</script>

<template>
  <section class="checks">
    <header>
      <h3>{{ title || '自检 / 验收断言' }}</h3>
      <span v-if="elapsedMs !== undefined" class="pill">
        计算耗时 {{ elapsedMs.toFixed(1) }}ms
      </span>
      <span class="pill" :class="{ bad: checks.some((c) => !c.pass) }">
        {{ checks.filter((c) => c.pass).length }} / {{ checks.length }} 通过
      </span>
    </header>
    <ul>
      <li v-for="c in checks" :key="c.id" :class="{ fail: !c.pass }">
        <span class="tag">{{ c.id }}</span>
        <span class="mark" :class="c.pass ? 'ok' : 'no'">{{ c.pass ? '通过' : '未通过' }}</span>
        <div class="body">
          <div class="title">
            {{ c.title }}
            <em v-if="c.value">｜{{ c.value }}</em>
          </div>
          <div class="detail">{{ c.detail }}</div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.checks {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

h3 {
  margin: 0;
  font-size: 15px;
  color: var(--ink);
}

.pill {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--jade);
  border: 1px solid #cbe3d8;
  font-family: var(--mono);
}

.pill.bad {
  background: #fdecea;
  color: var(--red);
  border-color: #f2c7c1;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}

li.fail {
  background: #fdf1ef;
  border-color: #f2c7c1;
}

.tag {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-soft);
  padding-top: 2px;
  white-space: nowrap;
}

.mark {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  white-space: nowrap;
  font-weight: 600;
}

.mark.ok {
  background: #e3f1ea;
  color: var(--jade);
}

.mark.no {
  background: #fadbd6;
  color: var(--red);
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
}

.title em {
  font-style: normal;
  font-family: var(--mono);
  font-weight: 400;
  color: var(--blue);
  font-size: 12px;
}

.detail {
  font-size: 12px;
  color: var(--ink-soft);
  word-break: break-word;
}
</style>
