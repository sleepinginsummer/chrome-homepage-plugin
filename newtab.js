const $ = (selector) => document.querySelector(selector)

import { runStartupSync } from './sync-startup.js'
import { DEFAULT_SYNC_PATH, normalizeSyncDraft, tryParseGitRemote } from './remote-sync.js'
import { getDict, applyTranslations, getMetalsText, getStockText, getWeatherText } from './i18n.js'
import { createExtensionApiClient } from './extension-api.js'
import { createHotCardController } from './hot-card-controller.js'
import { createWeatherCardController } from './weather-card-controller.js'
import { createStockCardController } from './stock-card-controller.js'
import { createMetalsCardController } from './metals-card-controller.js'
import { createAnniversaryCardController } from './anniversary-card-controller.js'
import { createSearchController } from './search-controller.js'
import { createAutoPush } from './auto-push.js'
import { createSettingsModal } from './settings-modal.js'
import { createCardUi } from './card-ui.js'
import { createCardGrid } from './card-grid.js'
import { createLinkCardController } from './link-card-controller.js'
import { applyTheme, getConfigTheme } from './theme.js'
import { initThemeController } from './theme-controller.js'

const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

const state = {
  config: null,
  contextCardId: null,
  confirmAction: null
}
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
const saveConfig = async (patch) => {
  const res = await send({ type: 'setConfig', data: patch })
  if (!res?.ok) throw new Error(res?.error || '保存失败')
  state.config = res.data
  return res.data
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
    cardGrid.render()
    autoPushScheduler.schedule()
  },
  schedulePush: () => autoPushScheduler.schedule()
}

/** 打开卡片弹窗前统一收起其它浮层（组件列表 + 卡片菜单）。 */
const closeCardOverlays = () => {
  cardUi.closeComponentList()
  cardUi.closeMenu()
}

/**
 * 天气卡片控制器：渲染、拉取、刷新与增删改弹窗都在 weather-card-controller 内完成。
 */
/**
 * 卡片类型注册表：网格只认这份表，各域提供渲染、初始化、点击与回收。
 * link 不提供 handleClick，点击按 url 打开。
 */
const cardRegistry = {
  anniversary: {
    className: 'card card-anniversary',
    render: (card, div) => {
      div.innerHTML = anniversaryCard.renderHtml(card)
    },
    handleClick: (card) => anniversaryCard.openModal(card.id)
  },
  hot: {
    className: 'card card-hot',
    render: (card, div) => {
      div.innerHTML = hotCard.renderHtml(card)
    },
    initialize: (card, div) => hotCard.initialize(card, div),
    handleClick: (card, evt) => hotCard.handleClick(card, evt)
  },
  stock: {
    className: 'card card-stock',
    render: (card, div) => {
      div.innerHTML = stockCard.renderHtml(card)
    },
    poll: { tokenDatasetKey: 'stockRenderToken', loadData: (card, options) => stockCard.loadData(card, options) },
    handleClick: (card, evt) => stockCard.handleClick(card, evt)
  },
  metals: {
    className: 'card card-metals',
    render: (card, div) => {
      div.innerHTML = metalsCard.renderHtml(card)
    },
    poll: { tokenDatasetKey: 'metalsRenderToken', loadData: (card, options) => metalsCard.loadData(card, options) },
    handleClick: (card, evt) => metalsCard.handleClick(card, evt)
  },
  weather: {
    className: 'card card-weather',
    render: (card, div) => {
      div.innerHTML = weatherCard.renderHtml(card)
    },
    initialize: (card, div) => weatherCard.initialize(card, div),
    handleClick: (card, evt) => weatherCard.handleClick(card, evt),
    cleanup: (card, remainingCards) => weatherCard.cleanup(card, remainingCards)
  },
  link: {
    className: 'card',
    render: (card, div) => linkCard.render(card, div)
  }
}

/** 卡片网格：渲染、点击分发、资源回收与拖拽排序。 */
const cardGrid = createCardGrid({
  cards: cardRepository,
  registry: cardRegistry,
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  onContextMenu: ({ x, y, cardId }) => cardUi.openMenu({ x, y, cardId }),
  onAddCard: () => cardUi.openAddChooser(),
  onDragError: (error) => console.error('[chrome-home] card reorder failed', error)
})

/** 链接卡片控制器：卡面图标加载与新增/修改弹窗。 */
const linkCard = createLinkCardController({
  cards: cardRepository,
  runtimeGetURL: chrome.runtime?.getURL?.bind(chrome.runtime),
  setError,
  closeOverlays: closeCardOverlays
})

const weatherCard = createWeatherCardController({
  storage: chrome.storage.local,
  getLang,
  getText: () => getWeatherText(getLang()),
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
  getText: () => getStockText(getLang()),
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  confirm: (options) => cardUi.openConfirm(options),
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
  getText: () => getMetalsText(getLang()),
  openUrl: (url) => send({ type: 'openTabsInNewActive', urls: [url] }),
  send,
  cards: cardRepository
})

/** 纪念日卡片控制器：日期计算与卡片/弹窗渲染都在 anniversary 系列模块内完成。 */
const anniversaryCard = createAnniversaryCardController({
  confirm: (options) => cardUi.openConfirm(options),
  setError,
  closeOverlays: closeCardOverlays,
  cards: cardRepository
})

/** 搜索与历史控制器：引擎选择、发起搜索、历史侧栏都在 search-controller 内完成。 */
/** 卡片浮层：菜单、确认、新增选择器与组件列表（放在各域控制器之后创建：domains 需要真实的控制器实例）。 */
const cardUi = createCardUi({
  getCardById,
  onDeleteCard: (id) => cardGrid.deleteCard(id),
  setError,
  domains: { link: linkCard, weather: weatherCard, hot: hotCard, stock: stockCard, metals: metalsCard, anniversary: anniversaryCard }
})

const searchController = createSearchController({
  getConfig: () => state.config,
  applyConfig: (next) => {
    state.config = next
  },
  saveConfig,
  send,
  setError,
  afterConfigChange: () => autoPushScheduler.schedule()
})

/** 自动推送调度：配置变更后延迟推送，页面只提供状态提示与收尾。 */
const autoPushScheduler = createAutoPush({
  getConfig: () => state.config,
  normalizeSync: normalizeSyncDraft,
  pushRemote: send,
  setStatus: setSyncStatus,
  afterPush: (lastSyncAt) => renderLastSyncAt(lastSyncAt)
})

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
  cardGrid.initDrag()
  cardGrid.render()
  searchController.bindSearchForm()
  initBlankClickFocus()
  searchController.bindHistoryUi()
  cardUi.init()

  // 设置面板要用到主题控制器与各域刷新，放在 main 里创建。
  const settingsModal = createSettingsModal({
    getConfig: () => state.config,
    applyConfig: (next) => {
      state.config = next
    },
    saveConfig,
    send,
    setStatus: setSyncStatus,
    renderLastSyncAt,
    applyLanguage,
    theme: themeController,
    onRemoteConfigApplied: () => {
      themeController.applyCurrent()
      applyLanguage()
      searchController.renderEngines()
      searchController.renderHistory()
      cardGrid.render()
    },
    onSyncFormChanged: () => autoPushScheduler.schedule(),
    getLang
  })
  settingsModal.init()
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
