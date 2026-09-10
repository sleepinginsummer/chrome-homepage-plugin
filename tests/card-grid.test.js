import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCardGrid } from '../card-grid.js'

const createElement = (tag = 'div') => {
  const listeners = new Map()
  const children = []
  const el = {
    tagName: tag,
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    children,
    appendChild: (node) => {
      children.push(node)
      return node
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: el, ...event })
  }
  return el
}

const createHarness = ({ seedCards = [], registry, ...overrides } = {}) => {
  const container = createElement()
  const store = [...seedCards]
  let dragOptions = null

  const cards = {
    list: vi.fn(() => store),
    getById: vi.fn((id) => store.find((card) => card.id === id) || null),
    persist: vi.fn(async (next) => {
      store.length = 0
      store.push(...next)
    }),
    apply: vi.fn(),
    schedulePush: vi.fn(),
    ...overrides.cards
  }

  const grid = createCardGrid({
    cards,
    registry,
    openUrl: overrides.openUrl ?? vi.fn(async () => {}),
    onContextMenu: overrides.onContextMenu ?? vi.fn(),
    onAddCard: overrides.onAddCard ?? vi.fn(),
    onDragError: overrides.onDragError ?? vi.fn(),
    root: {
      querySelector: (selector) => (selector === '#cardsGrid' ? container : null),
      createElement
    },
    createDragController: (options) => {
      dragOptions = options
      return { cancel: vi.fn() }
    }
  })

  return { grid, cards, container, store, dragOptions: () => dragOptions }
}

const LINK_CARD = { id: 'c1', title: 'A', url: 'https://example.com' }
const WEATHER_CARD = { id: 'c2', type: 'weather', city: '南京' }

describe('card grid rendering', () => {
  it('renders every card through its registry entry plus the add button', () => {
    const renderCard = vi.fn((card, div) => {
      div.innerHTML = `title:${card.title}`
    })
    const { grid, container } = createHarness({
      seedCards: [LINK_CARD],
      registry: { link: { className: 'card', render: renderCard } }
    })

    grid.render()

    expect(renderCard).toHaveBeenCalledWith(LINK_CARD, expect.anything())
    const [cardEl, addBtn] = container.children
    expect(cardEl.className).toBe('card')
    expect(cardEl.innerHTML).toBe('title:A')
    expect(cardEl.dataset.cardId).toBe('c1')
    expect(cardEl.draggable).toBe(true)
    expect(addBtn.className).toBe('card card-add')
  })

  it('uses the type className and falls back to link for unknown types', () => {
    const { grid, container } = createHarness({
      seedCards: [WEATHER_CARD, { id: 'c3', type: 'unknown' }],
      registry: {
        weather: { className: 'card card-weather', render: () => {} },
        link: { className: 'card', render: () => {} }
      }
    })

    grid.render()

    expect(container.children[0].className).toBe('card card-weather')
    expect(container.children[1].className).toBe('card')
  })

  it('opens the add chooser from the add button', () => {
    const onAddCard = vi.fn()
    const { grid, container } = createHarness({ registry: { link: { render: () => {} } }, onAddCard })

    grid.render()
    container.children[0].fire('click')

    expect(onAddCard).toHaveBeenCalledOnce()
  })

  it('reports right clicks with the card id', () => {
    const onContextMenu = vi.fn()
    const { grid, container } = createHarness({
      seedCards: [LINK_CARD],
      registry: { link: { render: () => {} } },
      onContextMenu
    })

    grid.render()
    container.children[0].fire('contextmenu', { clientX: 12, clientY: 34 })

    expect(onContextMenu).toHaveBeenCalledWith({ x: 12, y: 34, cardId: 'c1' })
  })

  it('calls the previous render cleanup on the next render', () => {
    const cleanup = vi.fn()
    const { grid } = createHarness({
      seedCards: [LINK_CARD],
      registry: { link: { render: () => cleanup } }
    })

    grid.render()
    grid.render()

    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe('card grid interaction', () => {
  it('routes clicks to the registry handler, or opens the url for link cards', async () => {
    const openUrl = vi.fn(async () => {})
    const handleClick = vi.fn(async () => {})
    const { grid, container } = createHarness({
      seedCards: [LINK_CARD, WEATHER_CARD],
      registry: {
        link: { render: () => {} },
        weather: { render: () => {}, handleClick }
      },
      openUrl
    })

    grid.render()
    await container.children[0].fire('click')
    await container.children[1].fire('click')

    expect(openUrl).toHaveBeenCalledWith('https://example.com')
    expect(handleClick).toHaveBeenCalledOnce()
    expect(openUrl).toHaveBeenCalledTimes(1)
  })

  it('ignores clicks while dragging', async () => {
    const openUrl = vi.fn()
    const { grid, container, dragOptions } = createHarness({
      seedCards: [LINK_CARD],
      registry: { link: { render: () => {} } },
      openUrl
    })
    grid.initDrag()
    dragOptions().onDragStateChange(true)
    grid.render()

    await container.children[0].fire('click')

    expect(grid.isDragging()).toBe(true)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('persists the new order on drag commit without re-rendering', async () => {
    const second = { id: 'c2', title: 'B', url: 'https://b.test' }
    const { grid, cards, dragOptions } = createHarness({
      seedCards: [LINK_CARD, second],
      registry: { link: { render: () => {} } }
    })
    grid.initDrag()

    await dragOptions().onCommit(['c2', 'c1'])

    expect(cards.persist.mock.calls[0][0].map((card) => card.id)).toEqual(['c2', 'c1'])
    expect(cards.schedulePush).toHaveBeenCalledOnce()
    expect(cards.apply).not.toHaveBeenCalled()
  })

  it('skips persisting when the order did not change', async () => {
    const { grid, cards, dragOptions } = createHarness({
      seedCards: [LINK_CARD],
      registry: { link: { render: () => {} } }
    })
    grid.initDrag()

    await dragOptions().onCommit(['c1'])

    expect(cards.persist).not.toHaveBeenCalled()
  })

  it('deletes a card and cleans up its resources', async () => {
    const cleanup = vi.fn(async () => {})
    const { grid, cards } = createHarness({
      seedCards: [LINK_CARD, WEATHER_CARD],
      registry: {
        link: { render: () => {} },
        weather: { render: () => {}, cleanup }
      }
    })

    await grid.deleteCard('c2')

    expect(cards.persist.mock.calls[0][0].map((card) => card.id)).toEqual(['c1'])
    expect(cleanup).toHaveBeenCalledWith(WEATHER_CARD, expect.any(Array))
    expect(cards.schedulePush).toHaveBeenCalledOnce()
  })
})

describe('card grid polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads immediately, then on every interval until the next render', async () => {
    const loadData = vi.fn(async () => {})
    const { grid, container } = createHarness({
      seedCards: [WEATHER_CARD],
      registry: { weather: { render: () => {}, poll: { tokenDatasetKey: 'weatherRenderToken', loadData, intervalMs: 1000 } } }
    })

    grid.render()
    const cardEl = container.children[0]
    expect(loadData).toHaveBeenCalledTimes(1)
    expect(loadData.mock.calls[0][1]).toMatchObject({ cardEl, forceRefresh: true })
    expect(cardEl.dataset.weatherRenderToken).toBeTruthy()

    await vi.advanceTimersByTimeAsync(1000)
    expect(loadData).toHaveBeenCalledTimes(2)

    // 重渲染会清掉旧定时器并立刻拉一次
    grid.render()
    expect(loadData).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(loadData).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(loadData).toHaveBeenCalledTimes(4)
  })

  it('stops polling once the card disappears', async () => {
    const loadData = vi.fn(async () => {})
    const { grid, cards } = createHarness({
      seedCards: [WEATHER_CARD],
      registry: { weather: { render: () => {}, poll: { tokenDatasetKey: 'weatherRenderToken', loadData, intervalMs: 1000 } } }
    })
    grid.render()
    expect(loadData).toHaveBeenCalledTimes(1)

    cards.getById.mockReturnValue(null)
    await vi.advanceTimersByTimeAsync(1000)

    expect(loadData).toHaveBeenCalledTimes(1)
  })
})
