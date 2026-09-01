import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCardDragController } from '../card-drag.js'

class FakeClassList {
  constructor(initial = []) { this.values = new Set(initial) }
  add(value) { this.values.add(value) }
  remove(value) { this.values.delete(value) }
  contains(value) { return this.values.has(value) }
}

class FakeElement {
  constructor(id, classNames = ['card']) {
    this.dataset = id ? { cardId: id } : {}
    this.classList = new FakeClassList(classNames)
    this.parent = null
  }
  closest(selector) { return selector === '.card[data-card-id]' ? this : null }
  querySelector() { return null }
  getBoundingClientRect() {
    const index = this.parent?.children.indexOf(this) || 0
    return { left: index * 100, top: 0, width: 90, height: 90 }
  }
  animate() { return { cancel: vi.fn() } }
  remove() {}
  get nextSibling() {
    const index = this.parent.children.indexOf(this)
    return this.parent.children[index + 1] || null
  }
  get previousSibling() {
    const index = this.parent.children.indexOf(this)
    return this.parent.children[index - 1] || null
  }
}

const createGrid = () => {
  const cards = ['a', 'b', 'c'].map((id) => new FakeElement(id))
  const addCard = new FakeElement(null, ['card', 'card-add'])
  const listeners = new Map()
  const root = {
    children: [...cards, addCard],
    classList: new FakeClassList(['cards-grid']),
    querySelectorAll: () => root.children.filter((item) => item.dataset.cardId),
    querySelector: (selector) => selector === '.card-add' ? addCard : null,
    insertBefore(element, reference) {
      root.children.splice(root.children.indexOf(element), 1)
      const index = reference ? root.children.indexOf(reference) : root.children.length
      root.children.splice(index < 0 ? root.children.length : index, 0, element)
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name)
  }
  root.children.forEach((item) => { item.parent = root })
  return { root, cards, listeners }
}

const createDragEvent = (target, overrides = {}) => ({
  target,
  clientX: 0,
  clientY: 45,
  preventDefault: vi.fn(),
  dataTransfer: {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    setDragImage: vi.fn()
  },
  ...overrides
})

const getOrder = (root) => root.querySelectorAll().map((item) => item.dataset.cardId)

beforeEach(() => {
  globalThis.document = {
    createElement: () => ({ className: '', textContent: '', offsetWidth: 220, offsetHeight: 48, remove: vi.fn() }),
    body: { appendChild: vi.fn() }
  }
})

afterEach(() => { delete globalThis.document })

describe('card drag controller', () => {
  it('网格外松开时恢复原顺序', () => {
    const { root, cards, listeners } = createGrid()
    createCardDragController({ root, onCommit: vi.fn() })
    listeners.get('dragstart')(createDragEvent(cards[2]))
    listeners.get('dragover')(createDragEvent(cards[0], { clientX: 1 }))
    expect(getOrder(root)).toEqual(['c', 'a', 'b'])
    listeners.get('dragend')()
    expect(getOrder(root)).toEqual(['a', 'b', 'c'])
  })

  it('保存失败时按提交快照恢复', async () => {
    const { root, cards, listeners } = createGrid()
    const onError = vi.fn()
    createCardDragController({ root, onCommit: () => Promise.reject(new Error('save failed')), onError })
    listeners.get('dragstart')(createDragEvent(cards[2]))
    listeners.get('dragover')(createDragEvent(cards[0], { clientX: 1 }))
    listeners.get('drop')(createDragEvent(root))
    listeners.get('dragend')()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(getOrder(root)).toEqual(['a', 'b', 'c'])
  })

  it('保存未完成时拒绝第二次拖动', async () => {
    const { root, cards, listeners } = createGrid()
    let resolveCommit
    const commit = new Promise((resolve) => { resolveCommit = resolve })
    createCardDragController({ root, onCommit: () => commit })
    listeners.get('dragstart')(createDragEvent(cards[0]))
    listeners.get('drop')(createDragEvent(root))
    listeners.get('dragend')()

    const secondStart = createDragEvent(cards[1])
    listeners.get('dragstart')(secondStart)
    expect(secondStart.preventDefault).toHaveBeenCalledOnce()
    expect(cards[1].classList.contains('dragging')).toBe(false)

    resolveCommit()
    await commit
  })
})
