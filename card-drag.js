const getCardElements = (root) => Array.from(root.querySelectorAll('.card[data-card-id]'))
const getOrderedCardIds = (root) => getCardElements(root).map((element) => element.dataset.cardId)

const captureRects = (root) => new Map(
  getCardElements(root).map((element) => [element.dataset.cardId, element.getBoundingClientRect()])
)

const animateLayout = ({ root, animations, durationMs }, previousRects) => {
  for (const element of getCardElements(root)) {
    if (element.classList.contains('dragging')) continue
    const previous = previousRects.get(element.dataset.cardId)
    if (!previous) continue
    const current = element.getBoundingClientRect()
    const deltaX = previous.left - current.left
    const deltaY = previous.top - current.top
    if (!deltaX && !deltaY) continue
    animations.get(element)?.cancel()
    const animation = element.animate(
      [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: 'translate(0, 0)' }],
      { duration: durationMs, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    )
    animations.set(element, animation)
  }
}

const restoreOrder = (context, order = context.state.originalOrder) => {
  const { root } = context
  if (!order.length) return
  const previousRects = captureRects(root)
  const elementsById = new Map(getCardElements(root).map((element) => [element.dataset.cardId, element]))
  const addCard = root.querySelector('.card-add')
  for (const cardId of order) {
    const element = elementsById.get(cardId)
    if (element) root.insertBefore(element, addCard)
  }
  animateLayout(context, previousRects)
}

const clearVisualState = (context) => {
  const { root, state, onDragStateChange } = context
  state.draggedElement?.classList.remove('dragging')
  root.classList.remove('drag-active')
  state.dragGhost?.remove()
  state.draggedElement = null
  state.dragGhost = null
  onDragStateChange?.(false)
}

const resetGestureState = (state) => {
  state.originalOrder = []
  state.committed = false
}

const cancelDrag = (context, { restore = true } = {}) => {
  const { state } = context
  if (!state.draggedElement) return
  if (restore && !state.committed) restoreOrder(context)
  clearVisualState(context)
  resetGestureState(state)
}

const createDragGhost = (cardElement) => {
  const title = cardElement.querySelector('.card-head-title, .card-title')?.textContent?.trim() || '卡片'
  const ghost = document.createElement('div')
  ghost.className = 'card-drag-ghost'
  ghost.textContent = title
  document.body.appendChild(ghost)
  return ghost
}

const handleDragStart = (context, event) => {
  const { root, state, onDragStateChange } = context
  const cardElement = event.target?.closest?.('.card[data-card-id]')
  if (state.activeCommit || !cardElement || event.target?.closest?.('button, input, select, textarea, a')) {
    event.preventDefault()
    return
  }
  state.draggedElement = cardElement
  state.originalOrder = getOrderedCardIds(root)
  state.committed = false
  cardElement.classList.add('dragging')
  root.classList.add('drag-active')
  onDragStateChange?.(true)
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', cardElement.dataset.cardId)
  state.dragGhost = createDragGhost(cardElement)
  event.dataTransfer.setDragImage(state.dragGhost, state.dragGhost.offsetWidth / 2, state.dragGhost.offsetHeight / 2)
}

const handleDragOver = (context, event) => {
  const { root, state } = context
  if (!state.draggedElement) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const target = event.target?.closest?.('.card[data-card-id]')
  if (!target || target === state.draggedElement) return

  const targetRect = target.getBoundingClientRect()
  const horizontalIntent = Math.abs(event.clientY - (targetRect.top + targetRect.height / 2)) < targetRect.height * 0.35
  const insertAfter = horizontalIntent
    ? event.clientX > targetRect.left + targetRect.width / 2
    : event.clientY > targetRect.top + targetRect.height / 2
  const reference = insertAfter ? target.nextSibling : target
  if (reference === state.draggedElement || (!insertAfter && target.previousSibling === state.draggedElement)) return

  const previousRects = captureRects(root)
  root.insertBefore(state.draggedElement, reference)
  animateLayout(context, previousRects)
}

const handleDrop = (context, event) => {
  const { root, state, onCommit, onError } = context
  if (!state.draggedElement) return
  event.preventDefault()
  state.committed = true
  const commit = { originalOrder: [...state.originalOrder] }
  state.activeCommit = commit

  Promise.resolve(onCommit?.(getOrderedCardIds(root)))
    .then(() => {
      if (state.activeCommit === commit) state.activeCommit = null
    })
    .catch((error) => {
      if (!context.destroyed) restoreOrder(context, commit.originalOrder)
      if (state.activeCommit === commit) state.activeCommit = null
      onError?.(error)
    })
}

const handleDragEnd = (context) => {
  const { state } = context
  if (!state.draggedElement) return
  if (!state.committed) restoreOrder(context)
  clearVisualState(context)
  resetGestureState(state)
}

/**
 * 创建卡片网格拖拽控制器：实时预排，网格内松开提交，网格外松开恢复。
 */
export const createCardDragController = ({ root, onCommit, onDragStateChange, onError, durationMs = 180 }) => {
  const context = {
    root,
    onCommit,
    onDragStateChange,
    onError,
    durationMs,
    destroyed: false,
    animations: new WeakMap(),
    state: { draggedElement: null, originalOrder: [], committed: false, activeCommit: null, dragGhost: null }
  }
  const listeners = {
    dragstart: (event) => handleDragStart(context, event),
    dragover: (event) => handleDragOver(context, event),
    drop: (event) => handleDrop(context, event),
    dragend: () => handleDragEnd(context)
  }
  for (const [eventName, listener] of Object.entries(listeners)) root.addEventListener(eventName, listener)

  return {
    cancel: (options) => cancelDrag(context, options),
    destroy: () => {
      context.destroyed = true
      cancelDrag(context)
      for (const [eventName, listener] of Object.entries(listeners)) root.removeEventListener(eventName, listener)
    },
    getOrderedCardIds: () => getOrderedCardIds(root)
  }
}
