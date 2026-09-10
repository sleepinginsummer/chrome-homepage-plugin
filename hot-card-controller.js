/**
 * @fileoverview
 * 热搜卡片的域控制器：把热搜卡片的渲染、拉取、刷新、增删改弹窗从 newtab.js 拆出来。
 *
 * 设计目标：
 * - 与 weather-card-controller 同样的注入风格：卡片仓储、外链打开与浮层收起由页面决定。
 * - 热搜来源白名单属于卡片域规则，跟着控制器走，避免页面上散落三处校验。
 *
 * 注意：
 * - 卡片内的「加载中/暂无数据/加载失败」等文案沿用原有硬编码，未接入 i18n，保持行为不变。
 */

import { createHotNewsClient } from './hot-news.js'

const CARD_TYPE = 'hot'
const RENDER_TOKEN_KEY = 'hotRenderToken'
const ITEM_ACTION_SELECTOR = '[data-hot-action]'
const ITEM_LINK_SELECTOR = '[data-hot-link]'
const INITIAL_LOAD_DELAY_MS = 800
const DEFAULT_SOURCE = '知乎'
const MAX_ITEMS = 50

/** 热搜来源白名单，弹窗下拉与新增/编辑校验共用。 */
const HOT_SOURCES = [
  '哔哩哔哩',
  '百度',
  '知乎',
  '百度贴吧',
  '少数派',
  'IT之家',
  '澎湃新闻',
  '今日头条',
  '微博热搜',
  '36氪',
  '稀土掘金',
  '腾讯新闻'
]

const escapeHtml = (raw) =>
  String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建热搜卡片控制器。
 *
 * @param {object} options
 * @param {function(): string} options.getLang 当前语言（弹窗标题用）。
 * @param {function(function(), number): *} options.runWhenIdle 空闲调度，用于延迟首屏拉取。
 * @param {object} options.cards 卡片仓储门面：list/getById/persist/apply，语义同天气控制器。
 * @param {function(string): Promise<void>} [options.openUrl] 打开热搜条目链接。
 * @param {function(): void} [options.closeOverlays] 打开弹窗前收起其它浮层（组件列表/卡片菜单）。
 * @param {object} [options.client] 热搜客户端，默认新建，测试可注入替身。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ renderHtml: function(object): string, initialize: function(object, object): void,
 *   handleClick: function(object, object): Promise<void>, refresh: function(string): Promise<void>,
 *   openModal: function(object): void, closeModal: function(): void, bindModalUi: function(): void }}
 */
export const createHotCardController = ({
  getLang,
  runWhenIdle,
  cards,
  openUrl,
  closeOverlays,
  client = createHotNewsClient(),
  root = getDocument()
}) => {
  // 重要逻辑：弹窗模式属于卡片域内部状态，页面不需要知道。
  let modalMode = 'create'
  let editingCardId = null

  const $ = (selector) => root?.querySelector?.(selector) || null
  const t = (zh, en) => (getLang?.() === 'en' ? en : zh)
  const getSourceTitle = (card) => String(card?.sourceTitle || card?.title || DEFAULT_SOURCE)
  const normalizeSource = (value) => (HOT_SOURCES.includes(value) ? value : DEFAULT_SOURCE)

  const renderHtml = (card) => `
    <div class="hot-card">
      <div class="hot-header">
        <div class="hot-title">${escapeHtml(getSourceTitle(card))}</div>
        <button class="hot-refresh" type="button" aria-label="刷新" data-hot-action="refresh">
          <svg class="hot-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.3 6.4"></path>
            <path d="M3 12a9 9 0 0 1 15.3-6.4"></path>
            <polyline points="3 16 5.7 18.4 6.6 15"></polyline>
            <polyline points="21 8 18.3 5.6 17.4 9"></polyline>
          </svg>
        </button>
      </div>
      <div class="hot-list" data-hot-list>
        <div class="hot-empty">加载中...</div>
      </div>
    </div>
  `

  const updateCardDom = ({ cardEl, renderToken, items, errorText }) => {
    if (!cardEl || cardEl.dataset[RENDER_TOKEN_KEY] !== renderToken) return
    const listEl = cardEl.querySelector('[data-hot-list]')
    if (!listEl) return

    if (errorText) {
      listEl.innerHTML = `<div class="hot-empty">${escapeHtml(errorText)}</div>`
      return
    }

    if (!items?.length) {
      listEl.innerHTML = '<div class="hot-empty">暂无数据</div>'
      return
    }

    listEl.innerHTML = items
      .slice(0, MAX_ITEMS)
      .map(
        (item, index) => `
      <div class="hot-item" data-hot-link="${escapeHtml(item.link)}" title="${escapeHtml(item.title)}">
        <div class="hot-rank hot-rank-${index + 1}">${index + 1}</div>
        <div class="hot-text">${escapeHtml(item.title)}</div>
      </div>
    `
      )
      .join('')
  }

  /**
   * 拉取并写入卡片 DOM；失败时写入错误态，卡片本身保留。
   */
  const load = async (card, { cardEl, renderToken, forceRefresh = false }) => {
    try {
      const items = await client.load(getSourceTitle(card), { forceRefresh })
      updateCardDom({ cardEl, renderToken, items })
    } catch {
      updateCardDom({ cardEl, renderToken, items: [], errorText: '加载失败，点击刷新重试' })
    }
  }

  /**
   * 卡片挂载后延迟拉取，避免新标签页首屏被网络请求拖慢。
   */
  const initialize = (card, cardEl) => {
    const renderToken = crypto.randomUUID()
    cardEl.dataset[RENDER_TOKEN_KEY] = renderToken
    void runWhenIdle(() => load(card, { cardEl, renderToken }), INITIAL_LOAD_DELAY_MS)
  }

  const refresh = async (cardId) => {
    const card = cards.getById(cardId)
    if (!card || (card.type || 'link') !== CARD_TYPE) return
    const cardEl = $(`.card[data-card-id="${card.id}"]`)
    const renderToken = cardEl?.dataset?.[RENDER_TOKEN_KEY]
    if (!cardEl || !renderToken) {
      // 卡片还没渲染（或在别的标签页被删了），整体重渲染一次。
      cards.apply()
      return
    }
    await load(card, { cardEl, renderToken, forceRefresh: true })
  }

  const handleClick = async (card, evt) => {
    const actionEl = evt.target?.closest?.(ITEM_ACTION_SELECTOR)
    if (actionEl?.dataset?.hotAction === 'refresh') {
      evt.preventDefault()
      evt.stopPropagation()
      await refresh(card.id)
      return
    }
    const itemEl = evt.target?.closest?.(ITEM_LINK_SELECTOR)
    if (itemEl) {
      const url = itemEl.dataset.hotLink
      if (url) await openUrl?.(url)
      return
    }
    openModal({ mode: 'edit', cardId: card.id })
  }

  const closeModal = () => {
    const overlay = $('#hotOverlay')
    if (overlay) overlay.hidden = true
    editingCardId = null
    modalMode = 'create'
  }

  const openModal = ({ mode, cardId }) => {
    const overlay = $('#hotOverlay')
    const titleEl = $('#hotModalTitle')
    const select = $('#hotSourceSelect')
    modalMode = mode === 'edit' ? 'edit' : 'create'
    editingCardId = mode === 'edit' ? cardId : null
    if (titleEl) {
      titleEl.textContent = modalMode === 'edit' ? t('热搜设置', 'Hot search') : t('新增热搜', 'Add hot search')
    }
    if (select) {
      const current = modalMode === 'edit' ? getSourceTitle(cards.getById(cardId)) : DEFAULT_SOURCE
      select.value = normalizeSource(current)
    }
    if (overlay) overlay.hidden = false
    closeOverlays?.()
  }

  const addComponent = async (sourceTitle) => {
    const safeTitle = normalizeSource(sourceTitle)
    const next = [...cards.list()]
    next.push({ id: crypto.randomUUID(), type: CARD_TYPE, title: safeTitle, sourceTitle: safeTitle })
    await cards.persist(next)
    cards.apply()
  }

  const savePatch = async (cardId, patch) => {
    const next = [...cards.list()]
    const index = next.findIndex((card) => card.id === cardId)
    if (index === -1) return
    next[index] = { ...next[index], ...patch }
    await cards.persist(next)
    cards.apply()
  }

  /**
   * 弹窗提交：编辑态先失效旧来源缓存再改来源，新增态直接追加卡片。
   */
  const submitModal = async () => {
    const select = $('#hotSourceSelect')
    if (!select) return
    const safeTitle = normalizeSource(String(select.value || DEFAULT_SOURCE))
    if (modalMode === 'edit' && editingCardId) {
      const previous = cards.getById(editingCardId)
      if (previous) await client.invalidate(getSourceTitle(previous))
      await savePatch(editingCardId, { title: safeTitle, sourceTitle: safeTitle })
    } else {
      await addComponent(safeTitle)
    }
    closeModal()
  }

  /**
   * 按白名单生成下拉选项：HTML 只保留空容器，避免来源列表出现第二份真源。
   */
  const fillSourceOptions = () => {
    const select = $('#hotSourceSelect')
    if (!select) return
    select.innerHTML = HOT_SOURCES.map(
      (source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`
    ).join('')
    select.value = normalizeSource(select.value)
  }

  /**
   * 绑定热搜弹窗自身的元素；新增按钮由页面的组件列表统一处理。
   */
  const bindModalUi = () => {
    const overlay = $('#hotOverlay')
    const closeBtn = $('#hotCloseBtn')
    const cancelBtn = $('#hotCancelBtn')
    const form = $('#hotForm')

    fillSourceOptions()

    overlay?.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal()
    })
    closeBtn?.addEventListener('click', closeModal)
    cancelBtn?.addEventListener('click', closeModal)
    form?.addEventListener('submit', async (evt) => {
      evt.preventDefault()
      await submitModal()
    })
  }

  return { renderHtml, initialize, handleClick, refresh, openModal, closeModal, bindModalUi }
}
