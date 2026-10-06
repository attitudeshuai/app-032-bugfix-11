// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  state,
  loadStore,
  createFromPreset,
  addLantern,
  getLantern,
  duplicateLantern,
  removeLantern,
  syncLayerDiameters,
  useLanternStore
} from './src/core/store'
import { buildGeometry } from './src/core/geometry'

const KEY = 'lantern-frame-lofting.v1'

/** 把当前内存状态当成「刷新后的新页面」：清模块状态后重新 loadStore */
async function reload() {
  await new Promise((r) => setTimeout(r, 250)) // 等写盘去抖
  state.ready = false
  state.loadNotice = ''
  state.storageError = ''
  state.lanterns = []
  loadStore()
  await Promise.resolve()
}

function storedRaw(): string {
  return localStorage.getItem(KEY) as string
}

beforeEach(() => {
  localStorage.clear()
  state.ready = false
  state.loadNotice = ''
  state.storageError = ''
  state.lanterns = []
})

describe('本机存档：刷新后灯样仍在', () => {
  it('新建的灯样刷新后仍在列表里（不是空表）', async () => {
    loadStore()
    expect(state.lanterns.length).toBe(1) // 首次使用自动给一盏
    const l = addLantern(createFromPreset('hex-palace'))
    l.name = '我改过的名字'
    await reload()
    expect(state.ready).toBe(true)
    expect(state.lanterns.length).toBe(2)
    expect(state.lanterns.some((x) => x.name === '我改过的名字')).toBe(true)
    expect(state.lanterns.some((x) => x.id === l.id)).toBe(true)
  })

  it('本机一盏都没有时自动给一盏，空存档也给一盏', () => {
    loadStore()
    expect(state.lanterns.length).toBe(1)
    localStorage.clear()
    state.ready = false
    state.lanterns = []
    localStorage.setItem(KEY, JSON.stringify({ version: 2, lanterns: [] }))
    loadStore()
    expect(state.lanterns.length).toBe(1)
  })

  it('删到一盏不剩也会自动补一盏', () => {
    loadStore()
    const only = state.lanterns[0]
    removeLantern(only.id)
    expect(state.lanterns.length).toBe(1)
    expect(state.lanterns[0].id).not.toBe(only.id)
  })
})

describe('坏档 / 旧档：不再白屏，且页面有说明', () => {
  it('整份 JSON 损坏：清坏档、补预设、loadNotice 有说明，不抛异常', () => {
    localStorage.setItem(KEY, '{ 这根本不是 JSON ')
    expect(() => loadStore()).not.toThrow()
    expect(state.lanterns.length).toBe(1)
    expect(state.loadNotice).toContain('损坏')
  })

  it('外层结构不对：能认出的灯样保留、认不出的丢弃，并说明哪几盏', () => {
    const good = createFromPreset('round-lantern')
    good.name = '要保住的圆灯'
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: [JSON.parse(JSON.stringify(good)), '废段', null, 42] }))
    loadStore()
    expect(state.lanterns.some((l) => l.name === '要保住的圆灯')).toBe(true)
    expect(state.loadNotice).toContain('3 段')
  })

  it('单盏缺项：缺的参数按预设默认值顶上，灯被留下并说明', () => {
    const full = JSON.parse(JSON.stringify(createFromPreset('hex-palace')))
    delete full.maxDiameterMm
    delete full.covering
    full.layers = [{ heightMm: 200 }, { heightMm: '坏的' as unknown as number }, { heightMm: 220 }]
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: [full] }))
    loadStore()
    expect(state.lanterns.length).toBe(1)
    const l = state.lanterns[0]
    expect(l.maxDiameterMm).toBeGreaterThan(0) // 缺项被默认值顶上
    expect(['xuan', 'silk', 'parchment']).toContain(l.covering)
    expect(l.layers.length).toBe(3) // 一层高度坏掉不影响其余两层
    expect(state.loadNotice).toContain('补齐缺项')
    // 留下的每层直径都是按当前参数重算过的
    const g = buildGeometry(l)
    l.layers.forEach((ly, i) => {
      expect(ly.diameterMm).toBeCloseTo(g.sections[i + 1].radiusMm * 2, 0)
    })
  })

  it('旧版本号：兼容挽救并提示版本', () => {
    const good = JSON.parse(JSON.stringify(createFromPreset('hex-palace')))
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: [good] }))
    loadStore()
    expect(state.loadNotice).toContain('v1')
    expect(JSON.parse(storedRaw()).version).toBe(2) // 读过一次后统一写成当前格式
  })
})

describe('三处一致：存档 / 列表 / 放样直径表', () => {
  it('改一层分段高，内存与存档的每层直径都按当前参数刷新，最后一层也会动', async () => {
    loadStore()
    const l = addLantern(createFromPreset('round-lantern'))
    const before = l.layers.map((x) => x.diameterMm)
    // 把总高与第一层高度改掉，且收口不是平口——最后一层直径受 mouthR 约束，
    // 这里验证所有层（含最后一层）都来自同一份几何结论
    l.layers[0].heightMm += 30
    l.totalHeightMm = l.layers.reduce((s, x) => s + x.heightMm, 0)
    syncLayerDiameters(l)
    const gNow = buildGeometry(l)
    l.layers.forEach((ly, i) => {
      expect(ly.diameterMm).toBeCloseTo(gNow.sections[i + 1].radiusMm * 2, 0)
    })
    expect(l.layers.some((ly, i) => Math.abs(ly.diameterMm - before[i]) > 0.05)).toBe(true)
    await reload()
    const back = getLantern(l.id)!
    const gReload = buildGeometry(back)
    back.layers.forEach((ly, i) => {
      expect(ly.diameterMm).toBeCloseTo(gReload.sections[i + 1].radiusMm * 2, 0)
    })
  }, 10000)

  it('改最大直径（之前漏掉的入口）后直径立即刷新，不靠重开页面', () => {
    loadStore()
    const l = addLantern(createFromPreset('hex-palace'))
    const before = l.layers.map((x) => x.diameterMm)
    l.maxDiameterMm = l.maxDiameterMm + 100
    syncLayerDiameters(l) // DesignView 现在在 @change 里就会调
    expect(l.layers.some((ly, i) => Math.abs(ly.diameterMm - before[i]) > 0.5)).toBe(true)
  })

  it('写盘前会按当前参数再刷一遍直径（手改坏直径也会被纠正）', async () => {
    loadStore()
    const l = state.lanterns[0]
    ;(l.layers[0] as { diameterMm: number }).diameterMm = 9999
    await new Promise((r) => setTimeout(r, 250))
    const raw = JSON.parse(storedRaw())
    const saved = raw.lanterns.find((x: { id: string }) => x.id === l.id)
    const g = buildGeometry(l)
    expect(saved.layers[0].diameterMm).not.toBe(9999)
    expect(saved.layers[0].diameterMm).toBeCloseTo(g.sections[1].radiusMm * 2, 0)
  })
})

describe('复制：副本独立', () => {
  it('副本有独立编号/名字，layers 与 layerColors 深拷贝，删副本原件不丢', () => {
    loadStore()
    const a = addLantern(createFromPreset('hex-palace'))
    const before = { name: a.name, layers: a.layers.length, colors: [...a.layerColors] }
    const c = duplicateLantern(a.id)!
    expect(c.id).not.toBe(a.id)
    expect(c.name).not.toBe(a.name)
    expect(c.layers).not.toBe(a.layers)
    expect(c.layerColors).not.toBe(a.layerColors)
    expect(c.ctrl1).not.toBe(a.ctrl1)

    c.name = '全新的副本名'
    c.layers[0].heightMm += 50
    c.layerColors[0] = '#123456'
    expect(a.name).toBe(before.name)
    expect(a.layers.length).toBe(before.layers)
    expect(a.layerColors).toEqual(before.colors)

    removeLantern(c.id)
    expect(getLantern(a.id)).toBeDefined()
    expect(getLantern(c.id)).toBeUndefined()
  })
})

describe('最近修改：写到时分', () => {
  it('改动后 updatedAt 变化，格式可显示到时分', async () => {
    loadStore()
    const l = state.lanterns[0]
    const t0 = l.updatedAt
    await new Promise((r) => setTimeout(r, 20))
    l.name = '改个名试试'
    await new Promise((r) => setTimeout(r, 250))
    expect(getLantern(l.id)!.updatedAt).not.toBe(t0)
    const d = new Date(getLantern(l.id)!.updatedAt)
    expect(d.getMinutes()).toBeGreaterThanOrEqual(0) // 是合法时间，HomeView 取 getHours/getMinutes 展示
  })
})

describe('读档写锁', () => {
  it('读完后落一次盘（v2 当前格式），读档期间没有半成品写入', () => {
    localStorage.clear()
    state.ready = false
    state.lanterns = []
    const good = JSON.parse(JSON.stringify(createFromPreset('hex-palace')))
    localStorage.setItem(KEY, JSON.stringify({ version: 1, lanterns: [good] }))
    const writes: string[] = []
    const origSet = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === KEY) writes.push(v)
      return origSet(k, v)
    })
    loadStore()
    expect(writes.length).toBe(1) // 只有读完全部、修复完成后的那一次，没有读到一半的压写
    expect(JSON.parse(writes[0]).version).toBe(2)
  })
})

describe('useLanternStore 门面', () => {
  it('暴露 dismissLoadNotice', () => {
    expect(typeof useLanternStore().dismissLoadNotice).toBe('function')
  })
})
