/**
 * @fileoverview
 * 卡片网格：按卡片类型注册表渲染卡片、初始化数据、分发点击与资源回收，并负责拖拽排序。
 *
 * 设计目标：
 * - 这里只认注册表，不认识具体卡片域；每个域提供
 *   `{ className, render(card, div), initialize?, poll?, handleClick?, cleanup? }`。
 * - 轮询定时器、图标加载取消函数、拖拽状态都由网格统一持有与清理，
 *   避免页面 state 里散落多份计时器集合。
 *
 * 注意：
 * - `render(card, div)` 可以返回一个清理函数（例如图标加载的取消器），网格会在重渲染时调用。
 * - 拖拽排序提交后不重渲染（DOM 已是新顺序），只持久化并触发自动推送。
 */

import { createCardDragController } from './card-drag.js'

const DEFAULT_TYPE = 'link'
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

const ADD_CARD_ICON = `
    <svg class="card-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="12" y1="6" x2="12" y2="18"></line>
      <line x1="6" y1="12" x2="18" y2="12"></line>
    </svg>
  `

/**
 * 创建卡片网格。
 *
 * @param {object} options
 * @param {object} options.cards 卡片仓储门面：list/persist/apply/schedulePush。
 * @param {object} options.registry 卡片类型注册表。
 * @param {function(string): Promise<void>} [options.openUrl] 链接卡片的默认点击行为。
 * @param {function(object): void} [options.onContextMenu] 右键卡片菜单。
 * @param {function(): void} [options.onAddCard] 点击新增卡片。
 * @param {function(Error): void} [options.onDragError] 拖拽排序失败回调。
 * @param {function(object): object} [options.createDragController] 拖拽控制器工厂，测试可注入。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ render: function(): void, deleteCard: function(string): Promise<void>,
 *   isDragging: function(): boolean, initDrag: function(): void }}
 */
export const createCardGrid = ({
  cards,
  registry,
  openUrl,
  onContextMenu,
  onAddCard,
  onDragError,
  root = getDocument(),
  createDragController = createCardDragController
}) => {
  let dragging = false
  let dragController = null
  const pollTimers = new Map()
  const resourceCleanups = new Set()

  const $ = (selector) => root?.querySelector?.(selector) || null
  const entryFor = (card) => registry?.[card?.type || DEFAULT_TYPE] || registry?.[DEFAULT_TYPE]

  const clearPolling = () => {
    for (const timer of pollTimers.values()) clearInterval(timer)
    pollTimers.clear()
  }

  const clearResources = () => {
    for (const cancel of resourceCleanups) cancel?.()
    resourceCleanups.clear()
  }

  /**
   * 定时轮询：立刻拉一次，之后按间隔刷新，直到重渲染时统一清理。
   */
  const startPolling = (card, div, poll) => {
    const { tokenDatasetKey, loadData, intervalMs = DEFAULT_POLL_INTERVAL_MS } = poll
    const renderToken = crypto.randomUUID()
    div.dataset[tokenDatasetKey] = renderToken
    void loadData(card, { cardEl: div, renderToken, forceRefresh: true })

    const timer = setInterval(() => {
      const latest = cards.getById(card.id)
      if (!latest) return
      void loadData(latest, { cardEl: div, renderToken: div.dataset[tokenDatasetKey], forceRefresh: true })
    }, intervalMs)
    pollTimers.set(card.id, timer)
  }

  const initializeCard = (card, div) => {
    const entry = entryFor(card)
    if (entry?.initialize) {
      entry.initialize(card, div)
      return
    }
    if (entry?.poll) startPolling(card, div, entry.poll)
  }

  const handleCardClick = async (card, evt) => {
    if (dragging) return
    const entry = entryFor(card)
    if (entry?.handleClick) {
      await entry.handleClick(card, evt)
      return
    }
    if (card?.url) await openUrl?.(card.url)
  }

  const cleanupCard = async (card, remainingCards) => {
    const cleanup = entryFor(card)?.cleanup
    if (cleanup) await cleanup(card, remainingCards)
  }

  const createCardElement = (card) => {
    const div = root.createElement('div')
    const entry = entryFor(card)
    div.className = entry?.className || 'card'
    const cancel = entry?.render?.(card, div)
    if (typeof cancel === 'function') resourceCleanups.add(cancel)

    div.draggable = true
    div.dataset.cardId = card.id
    div.addEventListener('click', (evt) => void handleCardClick(card, evt))
    div.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      onContextMenu?.({ x: evt.clientX, y: evt.clientY, cardId: card.id })
    })
    return div
  }

  /**
   * 全量重渲染：先清理拖拽、图标加载与轮询，再按当前卡片顺序重建。
   */
  const render = () => {
    dragController?.cancel({ restore: false })
    clearResources()
    clearPolling()

    const container = $('#cardsGrid')
    if (!container) return
    container.innerHTML = ''

    for (const card of cards.list()) {
      const div = createCardElement(card)
      container.appendChild(div)
      initializeCard(card, div)
    }

    const addCard = root.createElement('button')
    addCard.type = 'button'
    addCard.className = 'card card-add'
    addCard.innerHTML = ADD_CARD_ICON
    addCard.addEventListener('click', () => onAddCard?.())
    container.appendChild(addCard)
  }

  /**
   * 拖拽排序提交：按新顺序重排卡片并持久化，不重渲染（DOM 已是新顺序）。
   */
  const persistOrder = async (orderedIds) => {
    const list = cards.list()
    const byId = new Map(list.map((card) => [card.id, card]))
    const orderedIdSet = new Set(orderedIds)
    const next = [...orderedIds.map((id) => byId.get(id)).filter(Boolean), ...list.filter((card) => !orderedIdSet.has(card.id))]
    if (next.every((card, index) => card.id === list[index]?.id)) return

    await cards.persist(next)
    cards.schedulePush?.()
  }

  /**
   * 初始化拖拽排序（只做一次）。
   */
  const initDrag = () => {
    if (dragController) return
    dragController = createDragController({
      root: $('#cardsGrid'),
      onCommit: persistOrder,
      onDragStateChange: (next) => {
        dragging = Boolean(next)
      },
      onError: (error) => {
        onDragError?.(error)
        render()
      }
    })
  }

  /**
   * 删除卡片：先持久化，再回收该卡片的外部资源，最后重渲染。
   */
  const deleteCard = async (id) => {
    const list = cards.list()
    const removedCard = list.find((card) => card.id === id)
    const next = list.filter((card) => card.id !== id)

    await cards.persist(next)
    if (removedCard) await cleanupCard(removedCard, next)
    render()
    cards.schedulePush?.()
  }

  return { render, deleteCard, isDragging: () => dragging, initDrag }
}
