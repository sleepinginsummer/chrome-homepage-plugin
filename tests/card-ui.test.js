import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCardUi } from '../card-ui.js'

const OVERLAY_IDS = ['#cardMenu', '#confirmOverlay', '#addChooserOverlay', '#componentListOverlay', '#cardModalOverlay', '#anniversaryOverlay', '#hotOverlay', '#stockOverlay']

const createEl = (selector) => {
  const listeners = new Map()
  const el = {
    selector,
    hidden: OVERLAY_IDS.includes(selector),
    textContent: '',
    style: {},
    disabled: false,
    dataset: {},
    contains: vi.fn(() => false),
    getBoundingClientRect: () => ({ width: 120, height: 80 }),
    addEventListener: (type, listener) => listeners.set(type, listener),
    fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: el, ...event })
  }
  return el
}

const createDom = () => {
  const elements = new Map()
  const register = (selector) => {
    const el = createEl(selector)
    elements.set(selector, el)
    return el
  }

  const dom = {
    menu: register('#cardMenu'),
    menuEdit: register('#cardMenuEditBtn'),
    menuDelete: register('#cardMenuDeleteBtn'),
    confirmOverlay: register('#confirmOverlay'),
    confirmTitle: register('#confirmTitle'),
    confirmText: register('#confirmText'),
    confirmClose: register('#confirmCloseBtn'),
    confirmCancel: register('#confirmCancelBtn'),
    confirmOk: register('#confirmOkBtn'),
    addChooser: register('#addChooserOverlay'),
    addChooserClose: register('#addChooserCloseBtn'),
    addChooserCard: register('#addChooserCardBtn'),
    addChooserComponent: register('#addChooserComponentBtn'),
    componentList: register('#componentListOverlay'),
    componentListClose: register('#componentListCloseBtn')
  }
  for (const id of ['#componentHotBtn', '#componentStockBtn', '#componentMetalsBtn', '#componentAnniversaryBtn', '#componentWeatherBtn']) {
    register(id)
  }
  for (const id of ['#cardModalOverlay', '#anniversaryOverlay', '#hotOverlay', '#stockOverlay']) register(id)

  const rootListeners = new Map()
  return {
    dom,
    elements,
    root: {
      querySelector: (selector) => elements.get(selector) || null,
      addEventListener: (type, listener) => rootListeners.set(type, listener),
      fireRoot: (type, event = {}) => rootListeners.get(type)?.({ preventDefault: vi.fn(), ...event })
    }
  }
}

const createDomain = () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  addComponent: vi.fn(async () => {}),
  bindModalUi: vi.fn()
})

const createHarness = ({ card = { id: 'c1', title: '标题', url: 'https://a.test' } } = {}) => {
  const { dom, elements, root } = createDom()
  const domains = {
    link: createDomain(),
    weather: createDomain(),
    hot: createDomain(),
    stock: createDomain(),
    metals: createDomain(),
    anniversary: createDomain()
  }
  const onDeleteCard = vi.fn(async () => {})
  const setError = vi.fn()

  const ui = createCardUi({
    getCardById: (id) => (id === card.id ? card : null),
    onDeleteCard,
    setError,
    domains,
    root
  })

  return { ui, dom, elements, domains, onDeleteCard, setError, card, root }
}

describe('card ui menu', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (task) => task())
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the menu and clamps the position to the viewport', () => {
    const { ui, dom } = createHarness()

    ui.openMenu({ x: 900, y: 900, cardId: 'c1' })

    expect(dom.menu.hidden).toBe(false)
    expect(dom.menu.style.left).toBe('672px') // 800 - 120 - 8
    expect(dom.menu.style.top).toBe('512px') // 600 - 80 - 8
  })

  it('closes on an outside click but keeps clicks inside', () => {
    const { ui, dom, root } = createHarness()
    ui.init()
    ui.openMenu({ x: 10, y: 10, cardId: 'c1' })

    dom.menu.contains.mockReturnValueOnce(true)
    root.fireRoot('click', { target: dom.menu })
    expect(dom.menu.hidden).toBe(false)

    dom.menu.contains.mockReturnValueOnce(false)
    root.fireRoot('click', { target: {} })
    expect(dom.menu.hidden).toBe(true)
  })

  it('dispatches the edit action by card type', () => {
    // 链接卡片：直接带 card 对象打开
    const linkCase = createHarness()
    linkCase.ui.init()
    linkCase.ui.openMenu({ x: 0, y: 0, cardId: linkCase.card.id })
    linkCase.dom.menuEdit.fire('click')
    expect(linkCase.domains.link.openModal).toHaveBeenCalledWith({ mode: 'edit', card: linkCase.card })

    // 其余域：按 cardId 打开
    for (const type of ['weather', 'hot', 'stock']) {
      const typed = { id: 'c1', type, title: '标题' }
      const { ui, dom, domains } = createHarness({ card: typed })
      ui.init()
      ui.openMenu({ x: 0, y: 0, cardId: typed.id })
      dom.menuEdit.fire('click')

      expect(domains[type].openModal).toHaveBeenCalledWith({ mode: 'edit', cardId: 'c1' })
      expect(domains.link.openModal).not.toHaveBeenCalled()
    }

    // 贵金属没有配置弹窗：只收起菜单
    const metals = createHarness({ card: { id: 'c1', type: 'metals' } })
    metals.ui.init()
    metals.ui.openMenu({ x: 0, y: 0, cardId: 'c1' })
    metals.dom.menuEdit.fire('click')
    expect(metals.dom.menu.hidden).toBe(true)
    expect(metals.domains.metals.openModal).not.toHaveBeenCalled()
  })

  it('asks for confirmation before deleting and closes the menu first', async () => {
    const { ui, dom, onDeleteCard, card } = createHarness()
    ui.init()
    ui.openMenu({ x: 0, y: 0, cardId: card.id })

    dom.menuDelete.fire('click')

    expect(dom.menu.hidden).toBe(true)
    expect(dom.confirmOverlay.hidden).toBe(false)
    expect(dom.confirmText.textContent).toContain('标题')

    await dom.confirmOk.fire('click')
    expect(onDeleteCard).toHaveBeenCalledWith('c1')
    expect(dom.confirmOverlay.hidden).toBe(true)
  })

  it('closes the menu when the card is gone', () => {
    const { ui, dom } = createHarness()
    ui.init()
    ui.openMenu({ x: 0, y: 0, cardId: 'missing' })

    dom.menuEdit.fire('click')

    expect(dom.menu.hidden).toBe(true)
  })
})

describe('card ui dialogs', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (task) => task())
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes the confirm dialog from overlay, close and cancel', () => {
    const { ui, dom } = createHarness()
    ui.init()

    ui.openConfirm({ title: 't', text: 'x', onConfirm: vi.fn() })
    dom.confirmOverlay.fire('click', { target: dom.confirmOverlay })
    expect(dom.confirmOverlay.hidden).toBe(true)

    ui.openConfirm({ title: 't', text: 'x', onConfirm: vi.fn() })
    dom.confirmClose.fire('click')
    expect(dom.confirmOverlay.hidden).toBe(true)

    ui.openConfirm({ title: 't', text: 'x', onConfirm: vi.fn() })
    dom.confirmCancel.fire('click')
    expect(dom.confirmOverlay.hidden).toBe(true)
  })

  it('opens the add chooser, clears the error and goes to the link modal', () => {
    const { ui, dom, domains, setError } = createHarness()
    ui.init()

    ui.openAddChooser()
    expect(dom.addChooser.hidden).toBe(false)
    expect(setError).toHaveBeenCalledWith('')

    dom.addChooserCard.fire('click')
    expect(dom.addChooser.hidden).toBe(true)
    expect(domains.link.openModal).toHaveBeenCalledWith({ mode: 'create' })
  })

  it('moves from the chooser to the component list and back', () => {
    const { ui, dom } = createHarness()
    ui.init()

    ui.openAddChooser()
    dom.addChooserComponent.fire('click')
    expect(dom.addChooser.hidden).toBe(true)
    expect(dom.componentList.hidden).toBe(false)

    dom.componentListClose.fire('click')
    expect(dom.componentList.hidden).toBe(true)

    // 组件列表内部的点击不会关闭它
    ui.openComponentList()
    dom.componentList.fire('click', { target: dom.componentList.menu ?? {} })
    expect(dom.componentList.hidden).toBe(false)
  })

  it('wires every component button to its domain', async () => {
    const { ui, dom, domains, elements } = createHarness()
    ui.init()

    await elements.get('#componentHotBtn').fire('click')
    await elements.get('#componentStockBtn').fire('click')
    await elements.get('#componentWeatherBtn').fire('click')
    await elements.get('#componentMetalsBtn').fire('click')
    await elements.get('#componentAnniversaryBtn').fire('click')

    expect(domains.hot.openModal).toHaveBeenCalledWith({ mode: 'create' })
    expect(domains.stock.openModal).toHaveBeenCalledWith({ mode: 'create' })
    expect(domains.weather.openModal).toHaveBeenCalledWith({ mode: 'create' })
    expect(domains.metals.addComponent).toHaveBeenCalledOnce()
    expect(domains.anniversary.addComponent).toHaveBeenCalledOnce()
    // 组件按钮点击后组件列表要先收起
    expect(dom.componentList.hidden).toBe(true)
  })

  it('binds every domain modal once, and only those that have one', () => {
    const { ui, domains } = createHarness()

    ui.init()

    // 贵金属没有配置弹窗，其余五个域各绑定一次。
    for (const type of ['link', 'weather', 'hot', 'stock', 'anniversary']) {
      expect(domains[type].bindModalUi).toHaveBeenCalledOnce()
    }
    expect(domains.metals.bindModalUi).not.toHaveBeenCalled()
  })

  it('closes overlays on Escape in priority order', () => {
    const { ui, dom, domains, elements, root } = createHarness()
    ui.init()

    ui.openMenu({ x: 0, y: 0, cardId: 'c1' })
    root.fireRoot('keydown', { key: 'Escape' })
    expect(dom.menu.hidden).toBe(true)

    ui.openConfirm({ title: 't', text: 'x', onConfirm: vi.fn() })
    root.fireRoot('keydown', { key: 'Escape' })
    expect(dom.confirmOverlay.hidden).toBe(true)

    // 每次只让一个域弹窗处于打开状态（真实控制器会自己把 overlay 关掉，mock 不会）。
    const escapeOnce = (selector, domain, expectedSelector) => {
      elements.get(selector).hidden = false
      root.fireRoot('keydown', { key: 'Escape' })
      elements.get(selector).hidden = true
      expect(domain.closeModal).toHaveBeenCalledOnce()
      expect(elements.get(expectedSelector)).toBeTruthy()
    }
    escapeOnce('#cardModalOverlay', domains.link, '#cardModalOverlay')
    escapeOnce('#anniversaryOverlay', domains.anniversary, '#anniversaryOverlay')
    escapeOnce('#hotOverlay', domains.hot, '#hotOverlay')
    escapeOnce('#stockOverlay', domains.stock, '#stockOverlay')

    ui.openComponentList()
    root.fireRoot('keydown', { key: 'Escape' })
    expect(dom.componentList.hidden).toBe(true)

    ui.openAddChooser()
    root.fireRoot('keydown', { key: 'Escape' })
    expect(dom.addChooser.hidden).toBe(true)
  })
})
