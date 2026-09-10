import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLinkCardController, normalizeIconUrl } from '../link-card-controller.js'

/** 卡片元素桩：只实现链接卡片渲染用到的几个节点。 */
const createCardElement = () => {
  const fallback = { textContent: '' }
  const image = { decoding: '', loading: '', onload: null, onerror: null, removeAttribute: vi.fn() }
  const icon = {
    classList: { toggle: vi.fn(), add: vi.fn() },
    querySelector: (selector) => (selector === '.card-icon-fallback' ? fallback : null)
  }
  const title = { textContent: '' }
  const el = {
    innerHTML: '',
    querySelector: (selector) => {
      if (selector === '.card-icon') return icon
      if (selector === '.card-icon-image') return image
      if (selector === '.card-title') return title
      return null
    }
  }
  return { el, icon, image, fallback, title }
}

const createDom = () => {
  const elements = new Map()
  const createEl = (selector) => {
    const listeners = new Map()
    const el = {
      hidden: true,
      textContent: '',
      value: '',
      addEventListener: (type, listener) => listeners.set(type, listener),
      focus: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: el, ...event })
    }
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: createEl('#cardModalOverlay'),
    title: createEl('#cardModalTitle'),
    titleInput: createEl('#cardModalTitleInput'),
    urlInput: createEl('#cardModalUrlInput'),
    iconInput: createEl('#cardModalIconInput'),
    form: createEl('#cardModalForm'),
    closeBtn: createEl('#cardModalCloseBtn'),
    cancelBtn: createEl('#cardModalCancelBtn')
  }
  dom.querySelector = (selector) => elements.get(selector) || null
  return dom
}

const createHarness = ({ seedCards = [], ...overrides } = {}) => {
  const dom = createDom()
  const store = [...seedCards]
  let seq = 0
  const deps = {
    persist: vi.fn(async (next) => {
      store.length = 0
      store.push(...next)
    }),
    apply: vi.fn(),
    setError: vi.fn(),
    closeOverlays: vi.fn(),
    ...overrides
  }

  const controller = createLinkCardController({
    cards: {
      list: () => store,
      persist: deps.persist,
      apply: deps.apply
    },
    setError: deps.setError,
    closeOverlays: deps.closeOverlays,
    root: { querySelector: dom.querySelector },
    newId: () => `id-${(seq += 1)}`
  })

  return { controller, dom, deps, store }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('link card icon url', () => {
  it.each([
    ['https://example.com/icon.png', 'https://example.com/icon.png'],
    ['  ', ''],
    ['ftp://example.com/icon.png', ''],
    ['not-a-url', '']
  ])('normalizeIconUrl(%s) === %s', (input, expected) => {
    expect(normalizeIconUrl(input)).toBe(expected)
  })
})

describe('link card render', () => {
  it('writes the shell, the title and the fallback initial', () => {
    const { controller } = createHarness()
    const { el, fallback, title } = createCardElement()

    const cancel = controller.render({ id: 'c1', title: 'github', url: 'https://github.com' }, el)

    expect(el.innerHTML).toContain('card-icon')
    expect(el.innerHTML).toContain('card-title')
    expect(fallback.textContent).toBe('G')
    expect(title.textContent).toBe('github')
    expect(typeof cancel).toBe('function')
    cancel()
  })
})

describe('link card modal', () => {
  it('prefills the form for edit and create', () => {
    const card = { id: 'c1', title: '标题', url: 'https://a.test', icon: 'https://a.test/i.png' }
    const { controller, dom, deps } = createHarness({ seedCards: [card] })

    controller.openModal({ mode: 'edit', card })
    expect(dom.overlay.hidden).toBe(false)
    expect(dom.title.textContent).toBe('修改卡片')
    expect(dom.titleInput.value).toBe('标题')
    expect(dom.urlInput.value).toBe('https://a.test')
    expect(dom.iconInput.value).toBe('https://a.test/i.png')
    expect(deps.closeOverlays).toHaveBeenCalledOnce()

    controller.closeModal()
    controller.openModal({ mode: 'create' })
    expect(dom.title.textContent).toBe('新增卡片')
    expect(dom.titleInput.value).toBe('')
  })

  it('validates title, url and icon before saving', async () => {
    const { controller, dom, deps, store } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })

    await dom.form.fire('submit')
    expect(deps.setError).toHaveBeenLastCalledWith('请输入标题')

    // normalizeCardUrl 会给裸域名补 https://，因此空地址才是非法分支。
    dom.titleInput.value = '标题'
    dom.urlInput.value = ''
    await dom.form.fire('submit')
    expect(deps.setError).toHaveBeenLastCalledWith('请输入合法网址')

    dom.urlInput.value = 'https://a.test'
    dom.iconInput.value = 'ftp://a.test/i.png'
    await dom.form.fire('submit')
    expect(deps.setError).toHaveBeenLastCalledWith('Icon 请输入合法 URL（http/https），或留空')

    expect(store).toHaveLength(0)
  })

  it('adds a card with a normalized url and closes the modal', async () => {
    const { controller, dom, deps, store } = createHarness()
    controller.bindModalUi()
    controller.openModal({ mode: 'create' })
    dom.titleInput.value = '  新卡片  '
    dom.urlInput.value = 'a.test'
    dom.iconInput.value = 'https://a.test/i.png'

    await dom.form.fire('submit')

    expect(store).toHaveLength(1)
    expect(store[0]).toMatchObject({ title: '新卡片', url: 'https://a.test', icon: 'https://a.test/i.png' })
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(dom.overlay.hidden).toBe(true)
  })

  it('updates an existing card and drops the icon when cleared', async () => {
    const card = { id: 'c1', title: '旧', url: 'https://a.test', icon: 'https://a.test/i.png' }
    const { controller, dom, store } = createHarness({ seedCards: [card] })
    controller.bindModalUi()
    controller.openModal({ mode: 'edit', card })
    dom.titleInput.value = '新'
    dom.iconInput.value = ''

    await dom.form.fire('submit')

    expect(store[0]).toMatchObject({ id: 'c1', title: '新', url: 'https://a.test' })
    expect(store[0].icon).toBeUndefined()
  })

  it('closes from the overlay, the close and the cancel buttons', () => {
    const { controller, dom } = createHarness()
    controller.bindModalUi()

    controller.openModal({ mode: 'create' })
    dom.overlay.fire('click', { target: dom.overlay })
    expect(dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    dom.overlay.fire('click', { target: dom.titleInput })
    expect(dom.overlay.hidden).toBe(false)

    dom.closeBtn.fire('click')
    expect(dom.overlay.hidden).toBe(true)

    controller.openModal({ mode: 'create' })
    dom.cancelBtn.fire('click')
    expect(dom.overlay.hidden).toBe(true)
  })

  it('queries only modal elements that exist in newtab.html', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../link-card-controller.js', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')
    const ids = [...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(([, id]) => id)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of new Set(ids)) expect(html).toContain(`id="${id}"`)
  })
})
