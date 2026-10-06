// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import DesignView from './src/views/DesignView.vue'
import { state, loadStore, createFromPreset, addLantern } from './src/core/store'
import { router } from './src/router'

function mountAt(id: string) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp(DesignView)
  app.use(router)
  app.mount(el)
  return { el, app }
}

function diameterCells(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('.layers tbody tr')).map((tr) =>
    (tr.children[2] as HTMLElement).textContent || ''
  )
}

beforeEach(async () => {
  localStorage.clear()
  state.ready = false
  state.loadNotice = ''
  state.lanterns = []
})

describe('放样页直径表', () => {
  it('改最大直径后直径表立刻刷新（不再是老数）', async () => {
    loadStore()
    const l = addLantern(createFromPreset('hex-palace'))
    await router.push(`/design/${l.id}`)
    await nextTick()
    const { el } = mountAt(l.id)
    await nextTick()
    const before = diameterCells(el)

    const maxD = el.querySelector('input[type="number"]') as HTMLInputElement
    // 第二个 number input 才是最大直径（名称是 text）；直接改数据并派发 change
    const inputs = Array.from(el.querySelectorAll('input[type="number"]')) as HTMLInputElement[]
    const maxDInput = inputs.find((i) => Number(i.value) === l.maxDiameterMm && i.min === '20')!
    maxDInput.value = String(l.maxDiameterMm + 100)
    maxDInput.dispatchEvent(new Event('input', { bubbles: true }))
    maxDInput.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    const after = diameterCells(el)
    expect(after).not.toEqual(before)
  })

  it('改第一层分段高，直径表按新的层位置整列刷新（不再停在老数）', async () => {
    loadStore()
    const l = addLantern(createFromPreset('round-lantern'))
    await router.push(`/design/${l.id}`)
    await nextTick()
    const { el } = mountAt(l.id)
    await nextTick()
    const before = diameterCells(el)
    const heightInputs = Array.from(el.querySelectorAll('.layers input[type="number"]')) as HTMLInputElement[]
    const add = 120 // 加高到越过直筒段，逼迫后续各层（含末层附近）的直径变化
    heightInputs[0].value = String(l.layers[0].heightMm + add)
    heightInputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    heightInputs[0].dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    const after = diameterCells(el)
    expect(after).not.toEqual(before)
    // 与存档里回写的直径、与几何现算三者一致
    const expected = l.layers.map((ly) => ly.diameterMm.toFixed(1))
    expect(after).toEqual(expected)
  })
})
