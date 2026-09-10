import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHotCardController } from '../hot-card-controller.js'

const LIST_SELECTOR = '[data-hot-list]'

const ITEMS = [
  { title: '一号热搜', link: 'https://example.com/1' },
  { title: '二号热搜', link: 'https://example.com/2' }
]

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
      focus: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: null, ...event })
    }
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: createEl('#hotOverlay'),
    title: createEl('#hotModalTitle'),
    select: createEl('#hotSourceSelect'),
    form: createEl('#hotForm'),
    closeBtn: createEl('#hotCloseBtn'),
    cancelBtn: createEl('#hotCancelBtn'),
    list: createEl(LIST_SELECTOR)
  }
  dom.querySelector = vi.fn((selector) => elements.get(selector) || null)
  // 卡片元素内部的列表区，供控制器写入热搜条目；同时注册到元素表供刷新时按选择器取回。
  dom.cardEl = { dataset: {}, querySelector: (selector) => (selector === LIST_SELECTOR ? dom.list : null) }
  elements.set('.card[data-card-id="hot-1"]', dom.cardEl)

  return dom
}

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
    openUrl: vi.fn(async () => {}),
    closeOverlays: vi.fn(),
    load: vi.fn(async () => ITEMS),
    invalidate: vi.fn(async () => {}),
    ...overrides
  }
  let scheduled = null

  const controller = createHotCardController({
    getLang: () => 'zh',
    runWhenIdle: (task) => {
      scheduled = task()
    },
    openUrl: deps.openUrl,
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

describe('hot card controller', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the source title escaped and the loading placeholder', () => {
    const { controller } = createHarness()

    const html = controller.renderHtml({ title: '<知乎>' })

    expect(html).toContain('&lt;知乎&gt;')
    expect(html).not.toContain('<知乎>')
    expect(html).toContain('加载中...')
  })

  it('loads by source on mount and renders the ranked list', async () => {
    const { controller, deps, scheduledTask } = createHarness()

    controller.initialize({ sourceTitle: '知乎' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.load).toHaveBeenCalledWith('知乎', { forceRefresh: false })
    expect(deps.dom.list.innerHTML).toContain('一号热搜')
    expect(deps.dom.list.innerHTML).toContain('hot-rank-2')
    expect(deps.dom.list.innerHTML).toContain('https://example.com/2')
  })

  it('falls back to the default source when the card has none', async () => {
    const { controller, deps, scheduledTask } = createHarness()

    controller.initialize({ title: '' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.load).toHaveBeenCalledWith('知乎', { forceRefresh: false })
  })

  it('shows the error state when the request fails', async () => {
    const { controller, deps, scheduledTask } = createHarness({
      load: vi.fn(async () => { throw new Error('boom') })
    })

    controller.initialize({ sourceTitle: '知乎' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.dom.list.innerHTML).toContain('加载失败，点击刷新重试')
  })

  it('shows the empty state when the list is empty', async () => {
    const { controller, deps, scheduledTask } = createHarness({ load: vi.fn(async () => []) })

    controller.initialize({ sourceTitle: '知乎' }, deps.dom.cardEl)
    await scheduledTask()

    expect(deps.dom.list.innerHTML).toContain('暂无数据')
  })

  it('ignores a card that is not a hot card', async () => {
    const { controller, deps } = createHarness()

    await controller.refresh('unknown-card')

    expect(deps.apply).not.toHaveBeenCalled()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('re-renders when the card element is missing', async () => {
    const card = { id: 'hot-1', type: 'hot', sourceTitle: '知乎' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })

    await controller.refresh('hot-1')

    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('refreshes a mounted card with forceRefresh', async () => {
    const card = { id: 'hot-1', type: 'hot', sourceTitle: '百度' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })
    deps.dom.cardEl.dataset.hotRenderToken = 'token-1'

    await controller.refresh('hot-1')

    expect(deps.load).toHaveBeenCalledWith('百度', { forceRefresh: true })
  })

  it('opens the edit modal with the current source and closes other overlays', () => {
    const card = { id: 'hot-1', type: 'hot', sourceTitle: '微博热搜' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })

    controller.openModal({ mode: 'edit', cardId: 'hot-1' })

    expect(deps.dom.title.textContent).toBe('热搜设置')
    expect(deps.dom.select.value).toBe('微博热搜')
    expect(deps.dom.overlay.hidden).toBe(false)
    expect(deps.closeOverlays).toHaveBeenCalledOnce()
  })

  it('falls back to the default source when the stored one is unknown', () => {
    const card = { id: 'hot-1', type: 'hot', sourceTitle: '不存在的来源' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })

    controller.openModal({ mode: 'edit', cardId: 'hot-1' })

    expect(deps.dom.select.value).toBe('知乎')
  })

  it('adds a card from the create modal and closes it', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.select.value = '哔哩哔哩'

    await deps.dom.form.fire('submit')

    expect(deps.persist).toHaveBeenCalledOnce()
    const next = deps.persist.mock.calls[0][0]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ type: 'hot', title: '哔哩哔哩', sourceTitle: '哔哩哔哩' })
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('sanitizes an unknown source on submit', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    deps.dom.select.value = '野来源'

    await deps.dom.form.fire('submit')

    expect(deps.persist.mock.calls[0][0][0]).toMatchObject({ title: '知乎', sourceTitle: '知乎' })
  })

  it('patches the source and invalidates the previous cache in edit mode', async () => {
    const previous = { id: 'hot-1', type: 'hot', title: '知乎', sourceTitle: '知乎' }
    const { controller, deps } = createHarness({ list: vi.fn(() => [previous]), getById: vi.fn(() => previous) })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'hot-1' })
    deps.dom.select.value = '少数派'

    await deps.dom.form.fire('submit')

    expect(deps.invalidate).toHaveBeenCalledWith('知乎')
    expect(deps.persist.mock.calls[0][0][0]).toMatchObject({ id: 'hot-1', title: '少数派', sourceTitle: '少数派' })
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('does not patch a card that disappeared', async () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', cardId: 'gone' })
    deps.dom.select.value = '百度'

    await deps.dom.form.fire('submit')

    expect(deps.persist).not.toHaveBeenCalled()
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('routes refresh clicks to the client, item clicks to the tab API and plain clicks to the modal', async () => {
    const card = { id: 'hot-1', type: 'hot', sourceTitle: '知乎' }
    const { controller, deps } = createHarness({ getById: vi.fn(() => card) })
    deps.dom.cardEl.dataset.hotRenderToken = 'token-1'

    const refreshEvt = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { closest: (selector) => (selector === '[data-hot-action]' ? { dataset: { hotAction: 'refresh' } } : null) }
    }
    await controller.handleClick(card, refreshEvt)
    expect(deps.load).toHaveBeenCalledOnce()
    expect(refreshEvt.preventDefault).toHaveBeenCalledOnce()

    const linkEvt = { target: { closest: (selector) => (selector === '[data-hot-link]' ? { dataset: { hotLink: 'https://example.com/1' } } : null) } }
    await controller.handleClick(card, linkEvt)
    expect(deps.openUrl).toHaveBeenCalledWith('https://example.com/1')

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
    deps.dom.overlay.fire('click', { target: deps.dom.select })
    expect(deps.dom.overlay.hidden).toBe(false)

    deps.dom.closeBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    deps.dom.cancelBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('queries only modal elements that exist in newtab.html', () => {
    // 控制器按 id 取元素，页面改 id 时必须同步改控制器，避免弹窗静默失效。
    const source = readFileSync(new URL('../hot-card-controller.js', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')
    const ids = [...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(([, id]) => id)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of new Set(ids)) expect(html).toContain(`id="${id}"`)
  })
})
