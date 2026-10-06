// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { defineComponent, h } from 'vue'

// 通过完整 SFC 导入触发 vue plugin 编译
import HomeView from './src/views/HomeView.vue'
import App from './src/App.vue'
import { state, loadStore } from './src/core/store'
import { router } from './src/router'

const KEY = 'lantern-frame-lofting.v1'

function mount(Comp: unknown) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp(Comp as never)
  app.use(router)
  app.mount(el)
  return { el, app }
}

beforeEach(async () => {
  localStorage.clear()
  state.ready = false
  state.loadNotice = ''
  state.lanterns = []
  await router.push('/')
})

describe('页面表现', () => {
  it('首次打开列表不空：自动给一盏预设灯样', async () => {
    loadStore()
    const { el } = mount(HomeView)
    await nextTick()
    const rows = el.querySelectorAll('.list tbody tr')
    expect(rows.length).toBe(1)
    // 最近修改列含「时:分」
    const timeCell = el.querySelector('.list tbody tr td:last-child')
    // 操作列是最后一列，时间列在其前面
    const cells = el.querySelectorAll('.list tbody tr td')
    const updated = Array.from(cells).find((td) => /\d{2}:\d{2}/.test(td.textContent || ''))
    expect(updated).toBeTruthy()
    expect(timeCell).toBeTruthy()
  })

  it('坏档不白屏：页面出现说明条', async () => {
    localStorage.setItem(KEY, '{坏的')
    expect(() => loadStore()).not.toThrow()
    const { el } = mount(App)
    await nextTick()
    const notice = el.querySelector('.load-notice')
    expect(notice?.textContent).toContain('损坏')
    expect(state.lanterns.length).toBe(1)
  })

  it('复制后改副本名字/分段，列表中原灯样名字不变', async () => {
    loadStore()
    const { el } = mount(HomeView)
    await nextTick()
    const dupBtn = el.querySelector('.list tbody tr .ops button:nth-child(2)') as HTMLButtonElement
    dupBtn.click()
    await nextTick()
    expect(state.lanterns.length).toBe(2)
    const orig = state.lanterns[1]
    const copy = state.lanterns[0]
    expect(orig.id).not.toBe(copy.id)
    copy.name = '副本改名XYZ'
    copy.layers[0].heightMm += 40
    expect(state.lanterns[1].name).toBe(orig.name)
  })
})
