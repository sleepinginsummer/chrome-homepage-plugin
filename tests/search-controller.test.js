import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeSearchUrls, createSearchController } from '../search-controller.js'

const ENGINES = [
  { name: 'GOOGLE', baseUrl: 'https://google.test/?q=' },
  { name: 'BING', baseUrl: 'https://bing.test/?q=' },
  { name: 'BAIDU', baseUrl: 'https://baidu.test/s?wd=' }
]

const createFakeElement = (tag = 'div') => {
  const listeners = new Map()
  const children = []
  const el = {
    tagName: tag,
    className: '',
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    dataset: {},
    style: {},
    clientHeight: 200,
    scrollTop: 0,
    children,
    append: (...nodes) => children.push(...nodes),
    appendChild: (node) => {
      children.push(node)
      return node
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    scrollTo: vi.fn(),
    querySelector: (selector) => (selector === '.history-text' ? { textContent: '' } : null),
    classList: {
      toggle: vi.fn()
    },
    fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: el, ...event })
  }
  return el
}

/**
 * 构造搜索面板 DOM 桩：只实现控制器用到的那几个选择器。
 */
const createDom = () => {
  const elements = new Map([
    ['#engineSelection', createFakeElement()],
    ['#historyItems', createFakeElement()],
    ['#historySidebar', createFakeElement()],
    ['#historyFooter', createFakeElement()],
    ['#historyList', createFakeElement('ul')],
    ['#clearHistoryBtn', createFakeElement('button')],
    ['#searchForm', createFakeElement('form')],
    ['#keywordInput', createFakeElement('input')]
  ])
  let rendered = []

  return {
    elements,
    get rendered() {
      return rendered
    },
    setRendered: (items) => {
      rendered = items
    },
    root: {
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: (selector) => (selector === '.history-item' ? rendered : []),
      createElement: createFakeElement
    }
  }
}

const createHarness = ({ config = {}, openResult = { ok: true }, saveError = null } = {}) => {
  const dom = createDom()
  const errors = []
  const persisted = []
  let current = { engines: ENGINES, selectedEngines: ['GOOGLE', 'BING'], searchHistory: [], ...config }

  const send = vi.fn(async (message) => {
    if (message.type === 'addSearchHistory') {
      current = { ...current, searchHistory: [message.keyword, ...current.searchHistory] }
      return { ok: true, data: current }
    }
    return openResult
  })

  const controller = createSearchController({
    getConfig: () => current,
    applyConfig: (next) => {
      current = next
    },
    saveConfig: vi.fn(async (patch) => {
      if (saveError) throw saveError
      persisted.push(patch)
      current = { ...current, ...patch }
    }),
    send,
    setError: (message) => errors.push(message),
    afterConfigChange: vi.fn(),
    root: dom.root
  })

  return { controller, dom, send, errors, persisted, getConfig: () => current }
}

describe('computeSearchUrls', () => {
  it('keeps engine order and encodes the keyword', () => {
    expect(computeSearchUrls(ENGINES, 'a b', ['BAIDU', 'GOOGLE'])).toEqual([
      'https://google.test/?q=a%20b',
      'https://baidu.test/s?wd=a%20b'
    ])
  })

  it('returns an empty list without selection or engines', () => {
    expect(computeSearchUrls(ENGINES, 'x', [])).toEqual([])
    expect(computeSearchUrls(undefined, 'x', ['GOOGLE'])).toEqual([])
  })
})

describe('search controller engines', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one checkbox per engine and marks the selected ones', () => {
    const { controller, dom } = createHarness()

    controller.renderEngines()

    const container = dom.elements.get('#engineSelection')
    expect(container.children).toHaveLength(3)

    const [google, , baidu] = container.children
    expect(google.children[0]).toMatchObject({ type: 'checkbox', value: 'GOOGLE', checked: true })
    expect(google.children[2].textContent).toBe('GOOGLE')
    expect(baidu.children[0].checked).toBe(false)
  })

  it('persists the engine selection and schedules auto push', async () => {
    const { controller, dom, persisted } = createHarness()
    controller.renderEngines()

    const [google] = dom.elements.get('#engineSelection').children
    const input = google.children[0]
    input.checked = false
    // 监听挂在 input 上，不是 label。
    await input.fire('change')

    expect(persisted).toEqual([{ selectedEngines: ['BING'] }])
  })
})

describe('search controller history', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders history items and toggles the sidebar state', () => {
    const { controller, dom } = createHarness({ config: { searchHistory: ['一', '二'] } })

    controller.renderHistory()

    const items = dom.elements.get('#historyItems').children
    expect(items).toHaveLength(2)
    expect(items[0].className).toBe('history-item')
    expect(items[0].dataset.index).toBe('0')
    expect(dom.elements.get('#historySidebar').classList.toggle).toHaveBeenCalledWith('has-items', true)
    expect(dom.elements.get('#historyFooter').hidden).toBe(false)
  })

  it('hides the footer when history is empty', () => {
    const { controller, dom } = createHarness()

    controller.renderHistory()

    expect(dom.elements.get('#historyFooter').hidden).toBe(true)
  })

  it('searches from a history item without adding it again', async () => {
    const { controller, dom, send } = createHarness({ config: { searchHistory: ['天气'] } })
    controller.renderHistory()

    const [item] = dom.elements.get('#historyItems').children
    await item.fire('click')

    expect(dom.elements.get('#keywordInput').value).toBe('天气')
    expect(send.mock.calls.map(([message]) => message.type)).toEqual(['openTabs'])
  })

  it('clears history from the footer button', async () => {
    const { controller, dom, persisted } = createHarness({ config: { searchHistory: ['一'] } })
    controller.bindHistoryUi()

    await dom.elements.get('#clearHistoryBtn').fire('click')

    expect(persisted).toEqual([{ searchHistory: [] }])
    expect(dom.elements.get('#historyItems').children).toHaveLength(0)
  })

  it('reports a clear failure through the page error slot', async () => {
    const { controller, dom, errors, persisted } = createHarness({ saveError: new Error('存储不可用') })
    controller.bindHistoryUi()

    await dom.elements.get('#clearHistoryBtn').fire('click')

    expect(errors.at(-1)).toBe('存储不可用')
    expect(persisted).toEqual([])
  })

  it('updates item transforms on scroll', () => {
    const { controller, dom } = createHarness({ config: { searchHistory: ['一', '二'] } })
    controller.renderHistory()
    dom.setRendered(dom.elements.get('#historyItems').children.map((child) => ({ ...child, style: {} })))

    controller.bindHistoryUi()
    dom.elements.get('#historyList').fire('scroll')

    expect(dom.rendered[0].style.transform).toContain('scale(')
  })
})

describe('search controller form', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds to history before opening tabs on submit', async () => {
    const { controller, dom, send } = createHarness()
    controller.bindSearchForm()
    dom.elements.get('#keywordInput').value = '关键词'

    await dom.elements.get('#searchForm').fire('submit')

    expect(send.mock.calls.map(([message]) => message.type)).toEqual(['addSearchHistory', 'openTabs'])
  })

  it('clears the input on Escape', () => {
    const { controller, dom, errors } = createHarness()
    controller.bindSearchForm()
    const input = dom.elements.get('#keywordInput')
    input.value = '待清空'

    input.fire('keydown', { key: 'Escape' })

    expect(input.value).toBe('')
    expect(errors.at(-1)).toBe('')
  })
})
