import { describe, expect, it, vi } from 'vitest'
import { createAnniversaryCardController } from '../anniversary-card-controller.js'

const LIST_SELECTOR = '#anniversaryList'

const inDays = (days) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 构造弹窗 DOM 桩：控制器只按 id 取元素。
 */
const createDom = () => {
  const elements = new Map()
  const createEl = (selector) => {
    const listeners = new Map()
    const el = {
      // 真实页面里弹窗初始都带 hidden 属性。
      hidden: true,
      textContent: '',
      value: '',
      innerHTML: '',
      dataset: {},
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      getAttribute: vi.fn((name) => el.attributes?.[name] ?? null),
      attributes: {},
      showPicker: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: null, ...event })
    }
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: createEl('#anniversaryOverlay'),
    closeBtn: createEl('#anniversaryCloseBtn'),
    cancelBtn: createEl('#anniversaryCancelBtn'),
    form: createEl('#anniversaryForm'),
    titleInput: createEl('#anniversaryTitleInput'),
    dateInput: createEl('#anniversaryDateInput'),
    list: createEl(LIST_SELECTOR)
  }
  dom.querySelector = vi.fn((selector) => elements.get(selector) || null)
  return dom
}

const createHarness = ({ seedCards = [], ...overrides } = {}) => {
  const dom = createDom()
  const store = [...seedCards]
  let seq = 0
  const deps = {
    dom,
    list: vi.fn(() => store),
    getById: vi.fn((id) => store.find((card) => card.id === id) || null),
    persist: vi.fn(async (next) => {
      store.length = 0
      store.push(...next)
    }),
    apply: vi.fn(),
    confirm: vi.fn(),
    setError: vi.fn(),
    closeOverlays: vi.fn(),
    ...overrides
  }

  const controller = createAnniversaryCardController({
    confirm: deps.confirm,
    setError: deps.setError,
    closeOverlays: deps.closeOverlays,
    root: { querySelector: dom.querySelector },
    newId: () => `id-${(seq += 1)}`,
    cards: {
      list: deps.list,
      getById: deps.getById,
      persist: deps.persist,
      apply: deps.apply
    }
  })

  return { controller, deps, store }
}

const CARD = { id: 'card-1', type: 'anniversary', title: '纪念日', items: [{ id: 'i1', title: '结婚', date: inDays(10) }] }

describe('anniversary card controller', () => {
  it('renders the card through the render layer', () => {
    const { controller } = createHarness()

    const html = controller.renderHtml(CARD)

    expect(html).toContain('anniversary-card')
    expect(html).toContain('结婚')
  })

  it('ignores cards of other types and missing ids', () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })

    controller.openModal('missing')
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal('card-1')
    expect(deps.dom.overlay.hidden).toBe(false)

    controller.closeModal()
    const other = { id: 'card-2', type: 'link', items: [] }
    const { controller: c2, deps: d2 } = createHarness({ seedCards: [other] })
    c2.openModal('card-2')
    expect(d2.dom.overlay.hidden).toBe(true)
  })

  it('opens the modal with the sorted editor list and clears the form', () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    deps.dom.titleInput.value = '残留'
    deps.dom.dateInput.value = '2020-01-01'

    controller.openModal('card-1')

    expect(deps.dom.overlay.hidden).toBe(false)
    expect(deps.dom.titleInput.value).toBe('')
    expect(deps.dom.dateInput.value).toBe('')
    expect(deps.dom.list.innerHTML).toContain('data-item-id="i1"')
    expect(deps.closeOverlays).toHaveBeenCalledOnce()
  })

  it('prepends a new item and keeps the modal open', async () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    controller.bindModalUi()
    controller.openModal('card-1')
    deps.dom.titleInput.value = '  生日  '
    deps.dom.dateInput.value = inDays(3)

    await deps.dom.form.fire('submit')

    const saved = deps.persist.mock.calls[0][0][0]
    expect(saved.items.map((it) => it.title)).toEqual(['生日', '结婚'])
    expect(deps.apply).toHaveBeenCalledOnce()
    expect(deps.setError).toHaveBeenCalledWith('')
    expect(deps.dom.titleInput.value).toBe('')
    expect(deps.dom.overlay.hidden).toBe(false)
  })

  it('dedupe-free replaces the item picked from the list', async () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    controller.bindModalUi()
    controller.openModal('card-1')

    await deps.dom.list.fire('click', { target: { closest: (selector) => (selector === '.anniversary-list-item' ? { getAttribute: () => 'i1' } : null) } })
    expect(deps.dom.titleInput.value).toBe('结婚')

    deps.dom.titleInput.value = '结婚周年'
    deps.dom.dateInput.value = inDays(20)
    await deps.dom.form.fire('submit')

    const items = deps.persist.mock.calls[0][0][0].items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'i1', title: '结婚周年' })
  })

  it('rejects a missing title or an invalid date', async () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    controller.bindModalUi()
    controller.openModal('card-1')

    deps.dom.titleInput.value = ''
    deps.dom.dateInput.value = inDays(1)
    await deps.dom.form.fire('submit')
    expect(deps.setError).toHaveBeenLastCalledWith('请输入标题')

    deps.dom.titleInput.value = '生日'
    deps.dom.dateInput.value = '2026-02-30'
    await deps.dom.form.fire('submit')
    expect(deps.setError).toHaveBeenLastCalledWith('请选择合法日期')

    expect(deps.persist).not.toHaveBeenCalled()
  })

  it('deletes an item after confirmation', async () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    controller.bindModalUi()
    controller.openModal('card-1')

    await deps.dom.list.fire('click', {
      target: { closest: (selector) => (selector === 'button[data-action="delete"]' ? { getAttribute: () => 'i1' } : null) }
    })

    expect(deps.confirm).toHaveBeenCalledOnce()
    const { text, onConfirm } = deps.confirm.mock.calls[0][0]
    expect(text).toContain('确认删除')

    await onConfirm()
    expect(deps.persist.mock.calls[0][0][0].items).toEqual([])
    expect(deps.dom.list.innerHTML).toContain('editor-empty')
  })

  it('adds a component with an empty item list', async () => {
    const { controller, deps } = createHarness()

    await controller.addComponent()

    expect(deps.persist.mock.calls[0][0][0]).toMatchObject({ type: 'anniversary', title: '纪念日', items: [] })
    expect(deps.apply).toHaveBeenCalledOnce()
  })

  it('closes the modal from the overlay, the close and the cancel buttons', () => {
    const { controller, deps } = createHarness({ seedCards: [CARD] })
    controller.bindModalUi()

    controller.openModal('card-1')
    deps.dom.overlay.fire('click', { target: deps.dom.overlay })
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal('card-1')
    deps.dom.overlay.fire('click', { target: deps.dom.titleInput })
    expect(deps.dom.overlay.hidden).toBe(false)

    deps.dom.closeBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)

    controller.openModal('card-1')
    deps.dom.cancelBtn.fire('click')
    expect(deps.dom.overlay.hidden).toBe(true)
  })

  it('opens the native date picker on click and keyboard activation', () => {
    const { controller, deps } = createHarness()
    controller.bindModalUi()

    deps.dom.dateInput.fire('click')
    deps.dom.dateInput.fire('keydown', { key: 'Enter' })
    deps.dom.dateInput.fire('keydown', { key: 'a' })

    expect(deps.dom.dateInput.showPicker).toHaveBeenCalledTimes(2)
  })

  it('queries only modal elements that exist in newtab.html', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../anniversary-card-controller.js', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')
    const ids = [...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(([, id]) => id)

    expect(ids.length).toBeGreaterThan(0)
    for (const id of new Set(ids)) expect(html).toContain(`id="${id}"`)
  })
})
