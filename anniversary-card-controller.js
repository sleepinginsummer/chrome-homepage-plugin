/**
 * @fileoverview
 * 纪念日卡片控制器：卡片渲染、新增组件与增删改弹窗。
 *
 * 设计目标：
 * - 日期计算与渲染分别在 anniversary.js / anniversary-card.js，这里只做编排。
 * - 配置读写走页面注入的 cardRepository；确认弹窗与错误提示也由页面提供。
 *
 * 注意：
 * - 弹窗内的编辑态（正在编辑的卡片与条目）属于卡片域内部状态，页面不再持有。
 * - 提交后不关闭弹窗（保持原有交互：连续录入多条纪念日）。
 */

import { buildNextItems, parseYmd } from './anniversary.js'
import { renderAnniversaryCardHtml, renderAnniversaryEditorHtml } from './anniversary-card.js'

const CARD_TYPE = 'anniversary'
const EDITOR_ITEM_SELECTOR = '.anniversary-list-item'
const DELETE_ACTION_SELECTOR = 'button[data-action="delete"]'

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建纪念日卡片控制器。
 *
 * @param {object} options
 * @param {object} options.cards 卡片仓储门面：list/getById/persist/apply，语义同其它域控制器。
 * @param {function(object): void} [options.confirm] 确认弹窗（删除条目时使用）。
 * @param {function(string): void} [options.setError] 页面级错误提示位。
 * @param {function(): void} [options.closeOverlays] 打开弹窗前收起其它浮层。
 * @param {object} [options.root=document] DOM 根节点。
 * @param {function(): string} [options.newId] 生成条目 id，测试可注入。
 * @returns {{ renderHtml: function(object): string, openModal: function(string): void,
 *   closeModal: function(): void, bindModalUi: function(): void, addComponent: function(): Promise<void> }}
 */
export const createAnniversaryCardController = ({
  cards,
  confirm,
  setError,
  closeOverlays,
  root = getDocument(),
  newId = () => crypto.randomUUID()
}) => {
  // 重要逻辑：正在编辑的卡片与条目属于卡片域内部状态。
  let editingCardId = null
  let editingItemId = null

  const $ = (selector) => root?.querySelector?.(selector) || null

  const renderHtml = (card) => renderAnniversaryCardHtml(card)

  /**
   * 渲染弹窗里的条目列表。
   */
  const renderEditorList = (card) => {
    const listEl = $('#anniversaryList')
    if (!listEl) return
    listEl.innerHTML = renderAnniversaryEditorHtml(card?.items)
  }

  const closeModal = () => {
    const overlay = $('#anniversaryOverlay')
    if (overlay) overlay.hidden = true
    editingCardId = null
    editingItemId = null
    const titleInput = $('#anniversaryTitleInput')
    const dateInput = $('#anniversaryDateInput')
    if (titleInput) titleInput.value = ''
    if (dateInput) dateInput.value = ''
  }

  const openModal = (cardId) => {
    const card = cards.getById(cardId)
    if (!card) return
    if ((card.type || 'link') !== CARD_TYPE) return

    editingCardId = cardId
    editingItemId = null
    renderEditorList(card)

    const overlay = $('#anniversaryOverlay')
    const titleInput = $('#anniversaryTitleInput')
    const dateInput = $('#anniversaryDateInput')
    if (overlay) overlay.hidden = false
    if (titleInput) titleInput.value = ''
    if (dateInput) dateInput.value = ''
    closeOverlays?.()
  }

  const refreshEditorList = (cardId) => {
    const nextCard = cards.getById(cardId)
    if (nextCard) renderEditorList(nextCard)
  }

  const saveItems = async (cardId, items) => {
    const next = [...cards.list()]
    const index = next.findIndex((card) => card.id === cardId)
    if (index === -1) return
    next[index] = { ...next[index], items }
    await cards.persist(next)
    cards.apply()
  }

  /**
   * 新增纪念日组件：标题沿用原有硬编码。
   */
  const addComponent = async () => {
    const next = [...cards.list()]
    next.push({
      id: newId(),
      type: CARD_TYPE,
      title: '纪念日',
      items: []
    })
    await cards.persist(next)
    cards.apply()
  }

  /**
   * 编辑列表交互：删除走确认弹窗，点条目把内容回填到表单。
   */
  const handleEditorListClick = async (evt) => {
    const target = evt.target
    const cardId = editingCardId
    if (!cardId) return
    const card = cards.getById(cardId)
    if (!card) return

    const delBtn = target?.closest?.(DELETE_ACTION_SELECTOR)
    if (delBtn) {
      const itemId = delBtn.getAttribute('data-item-id')
      if (!itemId) return
      confirm?.({
        title: '确认删除',
        text: '确认删除该纪念日吗？',
        onConfirm: async () => {
          const items = Array.isArray(card.items) ? card.items : []
          await saveItems(cardId, items.filter((it) => it.id !== itemId))
          refreshEditorList(cardId)
        }
      })
      return
    }

    const itemEl = target?.closest?.(EDITOR_ITEM_SELECTOR)
    if (!itemEl) return
    const itemId = itemEl.getAttribute('data-item-id')
    const items = Array.isArray(card.items) ? card.items : []
    const item = items.find((it) => it.id === itemId)
    if (!item) return

    editingItemId = item.id
    const titleInput = $('#anniversaryTitleInput')
    const dateInput = $('#anniversaryDateInput')
    if (titleInput) titleInput.value = item.title || ''
    if (dateInput) dateInput.value = item.date || ''
  }

  /**
   * 弹窗提交：校验后新增或替换条目，保持弹窗打开以便连续录入。
   */
  const submitModal = async () => {
    const cardId = editingCardId
    if (!cardId) return
    const card = cards.getById(cardId)
    if (!card) return

    const titleInput = $('#anniversaryTitleInput')
    const dateInput = $('#anniversaryDateInput')
    const title = titleInput?.value.trim()
    const date = dateInput?.value.trim()

    if (!title) {
      setError?.('请输入标题')
      return
    }
    if (!parseYmd(date)) {
      setError?.('请选择合法日期')
      return
    }
    setError?.('')

    const { items } = buildNextItems(card.items, editingItemId, { id: newId(), title, date })
    await saveItems(cardId, items)
    refreshEditorList(cardId)

    editingItemId = null
    if (titleInput) titleInput.value = ''
    if (dateInput) dateInput.value = ''
  }

  /**
   * 绑定纪念日弹窗自身的元素；新增按钮由页面的组件列表统一处理。
   */
  const bindModalUi = () => {
    const overlay = $('#anniversaryOverlay')
    const closeBtn = $('#anniversaryCloseBtn')
    const cancelBtn = $('#anniversaryCancelBtn')
    const form = $('#anniversaryForm')
    const list = $('#anniversaryList')
    const dateInput = $('#anniversaryDateInput')

    const openNativeDatePicker = () => {
      if (typeof dateInput?.showPicker === 'function') dateInput.showPicker()
    }
    dateInput?.addEventListener('click', openNativeDatePicker)
    dateInput?.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') openNativeDatePicker()
    })

    overlay?.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal()
    })
    closeBtn?.addEventListener('click', closeModal)
    cancelBtn?.addEventListener('click', closeModal)
    // 返回 Promise 便于测试直接 await；DOM 监听器会忽略返回值。
    list?.addEventListener('click', handleEditorListClick)
    form?.addEventListener('submit', (evt) => {
      evt.preventDefault()
      return submitModal()
    })
  }

  return { renderHtml, openModal, closeModal, bindModalUi, addComponent }
}
