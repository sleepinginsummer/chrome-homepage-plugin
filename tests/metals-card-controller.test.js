import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMetalsCardController } from '../metals-card-controller.js'

const TEXT = {
  title: '黄金白银',
  gold: '国际金价',
  silver: '国际银价',
  usd: '美元',
  cny: '人民币',
  loading: '加载中...',
  error: '加载失败，点击刷新重试'
}

const ITEMS = [
  { key: 'gold', usdPrice: 2400.5, cnyPrice: 560.25, timeText: '2026-09-10 20:00', changeUsd: null, changeCny: null }
]

const CARD_ELEMENT_SELECTOR = '.card[data-card-id="metals-1"]'
const GRID_SELECTOR = '[data-metals-grid]'
const UPDATED_AT_SELECTOR = '[data-metals-updated-at]'

/**
 * 构造卡片元素与根节点桩：控制器只按卡片选择器取元素。
 */
const createDom = () => {
  const grid = { innerHTML: '' }
  const updatedAt = { textContent: '' }
  const cardEl = {
    dataset: {},
    querySelector: (selector) => (selector === GRID_SELECTOR ? grid : selector === UPDATED_AT_SELECTOR ? updatedAt : null)
  }
  const elements = new Map([[CARD_ELEMENT_SELECTOR, cardEl]])

  return {
    cardEl,
    grid,
    updatedAt,
    querySelector: vi.fn((selector) => elements.get(selector) || null)
  }
}

const createHarness = ({ seedCards = [], ...overrides } = {}) => {
  const dom = createDom()
  const store = [...seedCards]
  const deps = {
    dom,
    list: vi.fn(() => store),
    getById: vi.fn((id) => store.find((card) => card.id === id) || null),
    persist: vi.fn(async (next) => {
      store.length = 0
      store.push(...next)
    }),
    apply: vi.fn(),
    openUrl: vi.fn(async () => {}),
    load: vi.fn(async () => ITEMS),
    invalidate: vi.fn(),
    ...overrides
  }

  const controller = createMetalsCardController({
    getLang: () => 'zh',
    getText: () => TEXT,
    openUrl: deps.openUrl,
    send: vi.fn(),
    client: { load: deps.load, invalidate: deps.invalidate },
    root: { querySelector: dom.querySelector },
    cards: {
      list: deps.list,
      getById: deps.getById,
      persist: deps.persist,
      apply: deps.apply
    }
  })

  return { controller, deps, store }
}

describe('metals card controller', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the card html through the injected text', () => {
    const { controller } = createHarness()

    const html = controller.renderHtml({ title: '金银' })

    expect(html).toContain('金银')
    expect(html).toContain(TEXT.loading)
  })

  it('loads quotes into the card and maps the item keys', async () => {
    const { controller, deps } = createHarness()
    deps.dom.cardEl.dataset.metalsRenderToken = 'token-1'

    await controller.loadData({ id: 'metals-1', type: 'metals' }, { cardEl: deps.dom.cardEl, renderToken: 'token-1' })

    expect(deps.load).toHaveBeenCalledWith('metals-1', { forceRefresh: false })
    expect(deps.dom.grid.innerHTML).toContain(TEXT.gold)
    expect(deps.dom.grid.innerHTML).toContain('2400.50')
  })

  it('writes the error state when the quote request fails', async () => {
    const { controller, deps } = createHarness({ load: vi.fn(async () => { throw new Error('boom') }) })
    deps.dom.cardEl.dataset.metalsRenderToken = 'token-1'

    await controller.loadData({ id: 'metals-1', type: 'metals' }, { cardEl: deps.dom.cardEl, renderToken: 'token-1' })

    expect(deps.dom.grid.innerHTML).toContain(TEXT.error)
    expect(console.error).toHaveBeenCalled()
  })

  it('ignores refresh for other card types and re-renders when the element is gone', async () => {
    const card = { id: 'metals-1', type: 'metals' }
    const { controller, deps } = createHarness({ seedCards: [card] })

    await controller.refresh('unknown')
    expect(deps.invalidate).not.toHaveBeenCalled()

    await controller.refresh('metals-1')

    expect(deps.invalidate).toHaveBeenCalledWith('metals-1')
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('forces a reload when the card element is mounted', async () => {
    const card = { id: 'metals-1', type: 'metals' }
    const { controller, deps } = createHarness({ seedCards: [card] })
    deps.dom.cardEl.dataset.metalsRenderToken = 'token-1'

    await controller.refresh('metals-1')

    expect(deps.invalidate).toHaveBeenCalledWith('metals-1')
    expect(deps.load).toHaveBeenCalledWith('metals-1', { forceRefresh: true })
  })

  it('routes refresh clicks, symbol clicks and ignores plain clicks', async () => {
    const card = { id: 'metals-1', type: 'metals' }
    const { controller, deps } = createHarness({ seedCards: [card] })
    deps.dom.cardEl.dataset.metalsRenderToken = 'token-1'

    const refreshEvt = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { closest: (selector) => (selector === '[data-metals-action]' ? { dataset: { metalsAction: 'refresh' } } : null) }
    }
    await controller.handleClick(card, refreshEvt)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(refreshEvt.preventDefault).toHaveBeenCalledOnce()

    const symbolEvt = {
      target: { closest: (selector) => (selector === '[data-metals-symbol]' ? { dataset: { metalsSymbol: 'XAU' } } : null) }
    }
    await controller.handleClick(card, symbolEvt)
    expect(deps.openUrl).toHaveBeenCalledWith('https://finance.yahoo.com/quote/XAU')

    // 贵金属卡片没有配置弹窗，普通点击不做任何事。
    await controller.handleClick(card, { target: { closest: () => null } })
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(deps.openUrl).toHaveBeenCalledTimes(1)
  })

  it('adds a component titled with the current text', async () => {
    const { controller, deps } = createHarness()

    await controller.addComponent()

    expect(deps.persist).toHaveBeenCalledOnce()
    expect(deps.persist.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'metals', title: TEXT.title })
    ])
    expect(deps.apply).toHaveBeenCalledOnce()
  })
})
