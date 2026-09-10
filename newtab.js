const $ = (selector) => document.querySelector(selector)

import { runStartupSync } from './sync-startup.js'
import { DEFAULT_SYNC_PATH, normalizeSyncDraft, tryParseGitRemote } from './remote-sync.js'
import { getDict, applyTranslations } from './i18n.js'
import { createExtensionApiClient } from './extension-api.js'
import { createHotCardController } from './hot-card-controller.js'
import { createWeatherCardController } from './weather-card-controller.js'
import { createStockCardController } from './stock-card-controller.js'
import { createMetalsCardController } from './metals-card-controller.js'
import { createCardDragController } from './card-drag.js'
import { createCardIconCandidates, getCardInitial, loadCardIcon } from './card-icon.js'
import { normalizeCardUrl } from './url-utils.js'
import { applyTheme, getConfigTheme } from './theme.js'
import { initThemeController } from './theme-controller.js'

const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

const state = {
  config: null,
  isSearching: false,
  scrollProgress: 0,
  editingCardId: null,
  editingAnniversaryCardId: null,
  editingAnniversaryItemId: null,
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

const renderEngines = () => {
  const container = $('#engineSelection')
  container.innerHTML = ''
  for (const engine of state.config.engines) {
    const label = document.createElement('label')
    label.className = 'engine-checkbox'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = engine.name
    input.checked = state.config.selectedEngines.includes(engine.name)

    const checkbox = document.createElement('div')
    checkbox.className = 'checkbox-custom'
    checkbox.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `

    const name = document.createElement('span')
    name.className = 'engine-name'
    name.textContent = engine.name

    label.append(input, checkbox, name)
    container.appendChild(label)

    const syncActive = () => {
      label.classList.toggle('active', input.checked)
    }
    syncActive()

    input.addEventListener('change', async () => {
      const nextSelected = new Set(state.config.selectedEngines)
      if (input.checked) nextSelected.add(engine.name)
      else nextSelected.delete(engine.name)

      state.config.selectedEngines = [...nextSelected]
      syncActive()

      await saveConfig({ selectedEngines: state.config.selectedEngines })
      scheduleAutoPush()
    })
  }
}

const computeSearchUrls = (keyword, selectedEngines) => {
  const encoded = encodeURIComponent(keyword)
  const allowed = new Set(selectedEngines)
  return state.config.engines.filter((e) => allowed.has(e.name)).map((e) => `${e.baseUrl}${encoded}`)
}

const addToHistory = async (term) => {
  // 在存储层基于最新历史追加，避免多个新标签页拿旧数组互相覆盖。
  const res = await send({ type: 'addSearchHistory', keyword: term })
  if (!res?.ok) throw new Error(res?.error || '历史记录保存失败')
  state.config = res.data
  renderHistory()
}

const triggerSearch = async ({ shouldAddToHistory }) => {
  if (state.isSearching) return
  const keyword = $('#keywordInput').value.trim()
  if (!keyword) {
    setError('请输入关键词')
    return
  }
  const urls = computeSearchUrls(keyword, state.config.selectedEngines || [])
  if (!urls.length) {
    setError('请至少选择一个搜索引擎')
    return
  }
  setError('')

  state.isSearching = true
  try {
    // openTabs 会导航并卸载当前页面，必须先确认历史已持久化。
    if (shouldAddToHistory) await addToHistory(keyword)
    const res = await send({ type: 'openTabs', urls })
    if (!res?.ok) setError(res?.error || '打开标签页失败')
  } catch (err) {
    setError(err?.message || '搜索失败，请重试')
  } finally {
    state.isSearching = false
  }
}

const renderHistory = () => {
  const sidebar = $('#historySidebar')
  const footer = $('#historyFooter')
  const itemsRoot = $('#historyItems')
  itemsRoot.innerHTML = ''

  const history = state.config.searchHistory || []
  sidebar.classList.toggle('has-items', history.length > 0)
  footer.hidden = history.length === 0

  history.forEach((term, index) => {
    const div = document.createElement('div')
    div.className = 'history-item'
    div.dataset.index = String(index)
    div.innerHTML = `<span class="history-text"></span>`
    div.querySelector('.history-text').textContent = term
    div.addEventListener('click', async () => {
      $('#keywordInput').value = term
      await triggerSearch({ shouldAddToHistory: false })
      scrollHistoryToCenter(index)
    })
    itemsRoot.appendChild(div)
  })

  requestAnimationFrame(updateHistoryTransforms)
}

const scrollHistoryToCenter = (index) => {
  const list = $('#historyList')
  const itemHeight = 50
  const padding = 150
  const containerHeight = list.clientHeight
  const itemCenter = padding + index * itemHeight + itemHeight / 2
  const targetScrollTop = itemCenter - containerHeight / 2
  list.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
}

const updateHistoryTransforms = () => {
  const list = $('#historyList')
  const items = Array.from(document.querySelectorAll('.history-item'))
  const itemHeight = 50
  const padding = 150
  const maxDistance = 200

  const centerOffset = list.clientHeight / 2
  state.scrollProgress = list.scrollTop + centerOffset

  for (const div of items) {
    const index = Number(div.dataset.index || 0)
    const itemCenter = index * itemHeight + itemHeight / 2 + padding
    const distance = Math.abs(state.scrollProgress - itemCenter)
    const normalized = Math.min(distance, maxDistance) / maxDistance
    const scale = 1 - normalized * 0.3
    const opacity = 1 - normalized * 0.7
    const blur = normalized * 2
    div.style.transform = `scale(${scale})`
    div.style.opacity = String(opacity)
    div.style.filter = `blur(${blur}px)`
  }
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

  if (type === 'anniversary') div.innerHTML = renderAnniversaryCardHtml(card)
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
  anniversary: (card) => openAnniversaryModal(card.id),
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

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const createSafeDateAtNoon = (year, monthIndex, day) => {
  if (monthIndex === 1 && day === 29 && !isLeapYear(year)) {
    return new Date(year, monthIndex, 28, 12, 0, 0, 0)
  }
  return new Date(year, monthIndex, day, 12, 0, 0, 0)
}

const parseYmd = (ymd) => {
  const raw = String(ymd || '').trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const probe = new Date(year, month - 1, day)
  if (Number.isNaN(probe.getTime())) return null
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null
  return { year, month, day }
}

const formatMonthDay = ({ month, day }) => `${month}月${day}日`

const calcNextAnniversary = (ymd, now = new Date()) => {
  const parsed = parseYmd(ymd)
  if (!parsed) return null
  const nowNoon = createSafeDateAtNoon(now.getFullYear(), now.getMonth(), now.getDate())
  const thisYear = nowNoon.getFullYear()
  let nextYear = thisYear
  let occurrence = createSafeDateAtNoon(thisYear, parsed.month - 1, parsed.day)
  if (occurrence.getTime() < nowNoon.getTime()) {
    nextYear = thisYear + 1
    occurrence = createSafeDateAtNoon(nextYear, parsed.month - 1, parsed.day)
  }
  const days = Math.max(0, Math.round((occurrence.getTime() - nowNoon.getTime()) / 86400000))
  const years = Math.max(0, nextYear - parsed.year)
  return {
    days,
    years,
    month: parsed.month,
    day: parsed.day
  }
}

const sortAnniversaryItems = (items) => {
  const now = new Date()
  return [...items].sort((a, b) => {
    const da = calcNextAnniversary(a.date, now)
    const db = calcNextAnniversary(b.date, now)
    const aDays = da ? da.days : Number.POSITIVE_INFINITY
    const bDays = db ? db.days : Number.POSITIVE_INFINITY
    if (aDays !== bDays) return aDays - bDays
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}

const renderAnniversaryCardHtml = (card) => {
  const items = sortAnniversaryItems(Array.isArray(card.items) ? card.items : [])
  const featured = items[0]
  const featuredCalc = featured ? calcNextAnniversary(featured.date) : null
  const featuredTitle = featured?.title ? escapeHtml(featured.title) : ''
  const featuredDate = featuredCalc ? formatMonthDay(featuredCalc) : ''
  const daysText = featuredCalc ? String(featuredCalc.days) : '--'

  const mini = items.map((it) => {
    const c = calcNextAnniversary(it.date)
    const t = escapeHtml(String(it.title || ''))
    const date = c ? formatMonthDay(c) : ''
    const days = c ? `${c.days}天` : '--'
    const years = c ? `${c.years}周年` : ''
    return `
      <div class="anniversary-mini-item">
        <div class="left">
          <div class="mini-title">${t || '未命名'}</div>
          <div class="mini-date">${date || ''}</div>
        </div>
        <div class="right">
          <div class="years">${years}</div>
          <div class="mini-days">${days}</div>
        </div>
      </div>
    `
  })

  const empty = !items.length
  return `
    <div class="anniversary-card">
      <div class="anniversary-feature">
        <div>
          <div class="label">${empty ? '点击添加纪念日' : '下一个纪念日'}</div>
          <div class="title">${featuredTitle || (empty ? '' : '未命名')}</div>
        </div>
        <div class="countdown">
          <div class="days">${daysText}</div>
          <div class="unit">天</div>
        </div>
        <div class="date">${featuredDate}</div>
      </div>
      <div class="anniversary-list-mini">
        ${mini.join('')}
      </div>
    </div>
  `
}

const escapeHtml = (raw) =>
  String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

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

const addAnniversaryComponent = async () => {
  const next = [...(state.config.cards || [])]
  next.push({
    id: crypto.randomUUID(),
    type: 'anniversary',
    title: '纪念日',
    items: []
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
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

const closeAnniversaryModal = () => {
  $('#anniversaryOverlay').hidden = true
  state.editingAnniversaryCardId = null
  state.editingAnniversaryItemId = null
  $('#anniversaryTitleInput').value = ''
  $('#anniversaryDateInput').value = ''
}

const getCardById = (id) => (state.config.cards || []).find((c) => c.id === id) || null

const renderAnniversaryList = (card) => {
  const root = $('#anniversaryList')
  const items = sortAnniversaryItems(Array.isArray(card.items) ? card.items : [])
  if (!items.length) {
    root.innerHTML = '<div class="editor-empty">暂无纪念日，右侧新增一个吧</div>'
    return
  }

  root.innerHTML = items
    .map((it) => {
      const c = calcNextAnniversary(it.date)
      const title = escapeHtml(String(it.title || '未命名'))
      const date = c ? formatMonthDay(c) : ''
      const badge = c ? `${c.days}天` : '--'
      const years = c ? `${c.years}周年` : ''
      return `
        <div class="anniversary-list-item" data-item-id="${escapeHtml(it.id)}">
          <div class="meta">
            <div class="name">${title}</div>
            <div class="sub">${escapeHtml(date)} · ${escapeHtml(years)}</div>
          </div>
          <div class="actions">
            <div class="badge">${escapeHtml(badge)}</div>
            <button class="danger-btn" type="button" data-action="delete" data-item-id="${escapeHtml(it.id)}">删除</button>
          </div>
        </div>
      `
    })
    .join('')
}

const openAnniversaryModal = (cardId) => {
  const card = getCardById(cardId)
  if (!card) return
  if ((card.type || 'link') !== 'anniversary') return
  state.editingAnniversaryCardId = cardId
  state.editingAnniversaryItemId = null
  renderAnniversaryList(card)
  $('#anniversaryOverlay').hidden = false
  $('#anniversaryTitleInput').value = ''
  $('#anniversaryDateInput').value = ''
  closeCardMenu()
}

const saveAnniversaryCardPatch = async (cardId, patch) => {
  const next = [...(state.config.cards || [])]
  const index = next.findIndex((c) => c.id === cardId)
  if (index === -1) return
  next[index] = { ...next[index], ...patch }
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

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
      else if (!$('#anniversaryOverlay').hidden) closeAnniversaryModal()
      else if (!$('#hotOverlay').hidden) hotCard.closeModal()
      else if (!$('#stockOverlay').hidden) stockCard.closeModal()
      else if (!$('#componentListOverlay').hidden) closeComponentList()
      else if (!$('#addChooserOverlay').hidden) closeAddChooser()
    }
  })

  editBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    if ((card?.type || 'link') === 'anniversary') openAnniversaryModal(card.id)
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
    await addAnniversaryComponent()
  })
  componentWeatherBtn.addEventListener('click', () => weatherCard.openModal({ mode: 'create' }))

  hotCard.bindModalUi()

  weatherCard.bindModalUi()

  stockCard.bindModalUi()

  const anniversaryOverlay = $('#anniversaryOverlay')
  const anniversaryCloseBtn = $('#anniversaryCloseBtn')
  const anniversaryCancelBtn = $('#anniversaryCancelBtn')
  const anniversaryForm = $('#anniversaryForm')
  const anniversaryTitleInput = $('#anniversaryTitleInput')
  const anniversaryDateInput = $('#anniversaryDateInput')

  const openNativeDatePicker = () => {
    if (typeof anniversaryDateInput?.showPicker === 'function') {
      anniversaryDateInput.showPicker()
    }
  }
  anniversaryDateInput.addEventListener('click', openNativeDatePicker)
  anniversaryDateInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') openNativeDatePicker()
  })

  anniversaryOverlay.addEventListener('click', (evt) => {
    if (evt.target === anniversaryOverlay) closeAnniversaryModal()
  })
  anniversaryCloseBtn.addEventListener('click', closeAnniversaryModal)
  anniversaryCancelBtn.addEventListener('click', closeAnniversaryModal)

  $('#anniversaryList').addEventListener('click', async (evt) => {
    const target = evt.target
    const cardId = state.editingAnniversaryCardId
    if (!cardId) return
    const card = getCardById(cardId)
    if (!card) return

    const delBtn = target?.closest?.('button[data-action="delete"]')
    if (delBtn) {
      const itemId = delBtn.getAttribute('data-item-id')
      if (!itemId) return
      openConfirm({
        title: '确认删除',
        text: '确认删除该纪念日吗？',
        onConfirm: async () => {
          const items = Array.isArray(card.items) ? card.items : []
          const nextItems = items.filter((it) => it.id !== itemId)
          await saveAnniversaryCardPatch(cardId, { items: nextItems })
          const nextCard = getCardById(cardId)
          if (nextCard) renderAnniversaryList(nextCard)
        }
      })
      return
    }

    const itemEl = target?.closest?.('.anniversary-list-item')
    if (!itemEl) return
    const itemId = itemEl.getAttribute('data-item-id')
    const items = Array.isArray(card.items) ? card.items : []
    const item = items.find((it) => it.id === itemId)
    if (!item) return
    state.editingAnniversaryItemId = item.id
    anniversaryTitleInput.value = item.title || ''
    anniversaryDateInput.value = item.date || ''
  })

  anniversaryForm.addEventListener('submit', async (evt) => {
    evt.preventDefault()
    const cardId = state.editingAnniversaryCardId
    if (!cardId) return
    const card = getCardById(cardId)
    if (!card) return

    const title = anniversaryTitleInput.value.trim()
    const date = anniversaryDateInput.value.trim()
    if (!title) {
      setError('请输入标题')
      return
    }
    if (!parseYmd(date)) {
      setError('请选择合法日期')
      return
    }
    setError('')

    const items = Array.isArray(card.items) ? card.items : []
    const nextItems = [...items]
    const editingId = state.editingAnniversaryItemId
    if (editingId) {
      const index = nextItems.findIndex((it) => it.id === editingId)
      if (index !== -1) nextItems[index] = { ...nextItems[index], title, date }
      state.editingAnniversaryItemId = null
    } else {
      nextItems.unshift({ id: crypto.randomUUID(), title, date })
    }

    await saveAnniversaryCardPatch(cardId, { items: nextItems })
    const nextCard = getCardById(cardId)
    if (nextCard) renderAnniversaryList(nextCard)
    anniversaryTitleInput.value = ''
    anniversaryDateInput.value = ''
  })
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
    renderEngines()
    renderHistory()
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

const initHistory = () => {
  $('#clearHistoryBtn').addEventListener('click', async () => {
    try {
      await saveConfig({ searchHistory: [] })
      renderHistory()
      setError('')
    } catch (err) {
      setError(err?.message || '清空历史失败')
    }
  })
  $('#historyList').addEventListener('scroll', () => updateHistoryTransforms())
}

const initSearchForm = () => {
  $('#searchForm').addEventListener('submit', async (evt) => {
    evt.preventDefault()
    await triggerSearch({ shouldAddToHistory: true })
  })
  $('#keywordInput').addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      $('#keywordInput').value = ''
      setError('')
    }
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
      if (historyChanged) renderHistory()
    },
    getSaveErrorText: () => getDict().theme_save_error
  })
  applyLanguage()
  renderEngines()
  renderHistory()
  initCardDrag()
  renderCards()
  initSearchForm()
  initBlankClickFocus()
  initHistory()
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

main().catch((err) => setError(err?.message || String(err)))
