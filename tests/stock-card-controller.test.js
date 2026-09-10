import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStockCardController } from '../stock-card-controller.js'

const TEXT = { liveLabel: '实时行情', updatedAt: '更新于', loading: '加载中...', empty: '暂无数据', error: '加载失败，点击刷新重试' }
const CARD_ELEMENT_SELECTOR = '.card[data-card-id="stock-1"]'
const LIST_SELECTOR = '[data-stock-list]'
const UPDATED_AT_SELECTOR = '[data-stock-updated-at]'
const ITEMS = [{ symbol: '600000', name: 'ACME', price: 10.5, change: 0.5, changePercent: 5, currency: 'CNY', marketTime: 1789000000 }]

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
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      getAttribute: vi.fn((name) => el.attributes?.[name] ?? null),
      attributes: {},
      focus: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: null, ...event })
    }
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: createEl('#stockOverlay'),
    title: createEl('#stockModalTitle'),
    titleInput: createEl('#stockTitleInput'),
    symbolInput: createEl('#stockSymbolInput'),
    list: createEl('#stockList'),
    form: createEl('#stockForm'),
    closeBtn: createEl('#stockCloseBtn'),
    cancelBtn: createEl('#stockCancelBtn')
  }

  // 卡片元素：内部只要行情列表区与更新时间节点。
  const contentList = { innerHTML: '' }
  const contentUpdatedAt = { textContent: '' }
  dom.cardEl = {
    dataset: {},
    querySelector: (selector) => (selector === LIST_SELECTOR ? contentList : selector === UPDATED_AT_SELECTOR ? contentUpdatedAt : null)
  }
  dom.cardList = contentList
  dom.cardUpdatedAt = contentUpdatedAt
  elements.set(CARD_ELEMENT_SELECTOR, dom.cardEl)

  dom.querySelector = vi.fn((selector) => elements.get(selector) || null)
  return dom
}

const createHarness = ({ seedCards = [], ...overrides } = {}) => {
  const dom = createDom()
  // 真实存储语义：persist 写入后 getById 必须能读到最新卡片，否则重渲染会拿到旧数据。
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
    confirm: vi.fn(),
    setError: vi.fn(),
    closeOverlays: vi.fn(),
    load: vi.fn(async () => ITEMS),
    peek: vi.fn(() => ITEMS),
    invalidate: vi.fn(),
    ...overrides
  }

  const controller = createStockCardController({
    getLang: () => 'zh',
    getText: () => TEXT,
    openUrl: deps.openUrl,
    confirm: deps.confirm,
    setError: deps.setError,
    closeOverlays: deps.closeOverlays,
    client: { load: deps.load, peek: deps.peek, invalidate: deps.invalidate },
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

describe('stock card controller', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the card html through the injected text', () => {
    const { controller } = createHarness()

    const html = controller.renderHtml({ title: '我的股票' })

    expect(html).toContain('我的股票')
    expect(html).toContain(TEXT.loading)
  })

  it('writes the empty state when the card has no symbols', async () => {
    const { controller, deps } = createHarness()
    deps.dom.cardEl.dataset.stockRenderToken = 'token-1'

    await controller.loadData({ id: 'stock-1', type: 'stock', symbols: [] }, { cardEl: deps.dom.cardEl, renderToken: 'token-1' })

    expect(deps.load).not.toHaveBeenCalled()
    expect(deps.dom.cardList.innerHTML).toContain(TEXT.empty)
  })

  it('loads quotes into the card and reports failures as an error state', async () => {
    const { controller, deps } = createHarness()

    const card = { id: 'stock-1', type: 'stock', symbols: ['600000'] }
    deps.dom.cardEl.dataset.stockRenderToken = 'token-1'
    await controller.loadData(card, { cardEl: deps.dom.cardEl, renderToken: 'token-1' })

    expect(deps.load).toHaveBeenCalledWith('stock-1', ['600000'], { forceRefresh: false })
    expect(deps.dom.cardList.innerHTML).toContain('ACME')

    deps.load.mockRejectedValueOnce(new Error('boom'))
    await controller.loadData(card, { cardEl: deps.dom.cardEl, renderToken: 'token-1' })

    expect(deps.dom.cardList.innerHTML).toContain(TEXT.error)
  })

  it('ignores refresh for other card types and re-renders when the element is gone', async () => {
    const card = { id: 'stock-1', type: 'stock', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })

    await controller.refresh('unknown')
    expect(deps.invalidate).not.toHaveBeenCalled()

    await controller.refresh('stock-1')

    expect(deps.invalidate).toHaveBeenCalledWith('stock-1')
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('forces a reload when the card element is mounted', async () => {
    const card = { id: 'stock-1', type: 'stock', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    deps.dom.cardEl.dataset.stockRenderToken = 'token-1'

    await controller.refresh('stock-1')

    expect(deps.invalidate).toHaveBeenCalledWith('stock-1')
    expect(deps.load).toHaveBeenCalledWith('stock-1', ['600000'], { forceRefresh: true })
  })

  it('routes refresh clicks, symbol clicks and plain clicks', async () => {
    const card = { id: 'stock-1', type: 'stock', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    deps.dom.cardEl.dataset.stockRenderToken = 'token-1'

    const refreshEvt = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { closest: (selector) => (selector === '[data-stock-action]' ? { dataset: { stockAction: 'refresh' } } : null) }
    }
    await controller.handleClick(card, refreshEvt)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(refreshEvt.preventDefault).toHaveBeenCalledOnce()

    const symbolEvt = {
      target: {
        closest: (selector) =>
          selector === '[data-stock-symbol]' ? { dataset: { stockSymbol: '600000' } } : null
      }
    }
    await controller.handleClick(card, symbolEvt)
    expect(deps.openUrl).toHaveBeenCalledWith('https://gu.qq.com/sh600000')

    await controller.handleClick(card, { target: { closest: () => null } })
    expect(deps.dom.overlay.hidden).toBe(false)
  })

  it('opens the edit modal with the card title and cached quotes', () => {
    const card = { id: 'stock-1', type: 'stock', title: '我的股票', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })

    controller.openModal({ mode: 'edit', cardId: 'stock-1' })

    expect(deps.dom.title.textContent).toBe('股票设置')
    expect(deps.dom.titleInput.value).toBe('我的股票')
    expect(deps.dom.symbolInput.value).toBe('')
    expect(deps.dom.list.innerHTML).toContain('ACME')
    expect(deps.peek).toHaveBeenCalledWith('stock-1')
    expect(deps.closeOverlays).toHaveBeenCalledOnce()
  })

  it('creates a card from the create modal', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.titleInput.value = '自选股'
    deps.dom.symbolInput.value = '600000, aapl'

    await deps.dom.form.fire('submit')

    expect(deps.persist).toHaveBeenCalledOnce()
    expect(deps.persist.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'stock', title: '自选股', symbols: ['600000'] })
    ])
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('rejects an empty symbol on create', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.symbolInput.value = '  '

    await deps.dom.form.fire('submit')

    expect(deps.setError).toHaveBeenCalledWith('请输入股票代码')
    expect(deps.persist).not.toHaveBeenCalled()
    expect(deps.dom.overlay.hidden).toBe(false)
  })

  it('persists a title only edit and drops the quote cache', async () => {
    const card = { id: 'stock-1', type: 'stock', title: '旧标题', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'stock-1' })
    deps.dom.titleInput.value = '新标题'

    await deps.dom.form.fire('submit')

    expect(deps.persist.mock.calls[0][0][0]).toMatchObject({ id: 'stock-1', title: '新标题', symbols: ['600000'] })
    expect(deps.invalidate).toHaveBeenCalledWith('stock-1')
    expect(deps.setError).toHaveBeenCalledWith('')
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('prepends a new symbol when editing', async () => {
    const card = { id: 'stock-1', type: 'stock', title: '自选', symbols: ['600000'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'stock-1' })
    deps.dom.symbolInput.value = 'aapl'

    await deps.dom.form.fire('submit')

    expect(deps.persist.mock.calls[0][0][0].symbols).toEqual(['AAPL', '600000'])
  })

  it('replaces the symbol picked from the list', async () => {
    const card = { id: 'stock-1', type: 'stock', title: '自选', symbols: ['600000', '300750'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'stock-1' })

    // 点列表里的第二个代码，把它替换成新代码。
    await deps.dom.list.fire('click', { target: { closest: (selector) => (selector === '.stock-list-item' ? { getAttribute: () => '300750' } : null) } })
    expect(deps.dom.symbolInput.value).toBe('300750')

    deps.dom.symbolInput.value = 'AAPL'
    await deps.dom.form.fire('submit')

    expect(deps.persist.mock.calls[0][0][0].symbols).toEqual(['600000', 'AAPL'])
  })

  it('deletes a symbol after confirmation', async () => {
    const card = { id: 'stock-1', type: 'stock', title: '自选', symbols: ['600000', '300750'] }
    const { controller, deps } = createHarness({ seedCards: [card] })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'stock-1' })

    await deps.dom.list.fire('click', {
      target: { closest: (selector) => (selector === 'button[data-action="delete"]' ? { getAttribute: () => '300750' } : null) }
    })

    expect(deps.confirm).toHaveBeenCalledOnce()
    const { title, text, onConfirm } = deps.confirm.mock.calls[0][0]
    expect(title).toBe('确认删除')
    expect(text).toContain('300750')

    await onConfirm()

    expect(deps.persist.mock.calls[0][0][0].symbols).toEqual(['600000'])
    expect(deps.invalidate).toHaveBeenCalledWith('stock-1')
    expect(deps.dom.list.innerHTML).not.toContain('300750')
  })

  it('closes the modal from the overlay, the close and the cancel buttons', () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()

    controller.openModal({ mode: 'create' })
    deps.dom.overlay.fire('click', { target: deps.dom.overlay })
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    deps.dom.overlay.fire('click', { target: deps.dom.symbolInput })
    expect(deps.dom.overlay.hidden).toBe(false)

    deps.dom.closeBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    deps.dom.cancelBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('queries only modal elements that exist in newtab.html', async () => {
    // 控制器按 id 取元素，页面改 id 时必须同步改控制器，避免弹窗静默失效。
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../stock-card-controller.js', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')
    const ids = [...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(([, id]) => id)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of new Set(ids)) expect(html).toContain(`id="${id}"`)
  })
})
