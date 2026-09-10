const $ = (selector) => document.querySelector(selector)

import { runStartupSync } from './sync-startup.js'
import { DEFAULT_SYNC_PATH, normalizeSyncDraft, tryParseGitRemote } from './remote-sync.js'
import { getDict, applyTranslations } from './i18n.js'
import { createExtensionApiClient } from './extension-api.js'
import { createHotCardController } from './hot-card-controller.js'
import { createWeatherCardController } from './weather-card-controller.js'
import { createStockCardController } from './stock-card-controller.js'
import { createMetalsCardController } from './metals-card-controller.js'
import { createAnniversaryCardController } from './anniversary-card-controller.js'
import { createSearchController } from './search-controller.js'
import { createCardDragController } from './card-drag.js'
import { createCardIconCandidates, getCardInitial, loadCardIcon } from './card-icon.js'
import { normalizeCardUrl } from './url-utils.js'
import { applyTheme, getConfigTheme } from './theme.js'
import { initThemeController } from './theme-controller.js'

const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

const state = {
  config: null,
  editingCardId: null,
  stockPollTimers: new Map(),
  metalsPollTimers: new Map(),
  iconLoadCleanups: new Set(),
  isDraggingCard: false,
  contextCardId: null,
  confirmAction: null
}
let cardDragController = null

/**
 * 扩展内部消息发送封装：
 * - 优先走 background/service worker
 * - 若短暂离线导致 “Receiving end does not exist”，自动切换到本地兜底（storage/tabs/fetch）
 */
let fallbackTipTimer = null
const apiClient = createExtensionApiClient({
  chromeApi: chrome,
  onFallback: (reason) => {
    // 重要逻辑：只做轻提示，不打断用户使用；并自动清空。
    setSyncStatus(`后台暂不可用，已切换本地模式（${reason}）`, 'info')
    if (fallbackTipTimer) clearTimeout(fallbackTipTimer)
    fallbackTipTimer = setTimeout(() => setSyncStatus(''), 3000)
  }
})
const send = (payload) => apiClient.send(payload)

const setSyncStatus = (text, kind = 'info') => {
  const status = $('#syncStatus')
  if (!status) return
  status.textContent = text || ''
  status.dataset.kind = kind
}

const getLang = () => (state.config?.ui?.language === 'en' ? 'en' : 'zh')

const formatSyncTime = (isoTime) => {
  if (!isoTime) return ''
  const date = new Date(isoTime)
  if (Number.isNaN(date.getTime())) return ''
  const locale = getLang() === 'en' ? 'en-US' : 'zh-CN'
  return date.toLocaleString(locale, { hour12: getLang() === 'en' })
}

const renderLastSyncAt = async (isoTime) => {
  const el = $('#syncLastSyncAt')
  if (!el) return

  const dict = getDict()
  const source = isoTime || (await chrome.storage.local.get(LAST_SYNC_AT_KEY))[LAST_SYNC_AT_KEY]
  const formatted = formatSyncTime(source)
  el.textContent = formatted ? `${dict.sync_last_sync_at} ${formatted}` : ''
}

const applyLanguage = () => {
  const lang = getLang()
  applyTranslations({ root: document, lang })
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  renderLastSyncAt()
}

const canAutoPush = (sync) => {
  if (!sync?.autoPush) return false
  const normalized = normalizeSyncDraft(sync)
  const required = ['gitUrl', 'token']
  return required.every((key) => Boolean(normalized[key]))
}

let autoPushTimer = null
let autoPushInProgress = false
let autoPushPending = false

const scheduleAutoPush = () => {
  if (!canAutoPush(state.config?.sync)) {
    if (state.config?.sync?.autoPush) {
      setSyncStatus('自动同步已开启，但同步配置不完整（需 gitUrl/token）', 'error')
    }
    return
  }

  if (autoPushTimer) clearTimeout(autoPushTimer)
  autoPushTimer = setTimeout(async () => {
    autoPushTimer = null
    if (autoPushInProgress) {
      autoPushPending = true
      return
    }

    autoPushInProgress = true
    try {
      setSyncStatus('自动同步中...')
      const pushed = await send({ type: 'pushRemote' })
      if (!pushed?.ok) {
        setSyncStatus(pushed?.error || '自动同步失败', 'error')
      } else {
        setSyncStatus('已自动同步', 'ok')
        await renderLastSyncAt(pushed?.lastSyncAt)
      }
    } finally {
      autoPushInProgress = false
      if (autoPushPending) {
        autoPushPending = false
        scheduleAutoPush()
      }
    }
  }, 1500)
}

const setError = (message) => {
  const box = $('#errorMessage')
  const text = $('#errorText')
  if (!message) {
    box.hidden = true
    text.textContent = ''
    return
  }
  box.hidden = false
  text.textContent = message
}

const normalizeUrl = normalizeCardUrl

const normalizeIconUrl = (raw) => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * 在浏览器空闲时执行任务；不支持 requestIdleCallback 时用 setTimeout 兜底。
 * 适用场景：启动同步/热搜拉取等非首屏关键路径任务。
 */
const runWhenIdle = (task, timeoutMs = 1200) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task?.(), { timeout: timeoutMs })
    return
  }
  // 重要逻辑：兜底路径尽量短，避免影响首屏。
  setTimeout(() => task?.(), Math.min(16, timeoutMs))
}

const renderCardBody = (card, div) => {
  const type = card?.type || 'link'
  const classNames = {
    anniversary: 'card card-anniversary',
    hot: 'card card-hot',
    stock: 'card card-stock',
    metals: 'card card-metals',
    weather: 'card card-weather'
  }
  div.className = classNames[type] || 'card'

  if (type === 'anniversary') div.innerHTML = anniversaryCard.renderHtml(card)
  else if (type === 'hot') div.innerHTML = hotCard.renderHtml(card)
  else if (type === 'stock') div.innerHTML = stockCard.renderHtml(card)
  else if (type === 'metals') div.innerHTML = metalsCard.renderHtml(card)
  else if (type === 'weather') div.innerHTML = weatherCard.renderHtml(card)
  else {
    div.innerHTML = `
      <div class="card-icon" aria-hidden="true">
        <span class="card-icon-fallback"></span>
        <img class="card-icon-image" alt="" />
      </div>
      <div class="card-title"></div>
    `
    const icon = div.querySelector('.card-icon')
    const image = div.querySelector('.card-icon-image')
    icon.querySelector('.card-icon-fallback').textContent = getCardInitial(card.title)
    image.decoding = 'async'
    image.loading = 'lazy'
    const candidates = createCardIconCandidates({
      pageUrl: card.url,
      customIcon: card.icon,
      runtimeGetURL: chrome.runtime?.getURL?.bind(chrome.runtime)
    })
    const cancelIconLoad = loadCardIcon(image, candidates, {
      timeoutMs: 5000,
      onLoaded: (_source, dimensions) => {
        const sourceSize = Math.min(dimensions.width, dimensions.height)
        icon.classList.toggle('is-low-resolution', sourceSize < 24)
        icon.classList.toggle('is-medium-resolution', sourceSize >= 24 && sourceSize < 48)
        icon.classList.add('has-image')
      }
    })
    state.iconLoadCleanups.add(cancelIconLoad)
    div.querySelector('.card-title').textContent = card.title
  }
}

const initializePollingCard = (card, div, { tokenDatasetKey, ensureData, timers }) => {
  const renderToken = crypto.randomUUID()
  div.dataset[tokenDatasetKey] = renderToken
  void ensureData(card, { cardEl: div, renderToken, forceRefresh: true })
  const timer = setInterval(() => {
    const latestCard = getCardById(card.id)
    if (!latestCard) return
    void ensureData(latestCard, {
      cardEl: div,
      renderToken: div.dataset[tokenDatasetKey],
      forceRefresh: true
    })
  }, STOCK_REFRESH_INTERVAL)
  timers.set(card.id, timer)
}

const initializeCardData = (card, div) => {
  const type = card?.type || 'link'
  if (type === 'hot') {
    hotCard.initialize(card, div)
    return
  }

  if (type === 'weather') {
    weatherCard.initialize(card, div)
    return
  }

  if (type === 'stock') {
    initializePollingCard(card, div, {
      tokenDatasetKey: 'stockRenderToken',
      ensureData: stockCard.loadData,
      timers: state.stockPollTimers
    })
    return
  }

  if (type === 'metals') {
    initializePollingCard(card, div, {
      tokenDatasetKey: 'metalsRenderToken',
      ensureData: metalsCard.loadData,
      timers: state.metalsPollTimers
    })
  }
}

const cardClickHandlers = {
  anniversary: (card) => anniversaryCard.openModal(card.id),
  hot: (card, evt) => hotCard.handleClick(card, evt),
  stock: (card, evt) => stockCard.handleClick(card, evt),
  weather: (card, evt) => weatherCard.handleClick(card, evt),
  metals: (card, evt) => metalsCard.handleClick(card, evt)
}

const handleCardClick = async (card, evt) => {
  if (state.isDraggingCard) return
  const handler = cardClickHandlers[card?.type || 'link']
  if (handler) {
    await handler(card, evt)
    return
  }
  await send({ type: 'openTabsInNewActive', urls: [card.url] })
}

const renderCards = () => {
  cardDragController?.cancel({ restore: false })
  for (const cancelIconLoad of state.iconLoadCleanups) cancelIconLoad()
  state.iconLoadCleanups.clear()
  const root = $('#cardsGrid')
  root.innerHTML = ''
  for (const timer of state.stockPollTimers.values()) clearInterval(timer)
  state.stockPollTimers.clear()
  for (const timer of state.metalsPollTimers.values()) clearInterval(timer)
  state.metalsPollTimers.clear()
  const cards = state.config.cards || []
  for (const card of cards) {
    const div = document.createElement('div')
    renderCardBody(card, div)
    div.draggable = true
    div.dataset.cardId = card.id

    div.addEventListener('click', (evt) => void handleCardClick(card, evt))

    div.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      openCardMenu({ x: evt.clientX, y: evt.clientY, cardId: card.id })
    })

    root.appendChild(div)
    initializeCardData(card, div)
  }

  const addCard = document.createElement('button')
  addCard.type = 'button'
  addCard.className = 'card card-add'
  addCard.innerHTML = `
    <svg class="card-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="12" y1="6" x2="12" y2="18"></line>
      <line x1="6" y1="12" x2="18" y2="12"></line>
    </svg>
  `
  addCard.addEventListener('click', () => openAddChooser())
  root.appendChild(addCard)
}
const saveConfig = async (patch) => {
  const res = await send({ type: 'setConfig', data: patch })
  if (!res?.ok) throw new Error(res?.error || '保存失败')
  state.config = res.data
  return res.data
}

const addCard = async ({ title, url, icon }) => {
  const next = [...(state.config.cards || [])]
  next.push({
    id: crypto.randomUUID(),
    title,
    url,
    ...(icon ? { icon } : {})
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

const updateCard = async ({ id, title, url, icon }) => {
  const next = [...(state.config.cards || [])]
  const index = next.findIndex((c) => c.id === id)
  if (index === -1) return
  const patch = { title, url }
  if (icon) patch.icon = icon
  else delete next[index].icon
  next[index] = { ...next[index], ...patch }
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

const persistCardOrder = async (orderedIds) => {
  const cards = state.config.cards || []
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const orderedCards = orderedIds.map((id) => cardsById.get(id)).filter(Boolean)
  const orderedIdSet = new Set(orderedIds)
  const next = [...orderedCards, ...cards.filter((card) => !orderedIdSet.has(card.id))]
  if (next.every((card, index) => card.id === cards[index]?.id)) return
  await saveConfig({ cards: next })
  scheduleAutoPush()
}

const initCardDrag = () => {
  if (cardDragController) return
  cardDragController = createCardDragController({
    root: $('#cardsGrid'),
    onCommit: persistCardOrder,
    onDragStateChange: (isDragging) => { state.isDraggingCard = isDragging },
    onError: (error) => {
      console.error('[chrome-home] card reorder failed', error)
      renderCards()
    }
  })
}

const cardCleanupHandlers = {
  weather: (card, remainingCards) => weatherCard.cleanup(card, remainingCards)
}

const cleanupCardResources = async (card, remainingCards) => {
  const cleanup = cardCleanupHandlers[card?.type || 'link']
  if (cleanup) await cleanup(card, remainingCards)
}

const deleteCard = async (id) => {
  const cards = state.config.cards || []
  const removedCard = cards.find((card) => card.id === id)
  const next = cards.filter((card) => card.id !== id)
  state.config.cards = next
  await saveConfig({ cards: next })
  if (removedCard) await cleanupCardResources(removedCard, next)
  renderCards()
  scheduleAutoPush()
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const closeCardMenu = () => {
  const menu = $('#cardMenu')
  menu.hidden = true
  state.contextCardId = null
}

const openCardMenu = ({ x, y, cardId }) => {
  const menu = $('#cardMenu')
  state.contextCardId = cardId
  menu.hidden = false

  menu.style.left = `${x}px`
  menu.style.top = `${y}px`

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect()
    const maxLeft = window.innerWidth - rect.width - 8
    const maxTop = window.innerHeight - rect.height - 8
    menu.style.left = `${clamp(x, 8, maxLeft)}px`
    menu.style.top = `${clamp(y, 8, maxTop)}px`
  })
}

const openConfirm = ({ title, text, onConfirm }) => {
  const overlay = $('#confirmOverlay')
  $('#confirmTitle').textContent = title
  $('#confirmText').textContent = text
  state.confirmAction = onConfirm
  overlay.hidden = false
  closeCardMenu()
}

const closeConfirm = () => {
  $('#confirmOverlay').hidden = true
  state.confirmAction = null
}

const openCardModal = ({ mode, card }) => {
  const overlay = $('#cardModalOverlay')
  const title = $('#cardModalTitle')
  const titleInput = $('#cardModalTitleInput')
  const urlInput = $('#cardModalUrlInput')
  const iconInput = $('#cardModalIconInput')

  state.editingCardId = mode === 'edit' ? card.id : null
  title.textContent = mode === 'edit' ? '修改卡片' : '新增卡片'
  titleInput.value = mode === 'edit' ? card.title : ''
  urlInput.value = mode === 'edit' ? card.url : ''
  iconInput.value = mode === 'edit' ? card.icon || '' : ''

  setError('')
  overlay.hidden = false
  closeCardMenu()
  requestAnimationFrame(() => titleInput.focus())
}

const closeCardModal = () => {
  $('#cardModalOverlay').hidden = true
  state.editingCardId = null
  setError('')
}

const openAddChooser = () => {
  setError('')
  $('#addChooserOverlay').hidden = false
}

const closeAddChooser = () => {
  $('#addChooserOverlay').hidden = true
}

const openComponentList = () => {
  closeAddChooser()
  $('#componentListOverlay').hidden = false
}

const closeComponentList = () => {
  $('#componentListOverlay').hidden = true
}

const STOCK_REFRESH_INTERVAL = 60 * 1000

/**
 * 获取股票相关文案（随语言切换）。
 */
const getStockText = () => {
  const dict = getDict()
  return {
    liveLabel: dict.stock_live_label || '实时行情',
    updatedAt: dict.stock_updated_at || '更新于',
    loading: dict.stock_loading || '加载中...',
    empty: dict.stock_no_data || '暂无数据',
    error: dict.stock_error || '加载失败，点击刷新重试'
  }
}

/**
 * 获取黄金白银卡片相关文案。
 *
 * @returns {{title: string, gold: string, silver: string, usd: string, cny: string, loading: string, error: string}}
 */
const getMetalsText = () => {
  const dict = getDict()
  return {
    title: dict.metals_title || '黄金白银',
    gold: dict.metals_gold || '国际金价',
    silver: dict.metals_silver || '国际银价',
    usd: dict.metals_usd || '美元',
    cny: dict.metals_cny || '人民币',
    loading: dict.metals_loading || '加载中...',
    error: dict.metals_error || '加载失败，点击刷新重试'
  }
}

const getWeatherText = () => {
  const dict = getDict()
  return {
    title: dict.weather_title || '天气',
    loading: dict.weather_loading || '正在获取天气...',
    error: dict.weather_error || '天气加载失败，点击刷新重试',
    empty: dict.weather_empty || '暂无天气数据',
    humidity: dict.weather_humidity || '湿度',
    updatedAt: dict.weather_updated_at || '更新于',
    refresh: dict.weather_refresh || '刷新天气'
  }
}

const getCardById = (id) => (state.config.cards || []).find((c) => c.id === id) || null

/**
 * 卡片仓储门面：卡片域的读写、重渲染与自动推送顺序只在这里维护一份，
 * 由各域控制器注入使用（放在这里定义是因为它依赖的函数都在上方）。
 */
const cardRepository = {
  list: () => state.config.cards || [],
  getById: getCardById,
  persist: async (next) => {
    state.config.cards = next
    await saveConfig({ cards: next })
  },
  apply: () => {
    renderCards()
    scheduleAutoPush()
  }
}

/** 打开卡片弹窗前统一收起其它浮层（组件列表 + 卡片菜单）。 */
const closeCardOverlays = () => {
  closeComponentList()
  closeCardMenu()
}

/**
 * 天气卡片控制器：渲染、拉取、刷新与增删改弹窗都在 weather-card-controller 内完成。
 */
const weatherCard = createWeatherCardController({
  storage: chrome.storage.local,
  getLang,
  getText: getWeatherText,
  runWhenIdle,
  closeOverlays: closeCardOverlays,
  cards: cardRepository
})

/** 热搜卡片控制器：渲染、拉取、刷新与增删改弹窗都在 hot-card-controller 内完成。 */
const hotCard = createHotCardController({
  getLang,
  runWhenIdle,
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  closeOverlays: closeCardOverlays,
  cards: cardRepository
})

/**
 * 股票卡片控制器：行情缓存、刷新与增删改弹窗都在 stock-card-controller 内完成。
 * 定时轮询仍由页面的 initializePollingCard 统一调度（与贵金属共用）。
 */
const stockCard = createStockCardController({
  getLang,
  getText: getStockText,
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  confirm: openConfirm,
  setError,
  closeOverlays: closeCardOverlays,
  cards: cardRepository
})

/**
 * 黄金白银卡片控制器：报价缓存、刷新、点击与新增组件都在 metals-card-controller 内完成。
 * 定时轮询仍由页面的 initializePollingCard 统一调度（与股票共用）。
 */
const metalsCard = createMetalsCardController({
  getLang,
  getText: getMetalsText,
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  send,
  cards: cardRepository
})

/** 纪念日卡片控制器：日期计算与卡片/弹窗渲染都在 anniversary 系列模块内完成。 */
const anniversaryCard = createAnniversaryCardController({
  confirm: openConfirm,
  setError,
  closeOverlays: closeCardOverlays,
  cards: cardRepository
})

/** 搜索与历史控制器：引擎选择、发起搜索、历史侧栏都在 search-controller 内完成。 */
const searchController = createSearchController({
  getConfig: () => state.config,
  applyConfig: (next) => {
    state.config = next
  },
  saveConfig,
  send,
  setError,
  afterConfigChange: scheduleAutoPush
})

const initCardUi = () => {
  const menu = $('#cardMenu')
  const editBtn = $('#cardMenuEditBtn')
  const deleteBtn = $('#cardMenuDeleteBtn')

  const overlay = $('#cardModalOverlay')
  const form = $('#cardModalForm')
  const closeBtn = $('#cardModalCloseBtn')
  const cancelBtn = $('#cardModalCancelBtn')
  const titleInput = $('#cardModalTitleInput')
  const urlInput = $('#cardModalUrlInput')
  const iconInput = $('#cardModalIconInput')

  const confirmOverlay = $('#confirmOverlay')
  const confirmClose = $('#confirmCloseBtn')
  const confirmOk = $('#confirmOkBtn')
  const confirmCancel = $('#confirmCancelBtn')

  document.addEventListener('click', (evt) => {
    if (menu.hidden) return
    if (menu.contains(evt.target)) return
    closeCardMenu()
  })

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      if (!menu.hidden) closeCardMenu()
      else if (!confirmOverlay.hidden) closeConfirm()
      else if (!overlay.hidden) closeCardModal()
      else if (!$('#anniversaryOverlay').hidden) anniversaryCard.closeModal()
      else if (!$('#hotOverlay').hidden) hotCard.closeModal()
      else if (!$('#stockOverlay').hidden) stockCard.closeModal()
      else if (!$('#componentListOverlay').hidden) closeComponentList()
      else if (!$('#addChooserOverlay').hidden) closeAddChooser()
    }
  })

  editBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    if ((card?.type || 'link') === 'anniversary') anniversaryCard.openModal(card.id)
    else if ((card?.type || 'link') === 'hot') hotCard.openModal({ mode: 'edit', cardId: card.id })
    else if ((card?.type || 'link') === 'stock') stockCard.openModal({ mode: 'edit', cardId: card.id })
    else if ((card?.type || 'link') === 'weather') weatherCard.openModal({ mode: 'edit', cardId: card.id })
    else if ((card?.type || 'link') === 'metals') closeCardMenu()
    else openCardModal({ mode: 'edit', card })
  })

  deleteBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    openConfirm({
      title: '确认删除',
      text: `确认删除卡片「${card.title}」吗？`,
      onConfirm: async () => {
        await deleteCard(card.id)
      }
    })
  })

  overlay.addEventListener('click', (evt) => {
    if (evt.target === overlay) closeCardModal()
  })

  closeBtn.addEventListener('click', closeCardModal)
  cancelBtn.addEventListener('click', closeCardModal)

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault()
    const title = titleInput.value.trim()
    const url = normalizeUrl(urlInput.value)
    const icon = normalizeIconUrl(iconInput.value)
    if (!title) {
      setError('请输入标题')
      return
    }
    try {
      new URL(url)
    } catch {
      setError('请输入合法网址')
      return
    }

    setError('')
    if (iconInput.value.trim() && !icon) {
      setError('Icon 请输入合法 URL（http/https），或留空')
      return
    }

    if (state.editingCardId) await updateCard({ id: state.editingCardId, title, url, icon })
    else await addCard({ title, url, icon })
    closeCardModal()
  })

  confirmOverlay.addEventListener('click', (evt) => {
    if (evt.target === confirmOverlay) closeConfirm()
  })
  confirmClose.addEventListener('click', closeConfirm)
  confirmCancel.addEventListener('click', closeConfirm)
  confirmOk.addEventListener('click', async () => {
    const action = state.confirmAction
    closeConfirm()
    if (action) await action()
  })

  const addChooserOverlay = $('#addChooserOverlay')
  const addChooserClose = $('#addChooserCloseBtn')
  const addChooserCard = $('#addChooserCardBtn')
  const addChooserComponent = $('#addChooserComponentBtn')
  addChooserOverlay.addEventListener('click', (evt) => {
    if (evt.target === addChooserOverlay) closeAddChooser()
  })
  addChooserClose.addEventListener('click', closeAddChooser)
  addChooserCard.addEventListener('click', () => {
    closeAddChooser()
    openCardModal({ mode: 'create' })
  })
  addChooserComponent.addEventListener('click', openComponentList)

  const componentListOverlay = $('#componentListOverlay')
  const componentListClose = $('#componentListCloseBtn')
  const componentHotBtn = $('#componentHotBtn')
  const componentStockBtn = $('#componentStockBtn')
  const componentMetalsBtn = $('#componentMetalsBtn')
  const componentAnniversaryBtn = $('#componentAnniversaryBtn')
  const componentWeatherBtn = $('#componentWeatherBtn')
  componentListOverlay.addEventListener('click', (evt) => {
    if (evt.target === componentListOverlay) closeComponentList()
  })
  componentListClose.addEventListener('click', closeComponentList)
  componentHotBtn.addEventListener('click', () => hotCard.openModal({ mode: 'create' }))
  componentStockBtn.addEventListener('click', () => stockCard.openModal({ mode: 'create' }))
  componentMetalsBtn.addEventListener('click', async () => {
    closeComponentList()
    await metalsCard.addComponent()
  })
  componentAnniversaryBtn.addEventListener('click', async () => {
    closeComponentList()
    await anniversaryCard.addComponent()
  })
  componentWeatherBtn.addEventListener('click', () => weatherCard.openModal({ mode: 'create' }))

  hotCard.bindModalUi()

  weatherCard.bindModalUi()

  stockCard.bindModalUi()

  anniversaryCard.bindModalUi()
}

const initSettingsModal = (themeController) => {
  const overlay = $('#settingsOverlay')
  const openBtn = $('#openSettingsBtn')
  const closeBtn = $('#settingsCloseBtn')
  const title = $('#settingsTitle')
  const status = $('#syncStatus')

  const setStatus = (text, kind = 'info') => {
    status.textContent = text || ''
    status.dataset.kind = kind
  }

  const getFormSync = () => ({
    ...(() => {
      const gitUrl = $('#syncGitUrl').value.trim()
      const parsed = tryParseGitRemote(gitUrl)
      return {
        gitUrl,
        ...(parsed?.provider === 'gitee_gist'
          ? { provider: parsed.provider, gistId: parsed.gistId }
          : {})
      }
    })(),
    token: $('#syncToken').value.trim(),
    autoPush: Boolean($('#syncAutoPush')?.checked),
    path: DEFAULT_SYNC_PATH
  })

  const setFormSync = (sync) => {
    const normalized = normalizeSyncDraft(sync)
    $('#syncGitUrl').value = normalized.gitUrl || ''
    $('#syncToken').value = normalized.token || ''
    const autoPush = $('#syncAutoPush')
    if (autoPush) autoPush.checked = Boolean(normalized.autoPush)
    const autoPushLabel = autoPush?.closest('.engine-checkbox')
    if (autoPushLabel) autoPushLabel.classList.toggle('active', Boolean(autoPush?.checked))
  }

  const disableSyncActions = (disabled) => {
    for (const id of ['syncSaveBtn', 'syncPushBtn', 'syncPullBtn', 'syncTestBtn']) {
      $(`#${id}`).disabled = disabled
    }
  }

  const open = () => {
    overlay.hidden = false
    setStatus('')
    setFormSync(state.config.sync || {})
    renderLastSyncAt()
    const lang = $('#languageSelect')
    if (lang) lang.value = getLang()
    themeController.syncRadios()
    themeController.setStatus('')
    selectTab('appearance')
    requestAnimationFrame(() => $('#settingsTabAppearance')?.focus())
  }

  const close = () => {
    const wasOpen = !overlay.hidden
    overlay.hidden = true
    setStatus('')
    if (wasOpen) requestAnimationFrame(() => openBtn.focus())
  }

  const selectTab = (tab) => {
    for (const btn of document.querySelectorAll('.settings-item')) {
      const active = btn.dataset.tab === tab
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-selected', String(active))
      btn.tabIndex = active ? 0 : -1
    }
    $('#settingsPanelAppearance').hidden = tab !== 'appearance'
    $('#settingsPanelSync').hidden = tab !== 'sync'
    $('#settingsPanelLanguage').hidden = tab !== 'language'
    $('#settingsPanelAbout').hidden = tab !== 'about'
    const dict = getDict()
    const titleByTab = {
      appearance: dict.settings_appearance,
      sync: dict.settings_sync,
      language: dict.settings_language,
      about: dict.settings_about
    }
    title.textContent = titleByTab[tab] || dict.settings_appearance
  }

  openBtn.addEventListener('click', open)
  closeBtn.addEventListener('click', close)

  overlay.addEventListener('click', (evt) => {
    if (evt.target === overlay) close()
  })

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && !overlay.hidden) close()
  })

  for (const btn of document.querySelectorAll('.settings-item')) {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab))
    btn.addEventListener('keydown', (evt) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(evt.key)) return
      const tabs = [...document.querySelectorAll('.settings-item')]
      const currentIndex = tabs.indexOf(btn)
      const direction = ['ArrowDown', 'ArrowRight'].includes(evt.key) ? 1 : -1
      const nextIndex = evt.key === 'Home'
        ? 0
        : evt.key === 'End'
          ? tabs.length - 1
          : (currentIndex + direction + tabs.length) % tabs.length
      evt.preventDefault()
      selectTab(tabs[nextIndex].dataset.tab)
      tabs[nextIndex].focus()
    })
  }

  const languageSelect = $('#languageSelect')
  if (languageSelect) {
    languageSelect.addEventListener('change', async () => {
      const next = languageSelect.value === 'en' ? 'en' : 'zh'
      state.config.ui = { ...(state.config.ui || {}), language: next }
      await saveConfig({ ui: state.config.ui })
      applyLanguage()
      selectTab('language')
    })
  }

  $('#syncSaveBtn').addEventListener('click', async () => {
    disableSyncActions(true)
    setStatus('保存中...')
    const saved = await send({ type: 'setConfig', data: { sync: getFormSync() } })
    disableSyncActions(false)
    if (!saved?.ok) {
      setStatus(saved?.error || '保存失败', 'error')
      return
    }
    state.config = saved.data
    setStatus('已保存', 'ok')
  })

  $('#syncPushBtn').addEventListener('click', async () => {
    disableSyncActions(true)
    setStatus('推送中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pushed = await send({ type: 'pushRemote' })
    disableSyncActions(false)
    if (!pushed?.ok) {
      setStatus(pushed?.error || '推送失败', 'error')
      return
    }
    setStatus('推送成功', 'ok')
    await renderLastSyncAt(pushed?.lastSyncAt)
  })

  $('#syncPullBtn').addEventListener('click', async () => {
    disableSyncActions(true)
    setStatus('拉取中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pulled = await send({ type: 'pullRemote' })
    disableSyncActions(false)
    if (!pulled?.ok) {
      setStatus(pulled?.error || '拉取失败', 'error')
      return
    }
    state.config = pulled.data
    themeController.applyCurrent()
    setFormSync(pulled.data.sync || {})
    setStatus('拉取成功，已写入本地配置', 'ok')
    await renderLastSyncAt(pulled?.lastSyncAt)

    applyLanguage()
    searchController.renderEngines()
    searchController.renderHistory()
    renderCards()
  })

  $('#syncTestBtn').addEventListener('click', async () => {
    disableSyncActions(true)
    setStatus('测试中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const tested = await send({ type: 'testRemote' })
    disableSyncActions(false)
    if (!tested?.ok) {
      setStatus(tested?.error || '测试失败', 'error')
      return
    }
    setStatus('连接正常', 'ok')
  })

  const syncAutoPushLabel = $('#syncAutoPush')?.closest('.engine-checkbox')
  const syncAutoPushActive = () => {
    if (!syncAutoPushLabel) return
    syncAutoPushLabel.classList.toggle('active', Boolean($('#syncAutoPush')?.checked))
  }
  syncAutoPushActive()
  $('#syncAutoPush')?.addEventListener('change', async () => {
    syncAutoPushActive()
    const saved = await send({ type: 'setConfig', data: { sync: getFormSync() } })
    if (saved?.ok) state.config = saved.data
    scheduleAutoPush()
  })
}

/**
 * 点击空白区域时将焦点移动到搜索输入框。
 */
const initBlankClickFocus = () => {
  document.addEventListener('click', (evt) => {
    const target = evt.target
    if (!(target instanceof Element)) return
    if (target.closest('.search-form')) return
    if (target.closest('input, textarea, select, button, a, label, [contenteditable="true"]')) return
    if (target.closest('.cards-section, .history-sidebar, .card, .card-menu, .modal-overlay, .settings-overlay')) return

    const settingsOverlay = $('#settingsOverlay')
    if (settingsOverlay && !settingsOverlay.hasAttribute('hidden') && target.closest('#settingsOverlay')) return

    // 点击空白区域时，主动聚焦搜索框
    $('#keywordInput')?.focus()
  })
}

const main = async () => {
  const res = await send({ type: 'getConfig' })
  state.config = res?.data

  // 首屏先按缓存/配置应用主题，避免主题闪回；面板与订阅交给 theme-controller。
  applyTheme(getConfigTheme(state.config))
  const themeController = initThemeController({
    chromeApi: chrome,
    getConfig: () => state.config,
    saveTheme: async (theme) => {
      const saved = await send({
        type: 'setConfig',
        data: { ui: { ...(state.config.ui || {}), theme } }
      })
      if (!saved?.ok) throw new Error(saved?.error || '保存主题失败')
      state.config = saved.data
    },
    onConfigChange: (theme, nextConfig) => {
      if (!state.config) return
      const historyChanged = JSON.stringify(state.config.searchHistory) !== JSON.stringify(nextConfig.searchHistory)
      state.config = {
        ...state.config,
        searchHistory: nextConfig.searchHistory || [],
        ui: { ...(nextConfig.ui || {}), theme }
      }
      if (historyChanged) searchController.renderHistory()
    },
    getSaveErrorText: () => getDict().theme_save_error
  })
  applyLanguage()
  searchController.renderEngines()
  searchController.renderHistory()
  initCardDrag()
  renderCards()
  searchController.bindSearchForm()
  initBlankClickFocus()
  searchController.bindHistoryUi()
  initCardUi()
  initSettingsModal(themeController)
  $('#keywordInput').focus()

  // 性能优化：启动同步属于非首屏关键路径任务，延迟到空闲时执行，避免“打开新标签页时卡顿”。
  runWhenIdle(async () => {
    // 启动时若开启自动同步，执行一次拉取 + 推送。
    await runStartupSync({
      sync: normalizeSyncDraft(state.config?.sync),
      send,
      setStatus: setSyncStatus,
      renderLastSyncAt
    })
  }, 1500)
}

// 测试环境（node）没有 document，只加载模块定义、不跑页面入口。
if (typeof document !== 'undefined') main().catch((err) => setError(err?.message || String(err)))
