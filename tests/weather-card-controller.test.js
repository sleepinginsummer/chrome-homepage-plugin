import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWeatherCardController } from '../weather-card-controller.js'

const TEXT = {
  title: '天气',
  loading: '正在获取天气...',
  error: '天气加载失败，点击刷新重试',
  empty: '暂无天气数据',
  humidity: '湿度',
  updatedAt: '更新于',
  refresh: '刷新天气'
}

const WEATHER_DATA = {
  updatedAt: '2026-09-10 20:00',
  current: { condition: '晴', temperature: '28', humidity: '40', wind: '东风', windSpeed: '3级' },
  forecasts: []
}

const CONTENT_SELECTOR = '[data-weather-content]'
const UPDATED_AT_SELECTOR = '[data-weather-updated-at]'
const CARD_ELEMENT_SELECTOR = '.card[data-card-id="weather-1"]'

/**
 * 构造弹窗与卡片共用的 DOM 桩：按选择器返回元素，沿用仓库其它测试的手写桩风格。
 */
const createDom = () => {
  const elements = new Map()
  const createEl = (selector) => {
    const listeners = new Map()
    const el = {
      hidden: false,
      textContent: '',
      value: '',
      innerHTML: '',
      dataset: {},
      // 卡片会用 style.setProperty 写 CSS 变量（背景漂移周期随风速变化）
      style: { setProperty: vi.fn() },
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      setCustomValidity: vi.fn(),
      reportValidity: vi.fn(),
      focus: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: null, ...event })
    }
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: createEl('#weatherOverlay'),
    title: createEl('#weatherModalTitle'),
    cityInput: createEl('#weatherCityInput'),
    form: createEl('#weatherForm'),
    closeBtn: createEl('#weatherCloseBtn'),
    cancelBtn: createEl('#weatherCancelBtn'),
    content: createEl(CONTENT_SELECTOR),
    updatedAt: createEl(UPDATED_AT_SELECTOR),
    cardEl: createEl(CARD_ELEMENT_SELECTOR)
  }
  dom.querySelector = vi.fn((selector) => elements.get(selector) || null)
  // 卡片元素内部只要内容区与更新时间节点，供 updateWeatherCardDom 写入。
  dom.cardEl.querySelector = (selector) => {
    if (selector === CONTENT_SELECTOR) return dom.content
    if (selector === UPDATED_AT_SELECTOR) return dom.updatedAt
    return null
  }
  return dom
}

/**
 * 组装控制器依赖：卡片仓储与天气客户端都用替身，方便断言调用序列。
 */
const createHarness = (overrides = {}) => {
  const dom = createDom()
  const cards = []
  const deps = {
    dom,
    list: vi.fn(() => cards),
    getById: vi.fn((id) => cards.find((card) => card.id === id) || null),
    persist: vi.fn(async (next) => {
      cards.length = 0
      cards.push(...next)
    }),
    apply: vi.fn(),
    closeOverlays: vi.fn(),
    load: vi.fn(async () => WEATHER_DATA),
    invalidate: vi.fn(async () => {}),
    ...overrides
  }
  let scheduled = null

  const controller = createWeatherCardController({
    storage: {},
    getLang: () => 'zh',
    getText: () => TEXT,
    runWhenIdle: (task) => {
      scheduled = task()
    },
    closeOverlays: deps.closeOverlays,
    client: { load: deps.load, invalidate: deps.invalidate },
    root: { querySelector: dom.querySelector },
    cards: {
      list: deps.list,
      getById: deps.getById,
      persist: deps.persist,
      apply: deps.apply
    }
  })

  return { controller, deps, scheduledTask: () => scheduled }
}

describe('weather card controller', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the card with the page text', () => {
    const { controller } = createHarness()

    const html = controller.renderHtml({ title: '南京天气', city: '南京' })

    expect(html).toContain('南京天气')
    expect(html).toContain(TEXT.loading)
  })

  it('loads by city on mount and writes the result into the card', async () => {
    const { controller, deps, scheduledTask } = createHarness()

    controller.initialize({ city: '南京' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.load).toHaveBeenCalledWith('南京', { forceRefresh: false })
    expect(deps.dom.content.innerHTML).toContain('28')
    expect(deps.dom.updatedAt.textContent).toBe(`${TEXT.updatedAt} ${WEATHER_DATA.updatedAt}`)
  })

  it('shows the error state when the request fails', async () => {
    const { controller, deps, scheduledTask } = createHarness({
      load: vi.fn(async () => { throw new Error('boom') })
    })

    controller.initialize({ city: '南京' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.dom.content.innerHTML).toContain(TEXT.error)
  })

  it('ignores a card that is not a weather card', async () => {
    const { controller, deps } = createHarness()

    await controller.refresh('unknown-card')

    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('re-renders when the card element is missing', async () => {
    const card = { id: 'weather-1', type: 'weather', city: '南京' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })

    await controller.refresh('weather-1')

    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('refreshes a mounted card with forceRefresh', async () => {
    const card = { id: 'weather-1', type: 'weather', city: '南京' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })
    deps.dom.cardEl.dataset.weatherRenderToken = 'token-1'

    await controller.refresh('weather-1')

    expect(deps.load).toHaveBeenCalledWith('南京', { forceRefresh: true })
  })

  it('invalidates the city cache only when no card uses it anymore', async () => {
    const { controller, deps } = createHarness()

    await controller.cleanup({ type: 'weather', city: '南京' }, [{ type: 'weather', city: '南京' }])
    expect(deps.invalidate).not.toHaveBeenCalled()

    await controller.cleanup({ type: 'weather', city: '南京' }, [{ type: 'weather', city: '上海' }])
    expect(deps.invalidate).toHaveBeenCalledWith('南京')
  })

  it('opens the edit modal with the current city', () => {
    const card = { id: 'weather-1', type: 'weather', city: '上海' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })

    controller.openModal({ mode: 'edit', cardId: 'weather-1' })

    expect(deps.dom.title.textContent).toBe('天气设置')
    expect(deps.dom.cityInput.value).toBe('上海')
    expect(deps.dom.overlay.hidden).toBe(false)
    expect(deps.closeOverlays).toHaveBeenCalledOnce()
  })

  it('adds a card from the create modal and closes it', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.cityInput.value = ' 广州 '

    await deps.dom.form.fire('submit')

    expect(deps.persist).toHaveBeenCalledOnce()
    const next = deps.persist.mock.calls[0][0]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ type: 'weather', city: '广州', title: '广州天气' })
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('patches the city and drops the stale cache in edit mode', async () => {
    const previous = { id: 'weather-1', type: 'weather', city: '上海', title: '上海天气' }
    const { controller, deps } = createHarness({ list: vi.fn(() => [previous]), getById: vi.fn(() => previous) })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'weather-1' })
    deps.dom.cityInput.value = '南京'

    await deps.dom.form.fire('submit')

    expect(deps.persist.mock.calls[0][0][0]).toMatchObject({ id: 'weather-1', city: '南京', title: '南京天气' })
    // 旧城市已无卡片使用，缓存应被回收。
    expect(deps.invalidate).toHaveBeenCalledWith('上海')
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('rejects an empty city without persisting', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.cityInput.value = '   '

    await deps.dom.form.fire('submit')

    expect(deps.dom.cityInput.setCustomValidity).toHaveBeenCalledWith('请输入城市名称')
    expect(deps.dom.cityInput.reportValidity).toHaveBeenCalledOnce()
    expect(deps.persist).not.toHaveBeenCalled()
    expect(deps.dom.overlay.hidden).toBe(false)
  })

  it('routes refresh clicks to the client and plain clicks to the modal', async () => {
    const card = { id: 'weather-1', type: 'weather', city: '南京' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })
    deps.dom.cardEl.dataset.weatherRenderToken = 'token-1'

    const evt = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { closest: () => ({ dataset: { weatherAction: 'refresh' } }) }
    }
    await controller.handleClick(card, evt)

    expect(deps.load).toHaveBeenCalledOnce()
    expect(evt.preventDefault).toHaveBeenCalledOnce()

    await controller.handleClick(card, { target: { closest: () => null } })

    expect(deps.dom.overlay.hidden).toBe(false)
    expect(deps.load).toHaveBeenCalledOnce()
  })

  it('closes the modal from the overlay, the close and the cancel buttons', () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()

    controller.openModal({ mode: 'create' })
    deps.dom.overlay.fire('click', { target: deps.dom.overlay })
    expect(deps.dom.overlay.hidden).toBe(true)

    // 点击遮罩内部不应关闭弹窗。
    controller.openModal({ mode: 'create' })
    deps.dom.overlay.fire('click', { target: deps.dom.cityInput })
    expect(deps.dom.overlay.hidden).toBe(false)

    deps.dom.closeBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    deps.dom.cancelBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)
  })
})
