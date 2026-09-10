/**
 * @fileoverview
 * 股票卡片控制器：行情缓存调度、刷新、点击与增删改弹窗。
 *
 * 设计目标：
 * - 数据与渲染分别在 stock.js / stock-card.js，这里只做编排。
 * - 配置读写走页面注入的 cardRepository，错误提示与确认弹窗也由页面提供。
 *
 * 注意：
 * - 卡片列表的定时轮询由页面统一调度（与贵金属共用），控制器只暴露 loadData。
 * - 弹窗模式与正在编辑的代码属于卡片域内部状态，页面不再持有。
 */

import { buildNextSymbols, createStockClient, formatTencentSymbol, getStockSymbols, normalizeStockSymbolsInput } from './stock.js'
import { getStockCardTitle, renderStockCardHtml, renderStockEditorHtml, updateStockCardDom } from './stock-card.js'

const CARD_TYPE = 'stock'
const ITEM_ACTION_SELECTOR = '[data-stock-action]'
const ITEM_SYMBOL_SELECTOR = '[data-stock-symbol]'
const EDITOR_ITEM_SELECTOR = '.stock-list-item'
const QUOTE_PAGE_BASE = 'https://gu.qq.com/'

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建股票卡片控制器。
 *
 * @param {object} options
 * @param {function(): string} options.getLang 当前语言。
 * @param {function(): object} options.getText 股票卡片文案（页面持有 i18n 字典）。
 * @param {object} options.cards 卡片仓储门面：list/getById/persist/apply，语义同其它域控制器。
 * @param {function(): void} [options.closeOverlays] 打开弹窗前收起其它浮层。
 * @param {function(string): Promise<void>} [options.openUrl] 打开行情详情页。
 * @param {function(object): void} [options.confirm] 确认弹窗（删除代码时使用）。
 * @param {function(string): void} [options.setError] 页面级错误提示位。
 * @param {object} [options.client] 行情客户端，默认新建，测试可注入替身。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ renderHtml: function(object): string, loadData: function(object, object): Promise<void>,
 *   handleClick: function(object, object): Promise<void>, refresh: function(string): Promise<void>,
 *   openModal: function(object): void, closeModal: function(): void, bindModalUi: function(): void }}
 */
export const createStockCardController = ({
  getLang,
  getText,
  cards,
  closeOverlays,
  openUrl,
  confirm,
  setError,
  client = createStockClient(),
  root = getDocument()
}) => {
  // 重要逻辑：弹窗模式、正在编辑的卡片与代码都属于卡片域内部状态。
  let modalMode = 'create'
  let editingCardId = null
  let editingSymbol = null

  const $ = (selector) => root?.querySelector?.(selector) || null
  const t = (zh, en) => (getLang?.() === 'en' ? en : zh)
  const defaultTitle = () => t('股票', 'Stocks')
  const cardTitle = (card) => getStockCardTitle(card, getLang?.())

  const renderHtml = (card) => renderStockCardHtml(card, { text: getText(), lang: getLang?.() })

  /**
   * 拉取行情并写入卡片 DOM；无代码或失败时写入对应的空态/错误态。
   */
  const loadData = async (card, { cardEl, renderToken, forceRefresh = false }) => {
    const symbols = getStockSymbols(card)
    const text = getText()
    const lang = getLang?.()
    if (!symbols.length) {
      updateStockCardDom({ cardEl, renderToken, items: [], errorText: text.empty, text, lang })
      return
    }

    try {
      const items = await client.load(card.id, symbols, { forceRefresh })
      updateStockCardDom({ cardEl, renderToken, items, text, lang })
    } catch {
      updateStockCardDom({ cardEl, renderToken, items: [], errorText: text.error, text, lang })
    }
  }

  const refresh = async (cardId) => {
    const card = cards.getById(cardId)
    if (!card || (card.type || 'link') !== CARD_TYPE) return
    client.invalidate(card.id)
    const cardEl = $(`.card[data-card-id="${card.id}"]`)
    const renderToken = cardEl?.dataset?.stockRenderToken
    if (!cardEl || !renderToken) {
      // 卡片还没渲染（或在别的标签页被删了），整体重渲染一次。
      cards.apply()
      return
    }
    await loadData(card, { cardEl, renderToken, forceRefresh: true })
  }

  const handleClick = async (card, evt) => {
    const actionEl = evt.target?.closest?.(ITEM_ACTION_SELECTOR)
    if (actionEl?.dataset?.stockAction === 'refresh') {
      evt.preventDefault()
      evt.stopPropagation()
      await refresh(card.id)
      return
    }
    const itemEl = evt.target?.closest?.(ITEM_SYMBOL_SELECTOR)
    if (!itemEl) {
      openModal({ mode: 'edit', cardId: card.id })
      return
    }
    const symbol = itemEl.dataset.stockSymbol
    if (!symbol) return
    await openUrl?.(`${QUOTE_PAGE_BASE}${encodeURIComponent(formatTencentSymbol(symbol))}`)
  }

  /**
   * 渲染弹窗里的代码列表：行情取客户端缓存，不触发请求。
   */
  const renderEditorList = (card) => {
    const rootEl = $('#stockList')
    if (!rootEl) return
    rootEl.innerHTML = renderStockEditorHtml({
      symbols: getStockSymbols(card),
      items: client.peek(card?.id)
    })
  }

  const closeModal = () => {
    const overlay = $('#stockOverlay')
    if (overlay) overlay.hidden = true
    editingCardId = null
    editingSymbol = null
    modalMode = 'create'
    const titleInput = $('#stockTitleInput')
    const symbolInput = $('#stockSymbolInput')
    if (titleInput) titleInput.value = ''
    if (symbolInput) symbolInput.value = ''
  }

  const openModal = ({ mode, cardId }) => {
    const overlay = $('#stockOverlay')
    const titleEl = $('#stockModalTitle')
    const titleInput = $('#stockTitleInput')
    const symbolInput = $('#stockSymbolInput')

    modalMode = mode === 'edit' ? 'edit' : 'create'
    editingCardId = mode === 'edit' ? cardId : null
    editingSymbol = null

    if (titleEl) {
      titleEl.textContent = modalMode === 'edit' ? t('股票设置', 'Stock settings') : t('新增股票', 'Add stocks')
    }
    const card = modalMode === 'edit' ? cards.getById(cardId) : null
    if (titleInput) titleInput.value = cardTitle(card) || defaultTitle()
    if (symbolInput) symbolInput.value = ''
    renderEditorList(card || { symbols: [] })

    if (overlay) overlay.hidden = false
    closeOverlays?.()
    requestAnimationFrame(() => symbolInput?.focus())
  }

  const addComponent = async ({ title, symbols }) => {
    const next = [...cards.list()]
    next.push({
      id: crypto.randomUUID(),
      type: CARD_TYPE,
      title: title || defaultTitle(),
      symbols
    })
    await cards.persist(next)
    cards.apply()
  }

  const savePatch = async (cardId, patch) => {
    const next = [...cards.list()]
    const index = next.findIndex((card) => card.id === cardId)
    if (index === -1) return
    next[index] = { ...next[index], ...patch }
    await cards.persist(next)
    // 重要逻辑：代码变了就丢弃该卡片的行情缓存，避免编辑列表展示旧数据。
    client.invalidate(cardId)
    cards.apply()
  }

  /**
   * 重新渲染弹窗里的代码列表（提交后与删除后共用）。
   */
  const refreshEditorList = (cardId) => {
    const nextCard = cards.getById(cardId)
    if (nextCard) renderEditorList(nextCard)
  }

  /**
   * 新增态提交：只取第一个代码建卡。
   * @returns {Promise<boolean>} 是否提交成功（成功才收尾关闭弹窗）。
   */
  const submitCreate = async ({ title, inputSymbols }) => {
    const symbol = inputSymbols[0]
    if (!symbol) {
      setError?.(t('请输入股票代码', 'Please input symbols'))
      return false
    }
    setError?.('')
    await addComponent({ title, symbols: [symbol] })
    return true
  }

  /**
   * 编辑态提交：只改标题、新增代码、替换代码三条路径都在这里收敛。
   * @returns {Promise<boolean>} 是否提交成功。
   */
  const submitEdit = async ({ title, inputSymbols }) => {
    const card = cards.getById(editingCardId)
    if (!card) return false

    const symbols = getStockSymbols(card)
    const symbol = inputSymbols[0]

    // 只改了标题、没有新增或替换代码。
    if (!symbol && !editingSymbol) {
      setError?.('')
      await savePatch(editingCardId, { title, symbols })
      refreshEditorList(editingCardId)
      return true
    }

    if (!symbol) {
      setError?.(t('请输入股票代码', 'Please input symbols'))
      return false
    }

    setError?.('')
    await savePatch(editingCardId, { title, symbols: buildNextSymbols(symbols, editingSymbol, symbol) })
    refreshEditorList(editingCardId)
    return true
  }

  /**
   * 弹窗提交：只负责读表单、选择分支与统一收尾。
   */
  const submitModal = async () => {
    const titleInput = $('#stockTitleInput')
    const symbolInput = $('#stockSymbolInput')
    const title = titleInput?.value.trim() || defaultTitle()
    const inputSymbols = normalizeStockSymbolsInput(symbolInput?.value)

    const submitted = modalMode === 'edit' && editingCardId
      ? await submitEdit({ title, inputSymbols })
      : await submitCreate({ title, inputSymbols })
    if (!submitted) return

    editingSymbol = null
    if (symbolInput) symbolInput.value = ''
    closeModal()
  }

  /**
   * 编辑列表交互：删除走确认弹窗，点条目则把代码回填到输入框。
   */
  const handleEditorListClick = async (evt) => {
    const target = evt.target
    const cardId = editingCardId
    if (!cardId) return
    const card = cards.getById(cardId)
    if (!card) return

    const delBtn = target?.closest?.('button[data-action="delete"]')
    if (delBtn) {
      const symbol = delBtn.getAttribute('data-symbol')
      if (!symbol) return
      confirm?.({
        title: '确认删除',
        text: `确认删除股票「${symbol}」吗？`,
        onConfirm: async () => {
          const nextSymbols = getStockSymbols(card).filter((it) => it !== symbol)
          await savePatch(cardId, { title: cardTitle(card), symbols: nextSymbols })
          const nextCard = cards.getById(cardId)
          if (nextCard) renderEditorList(nextCard)
          if (editingSymbol === symbol) {
            editingSymbol = null
            const symbolInput = $('#stockSymbolInput')
            if (symbolInput) symbolInput.value = ''
          }
        }
      })
      return
    }

    const itemEl = target?.closest?.(EDITOR_ITEM_SELECTOR)
    if (!itemEl) return
    const symbol = itemEl.getAttribute('data-symbol')
    if (!symbol) return
    editingSymbol = symbol
    const symbolInput = $('#stockSymbolInput')
    const titleInput = $('#stockTitleInput')
    if (symbolInput) symbolInput.value = symbol
    if (titleInput) titleInput.value = cardTitle(card)
  }

  /**
   * 绑定股票弹窗自身的元素；新增按钮由页面的组件列表统一处理。
   */
  const bindModalUi = () => {
    const overlay = $('#stockOverlay')
    const closeBtn = $('#stockCloseBtn')
    const cancelBtn = $('#stockCancelBtn')
    const form = $('#stockForm')
    const list = $('#stockList')

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

  return { renderHtml, loadData, handleClick, refresh, openModal, closeModal, bindModalUi }
}
