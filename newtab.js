const $ = (selector) => document.querySelector(selector)

import { runStartupSync } from './sync-startup.js'
import { createExtensionApiClient } from './extension-api.js'

const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

const state = {
  config: null,
  pendingSearch: null,
  scrollProgress: 0,
  editingCardId: null,
  editingAnniversaryCardId: null,
  editingAnniversaryItemId: null,
  editingHotCardId: null,
  hotModalMode: 'create',
  hotCache: new Map(),
  stockCache: new Map(),
  stockPollTimers: new Map(),
  metalsCache: new Map(),
  metalsPollTimers: new Map(),
  stockModalMode: 'create',
  editingStockCardId: null,
  editingStockSymbol: null,
  hotPendingRequests: new Map(),
  isDraggingCard: false,
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
  if (kind === 'error') status.style.color = '#ff4848'
  else if (kind === 'ok') status.style.color = '#00f2ff'
  else status.style.color = 'rgba(255,255,255,0.7)'
}

const I18N = {
  zh: {
    open_settings: '设置',
    brand_mini: 'SMART SEARCH',
    hint: '一次输入 多个引擎 同时搜索',
    search_placeholder: '输入关键词开始搜索...',
    search_btn: 'SEARCH',
    clear_history: '清空历史',
    popup_title: '请允许弹出窗口',
    popup_desc: '首次使用多引擎搜索时，Chrome 可能会拦截多个标签页。建议在设置中允许来自扩展新标签页的弹窗。',
    common_ok: '知道了',
    settings_sync: '同步设置',
    settings_language: '语言',
    settings_about: '关于',
    language_label: '语言',
    sync_giturl: 'Git 代码片段地址',
    sync_giturl_ph: '例如：https://gitee.com/<用户名>/codes/<代码片段ID>',
    sync_giturl_hint: '仅支持 Gitee 代码片段地址（/codes/…）。',
    sync_token: 'Token',
    sync_token_ph: 'GitHub Token / Gitee 私人令牌',
    sync_token_hint: 'token 仅保存在 `chrome.storage.sync`；推送/拉取时会使用。',
    sync_autopush: '自动同步',
    sync_autopush_desc: '配置变更后自动推送到远端',
    common_save: '保存',
    sync_push: '推送到远端',
    sync_pull: '从远端拉取',
    sync_test: '测试连接',
    sync_last_sync_at: '最新同步时间：',
    card_title: '标题',
    card_title_ph: '例如：Google',
    card_url: '网址',
    card_url_ph: '例如：https://example.com',
    card_icon: 'Icon（选填，默认使用网站icon）',
    card_icon_ph: '例如：https://example.com/icon.png',
    common_cancel: '取消',
    confirm_title: '确认删除',
    common_confirm: '确认',
    add_choose_title: '新增',
    add_choose_card: '添加卡片',
    add_choose_component: '添加组件',
    component_list_title: '组件',
    component_hot: '热搜',
    component_stock: '股票',
    component_metals: '黄金白银',
    component_anniversary: '纪念日',
    hot_source_label: '来源',
    anniversary_title: '纪念日',
    anniversary_item_title: '标题',
    anniversary_item_title_ph: '例如：小胖达生日',
    anniversary_item_date: '日期',
    stock_title: '股票',
    stock_card_title: '标题',
    stock_card_title_ph: '例如：我的股票',
    stock_symbols_label: '股票代码',
    stock_symbols_ph: '例如：AAPL, MSFT, TSLA',
    stock_live_label: '实时行情',
    stock_updated_at: '更新于',
    stock_loading: '加载中...',
    stock_no_data: '暂无数据',
    stock_error: '加载失败，点击刷新重试',
    metals_title: '国际金价',
    metals_gold: '国际金价',
    metals_silver: '国际银价',
    metals_usd: '美元',
    metals_cny: '人民币',
    metals_loading: '加载中...',
    metals_error: '加载失败，点击刷新重试'
  },
  en: {
    open_settings: 'Settings',
    brand_mini: 'SMART SEARCH',
    hint: 'ONE INPUT, MULTIPLE ENGINES. INSTANT ACCESS.',
    search_placeholder: 'Enter keyword to search...',
    search_btn: 'SEARCH',
    clear_history: 'Clear History',
    popup_title: 'Allow pop-ups',
    popup_desc:
      'When using multi-engine search for the first time, Chrome may block opening multiple tabs. Please allow pop-ups from this new tab page in settings.',
    common_ok: 'Got it',
    settings_sync: 'Sync',
    settings_language: 'Language',
    settings_about: 'About',
    language_label: 'Language',
    sync_giturl: 'Gitee Codes URL',
    sync_giturl_ph: 'e.g. https://gitee.com/<user>/codes/<gistId>',
    sync_giturl_hint: 'Only Gitee codes URL (/codes/…) is supported.',
    sync_token: 'Token',
    sync_token_ph: 'GitHub Token / Gitee token',
    sync_token_hint: 'Token is stored only in `chrome.storage.sync`; used for push/pull.',
    sync_autopush: 'Auto Sync',
    sync_autopush_desc: 'Auto push changes to remote',
    common_save: 'Save',
    sync_push: 'Push',
    sync_pull: 'Pull',
    sync_test: 'Test',
    sync_last_sync_at: 'Last sync:',
    card_title: 'Title',
    card_title_ph: 'e.g. Google',
    card_url: 'URL',
    card_url_ph: 'e.g. https://example.com',
    card_icon: 'Icon (optional, fallback to site icon)',
    card_icon_ph: 'e.g. https://example.com/icon.png',
    common_cancel: 'Cancel',
    confirm_title: 'Confirm delete',
    common_confirm: 'Confirm',
    add_choose_title: 'Add',
    add_choose_card: 'Add Card',
    add_choose_component: 'Add Component',
    component_list_title: 'Components',
    component_hot: 'Hot search',
    component_stock: 'Stocks',
    component_metals: 'Gold & Silver',
    component_anniversary: 'Anniversary',
    hot_source_label: 'Source',
    anniversary_title: 'Anniversary',
    anniversary_item_title: 'Title',
    anniversary_item_title_ph: 'e.g. Birthday',
    anniversary_item_date: 'Date',
    stock_title: 'Stocks',
    stock_card_title: 'Title',
    stock_card_title_ph: 'e.g. My Stocks',
    stock_symbols_label: 'Symbols',
    stock_symbols_ph: 'e.g. AAPL, MSFT, TSLA',
    stock_live_label: 'Live quotes',
    stock_updated_at: 'Updated',
    stock_loading: 'Loading...',
    stock_no_data: 'No data',
    stock_error: 'Load failed, click refresh to retry',
    metals_title: 'Gold',
    metals_gold: 'Gold',
    metals_silver: 'Silver',
    metals_usd: 'USD',
    metals_cny: 'CNY',
    metals_loading: 'Loading...',
    metals_error: 'Load failed, click refresh to retry'
  }
}

const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'

const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) return null

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) return { provider: 'gitee_gist', gistId: giteeCodes[1] }
  return null
}

const normalizeSync = (sync) => {
  const raw = sync || {}
  const parsed = parseGitRemote(raw.gitUrl)
  return {
    gitUrl: raw.gitUrl || '',
    token: raw.token || '',
    autoPush: Boolean(raw.autoPush),
    provider: 'gitee_gist',
    owner: '',
    repo: '',
    gistId: raw.gistId || parsed?.gistId || '',
    path: raw.path || DEFAULT_SYNC_PATH
  }
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

  const dict = I18N[getLang()] || I18N.zh
  const source = isoTime || (await chrome.storage.local.get(LAST_SYNC_AT_KEY))[LAST_SYNC_AT_KEY]
  const formatted = formatSyncTime(source)
  el.textContent = formatted ? `${dict.sync_last_sync_at} ${formatted}` : ''
}

const applyLanguage = () => {
  const dict = I18N[getLang()] || I18N.zh

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n')
    if (!key) continue
    const value = dict[key]
    if (typeof value === 'string') el.textContent = value
  }

  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder')
    if (!key) continue
    const value = dict[key]
    if (typeof value === 'string') el.setAttribute('placeholder', value)
  }

  document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN'
  renderLastSyncAt()
}

const canAutoPush = (sync) => {
  if (!sync?.autoPush) return false
  const normalized = normalizeSync(sync)
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

const normalizeUrl = (raw) => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

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

const getHostname = (url) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * 生成 Google S2 favicon 服务地址（需要在 manifest 中配置 host_permissions）。
 *
 * 说明：
 * - 某些 Chrome 内置 `chrome://favicon2/` 资源在扩展页会被拦截（Not allowed to load local resource）。
 * - 因此这里使用可跨站稳定访问的 https favicon 服务作为更通用的候选项。
 */
const googleS2FaviconUrl = (pageUrl, size = 64) =>
  `https://www.google.com/s2/favicons?sz=${encodeURIComponent(String(size))}&domain_url=${encodeURIComponent(String(pageUrl || ''))}`

const faviconAggregatedUrl = (hostname) => `https://favicon.im/${encodeURIComponent(hostname)}?larger=true`

const faviconCandidates = (url) => {
  const normalized = normalizeUrl(url)
  try {
    const u = new URL(normalized)
    const hostname = u.hostname
    // 重要逻辑：优先站点自身 favicon，其次 Google S2（更稳定），最后第三方聚合兜底。
    return [`${u.origin}/favicon.ico`, googleS2FaviconUrl(u.toString(), 64), faviconAggregatedUrl(hostname)]
  } catch {
    const hostname = getHostname(url)
    // 兜底：无法解析 URL 时，仍尝试第三方聚合（不影响主流程）。
    return [googleS2FaviconUrl(hostname, 64), faviconAggregatedUrl(hostname)]
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

const loadImageWithTimeout = (img, urls, timeoutMs = 5000) => {
  const list = (urls || []).filter(Boolean)
  if (!img || !list.length) return () => {}
  let index = 0
  let done = false
  let timer = null

  const cleanup = () => {
    if (timer) clearTimeout(timer)
    timer = null
    img.onload = null
    img.onerror = null
  }

  const tryNext = () => {
    if (done) return
    if (index >= list.length) {
      done = true
      cleanup()
      return
    }

    const src = list[index++]
    cleanup()

    img.onload = () => {
      done = true
      cleanup()
    }
    img.onerror = () => {
      tryNext()
    }

    timer = setTimeout(() => {
      tryNext()
    }, timeoutMs)

    img.src = src
  }

  tryNext()
  return () => {
    done = true
    cleanup()
  }
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
  const history = [...(state.config.searchHistory || [])]
  const existingIndex = history.indexOf(term)
  if (existingIndex > -1) history.splice(existingIndex, 1)
  history.unshift(term)
  if (history.length > 20) history.pop()
  state.config.searchHistory = history
  await saveConfig({ searchHistory: history })
  renderHistory()
}

const triggerSearch = async ({ shouldAddToHistory }) => {
  const keyword = $('#keywordInput').value.trim()
  if (!keyword) {
    setError('请输入关键词')
    return
  }
  if (!state.config.selectedEngines?.length) {
    setError('请至少选择一个搜索引擎')
    return
  }
  setError('')

  const urls = computeSearchUrls(keyword, state.config.selectedEngines)

  if (!state.config.popupTipDismissed) {
    state.pendingSearch = { urls, keyword, shouldAddToHistory }
    $('#popupOverlay').hidden = false
    return
  }

  const res = await send({ type: 'openTabs', urls })
  if (!res?.ok) {
    setError(res?.error || '打开标签页失败')
    return
  }
  if (shouldAddToHistory) await addToHistory(keyword)
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

const renderCards = () => {
  const root = $('#cardsGrid')
  root.innerHTML = ''
  for (const timer of state.stockPollTimers.values()) clearInterval(timer)
  state.stockPollTimers.clear()
  for (const timer of state.metalsPollTimers.values()) clearInterval(timer)
  state.metalsPollTimers.clear()
  const cards = state.config.cards || []
  for (const card of cards) {
    const type = card?.type || 'link'
    const div = document.createElement('div')
    if (type === 'anniversary') div.className = 'card card-anniversary'
    else if (type === 'hot') div.className = 'card card-hot'
    else if (type === 'stock') div.className = 'card card-stock'
    else if (type === 'metals') div.className = 'card card-metals'
    else div.className = 'card'
    div.draggable = true
    div.dataset.cardId = card.id
    if (type === 'anniversary') {
      div.innerHTML = renderAnniversaryCardHtml(card)
    } else if (type === 'hot') {
      div.innerHTML = renderHotCardHtml(card)
    } else if (type === 'stock') {
      div.innerHTML = renderStockCardHtml(card)
    } else if (type === 'metals') {
      div.innerHTML = renderMetalsCardHtml(card)
    } else {
      div.innerHTML = `
        <img class="card-icon" alt="" />
        <div class="card-title"></div>
      `

      const icon = div.querySelector('.card-icon')
      // 性能优化：避免阻塞布局/解码；并允许浏览器延迟加载离屏图像。
      icon.decoding = 'async'
      icon.loading = 'lazy'
      if (card.icon) {
        icon.src = card.icon
      } else {
        loadImageWithTimeout(icon, faviconCandidates(card.url), 5000)
      }
      div.querySelector('.card-title').textContent = card.title
    }

    div.addEventListener('click', async (evt) => {
      if (state.isDraggingCard) return
      if ((card?.type || 'link') === 'anniversary') {
        openAnniversaryModal(card.id)
        return
      }
      if ((card?.type || 'link') === 'hot') {
        const actionEl = evt.target?.closest?.('[data-hot-action]')
        if (actionEl?.dataset?.hotAction === 'refresh') {
          evt.preventDefault()
          evt.stopPropagation()
          await refreshHotCard(card.id)
          return
        }

        const itemEl = evt.target?.closest?.('[data-hot-link]')
        if (itemEl) {
          const url = itemEl.dataset.hotLink
          if (url) await send({ type: 'openTabsInNewActive', urls: [url] })
          return
        }

        openHotModal({ mode: 'edit', cardId: card.id })
        return
      }
      if ((card?.type || 'link') === 'stock') {
        const actionEl = evt.target?.closest?.('[data-stock-action]')
        if (actionEl?.dataset?.stockAction === 'refresh') {
          evt.preventDefault()
          evt.stopPropagation()
          await refreshStockCard(card.id)
          return
        }

        const itemEl = evt.target?.closest?.('[data-stock-symbol]')
        if (itemEl) {
          const symbol = itemEl.dataset.stockSymbol
          if (symbol) {
            const url = `https://gu.qq.com/${encodeURIComponent(formatTencentSymbol(symbol))}`
            await send({ type: 'openTabsInNewActive', urls: [url] })
          }
          return
        }

        openStockModal({ mode: 'edit', cardId: card.id })
        return
      }
      if ((card?.type || 'link') === 'metals') {
        const actionEl = evt.target?.closest?.('[data-metals-action]')
        if (actionEl?.dataset?.metalsAction === 'refresh') {
          evt.preventDefault()
          evt.stopPropagation()
          await refreshMetalsCard(card.id)
          return
        }

        const itemEl = evt.target?.closest?.('[data-metals-symbol]')
        if (itemEl) {
          const symbol = itemEl.dataset.metalsSymbol
          if (symbol) {
            const url = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
            await send({ type: 'openTabsInNewActive', urls: [url] })
          }
          return
        }
        return
      }
      await send({ type: 'openTabsInNewActive', urls: [card.url] })
    })

    div.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      openCardMenu({ x: evt.clientX, y: evt.clientY, cardId: card.id })
    })

    div.addEventListener('dragstart', (evt) => {
      state.isDraggingCard = true
      div.classList.add('dragging')
      evt.dataTransfer.effectAllowed = 'move'
      evt.dataTransfer.setData('text/plain', card.id)
    })

    div.addEventListener('dragend', () => {
      state.isDraggingCard = false
      div.classList.remove('dragging')
      for (const el of document.querySelectorAll('.card.drop-target')) {
        el.classList.remove('drop-target')
      }
    })

    div.addEventListener('dragover', (evt) => {
      evt.preventDefault()
      evt.dataTransfer.dropEffect = 'move'
    })

    div.addEventListener('dragenter', () => {
      if (!div.classList.contains('dragging')) div.classList.add('drop-target')
    })

    div.addEventListener('dragleave', () => {
      div.classList.remove('drop-target')
    })

    div.addEventListener('drop', async (evt) => {
      evt.preventDefault()
      div.classList.remove('drop-target')
      const draggedId = evt.dataTransfer.getData('text/plain')
      if (!draggedId || draggedId === card.id) return
      await reorderCards(draggedId, card.id)
    })

    root.appendChild(div)

    if (type === 'hot') {
      const renderToken = crypto.randomUUID()
      div.dataset.hotRenderToken = renderToken
      // 性能优化：热搜数据请求延迟到空闲时刻，避免与首屏渲染抢主线程/网络。
      void runWhenIdle(() => ensureHotDataForCard(card, { cardEl: div, renderToken }), 800)
    }

    if (type === 'stock') {
      const renderToken = crypto.randomUUID()
      div.dataset.stockRenderToken = renderToken
      void ensureStockDataForCard(card, { cardEl: div, renderToken, forceRefresh: true })
      const timer = setInterval(() => {
        const latestCard = getCardById(card.id)
        if (!latestCard) return
        void ensureStockDataForCard(latestCard, { cardEl: div, renderToken: div.dataset.stockRenderToken, forceRefresh: true })
      }, STOCK_REFRESH_INTERVAL)
      state.stockPollTimers.set(card.id, timer)
    }

    if (type === 'metals') {
      const renderToken = crypto.randomUUID()
      div.dataset.metalsRenderToken = renderToken
      void ensureMetalsDataForCard(card, { cardEl: div, renderToken, forceRefresh: true })
      const timer = setInterval(() => {
        const latestCard = getCardById(card.id)
        if (!latestCard) return
        void ensureMetalsDataForCard(latestCard, { cardEl: div, renderToken: div.dataset.metalsRenderToken, forceRefresh: true })
      }, STOCK_REFRESH_INTERVAL)
      state.metalsPollTimers.set(card.id, timer)
    }

  }

  const addCard = document.createElement('button')
  addCard.type = 'button'
  addCard.className = 'card card-add'
  addCard.innerHTML = `
    <svg class="card-add-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

const reorderCards = async (draggedId, targetId) => {
  const next = [...(state.config.cards || [])]
  const fromIndex = next.findIndex((c) => c.id === draggedId)
  const toIndex = next.findIndex((c) => c.id === targetId)
  if (fromIndex === -1 || toIndex === -1) return
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

const deleteCard = async (id) => {
  const next = (state.config.cards || []).filter((c) => c.id !== id)
  state.config.cards = next
  await saveConfig({ cards: next })
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

const STOCK_CACHE_TTL = 60 * 1000
const STOCK_REFRESH_INTERVAL = 60 * 1000

/**
 * 获取股票相关文案（随语言切换）。
 */
const getStockText = () => {
  const dict = I18N[getLang()] || I18N.zh
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
  const dict = I18N[getLang()] || I18N.zh
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

/**
 * 规范化股票代码输入：去空格、转大写、去重并限制数量。
 */
const normalizeStockSymbolsInput = (raw) => {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw || '')
  const parts = text.split(/[\s,，;；]+/).map((it) => it.trim()).filter(Boolean)
  const seen = new Set()
  const result = []
  for (const item of parts) {
    const symbol = item.toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    result.push(symbol)
    if (result.length >= 20) break
  }
  return result
}

/**
 * 从卡片配置中提取股票代码列表。
 */
const getStockSymbols = (card) => normalizeStockSymbolsInput(card?.symbols || [])

/**
 * 获取股票卡片标题，缺省时回退到本地化默认标题。
 *
 * @param {any} card 股票卡片配置。
 * @returns {string} 可展示的股票卡片标题。
 */
const getStockCardTitle = (card) => String(card?.title || (getLang() === 'en' ? 'Stocks' : '股票')).trim()

/**
 * 构建股票行情接口地址。
 */
/**
 * 将用户输入的股票代码转为腾讯接口格式。
 */
const formatTencentSymbol = (symbol) => {
  const raw = String(symbol || '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  const pref = upper.match(/^(SH|SZ|BJ|HK|US)(.+)$/)
  if (pref) return `${pref[1].toLowerCase()}${pref[2]}`

  if (/^\d{6}$/.test(upper)) {
    if (upper.startsWith('6')) return `sh${upper}`
    if (upper.startsWith('0') || upper.startsWith('3')) return `sz${upper}`
    if (upper.startsWith('8') || upper.startsWith('4') || upper.startsWith('9')) return `bj${upper}`
  }

  if (/^[A-Z]{1,6}$/.test(upper)) return `us${upper}`

  return raw
}

/**
 * 构建股票行情接口地址（腾讯接口）。
 */
const getStockApiUrl = (symbols) =>
  `https://qt.gtimg.cn/q=${symbols.map(formatTencentSymbol).filter(Boolean).join(',')}`

/**
 * 解析股票接口返回的数据并按输入顺序对齐。
 */
/**
 * 解析腾讯股票接口返回的数据并按输入顺序对齐。
 */
const parseStockApiData = (rawText, symbols) => {
  const list = String(rawText || '').split(';').map((it) => it.trim()).filter(Boolean)
  const map = new Map()

  for (const line of list) {
    const match = line.match(/^v_([^=]+)="([\s\S]*)"$/)
    if (!match) continue
    const rawCode = match[1]
    const fields = String(match[2] || '').split('~')
    const code = String(fields[2] || '').toUpperCase()
    const name = String(fields[1] || code || rawCode || '').trim()
    const price = toNumber(fields[3])
    const prevClose = toNumber(fields[4])
    const change = price !== null && prevClose !== null ? price - prevClose : null
    const changePercent = change !== null && prevClose ? (change / prevClose) * 100 : null
    const timeText = String(fields[30] || '').trim()
    const marketTime = parseTencentTime(timeText)
    const currency = String(rawCode || '').toLowerCase().startsWith('us') ? 'USD' : 'CNY'

    if (!code) continue
    map.set(code, {
      symbol: code,
      name: name || code,
      price,
      change,
      changePercent,
      currency,
      marketTime
    })
  }

  return symbols.map((symbol) => {
    const key = String(symbol || '').toUpperCase()
    return map.get(key) || { symbol: key, name: key, price: null, change: null, changePercent: null, currency: '', marketTime: null }
  })
}

/**
 * 安全转换数字。
 */
const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 解析腾讯行情时间字段。
 */
const parseTencentTime = (timeText) => {
  if (!timeText) return null
  const compactMatch = String(timeText).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (compactMatch) {
    const [, year, month, day, hour, minute, second] = compactMatch
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
    if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000)
  }
  const date = new Date(timeText)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor(date.getTime() / 1000)
}

/**
 * 格式化股票价格展示。
 */
const formatStockPrice = (price, currency) => {
  if (typeof price !== 'number' || Number.isNaN(price)) return '--'
  if (String(currency || '').toUpperCase() === 'CNY') return price.toFixed(2)
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price)
    } catch {
      return price.toFixed(2)
    }
  }
  return price.toFixed(2)
}

/**
 * 生成涨跌幅文本。
 */
const formatStockChange = (change, changePercent) => {
  if (typeof change !== 'number' || Number.isNaN(change)) return '--'
  const sign = change > 0 ? '+' : ''
  const percent = typeof changePercent === 'number' && !Number.isNaN(changePercent) ? ` (${sign}${changePercent.toFixed(2)}%)` : ''
  return `${sign}${change.toFixed(2)}${percent}`
}

/**
 * 获取涨跌样式类名。
 */
const getStockChangeClass = (change) => {
  if (typeof change !== 'number' || Number.isNaN(change) || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/**
 * 格式化行情更新时间。
 */
const formatStockTime = (unixSeconds) => {
  if (typeof unixSeconds !== 'number') return ''
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const locale = getLang() === 'en' ? 'en-US' : 'zh-CN'
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: getLang() === 'en' })
}

/**
 * 统一格式化卡片顶部更新时间。
 *
 * @param {string|number|Date|null|undefined} value 原始时间值。
 * @returns {string} 适合展示在卡片标题后的时间文本。
 */
const formatCardUpdateTime = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const locale = getLang() === 'en' ? 'en-US' : 'zh-CN'
    return value.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: getLang() === 'en' })
  }

  if (typeof value === 'number') return formatStockTime(value)

  const text = String(value || '').trim()
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return formatCardUpdateTime(date)
}

/**
 * 按普通数值格式化价格，避免给页面抓取值附带额外货币符号。
 *
 * @param {number|null} value 数值。
 * @param {number} digits 保留小数位。
 * @returns {string} 格式化后的文本。
 */
const formatPlainPrice = (value, digits = 2) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  return value.toFixed(digits)
}

/**
 * 生成股票卡片 HTML。
 */
const renderStockCardHtml = (card) => {
  return `
    <div class="stock-card">
      <button class="stock-refresh" type="button" aria-label="刷新" data-stock-action="refresh">
        <svg class="stock-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 0 1-15.3 6.4"></path>
          <path d="M3 12a9 9 0 0 1 15.3-6.4"></path>
          <polyline points="3 16 5.7 18.4 6.6 15"></polyline>
          <polyline points="21 8 18.3 5.6 17.4 9"></polyline>
        </svg>
      </button>
      <div class="card-head-row">
        <div class="card-head-title">${escapeHtml(getStockCardTitle(card))}</div>
        <div class="card-head-time" data-stock-updated-at></div>
      </div>
      <div class="stock-list-mini" data-stock-list>
        <div class="stock-empty">${escapeHtml(getStockText().loading)}</div>
      </div>
    </div>
  `
}

/**
 * 生成黄金白银卡片 HTML。
 *
 * @param {any} card 卡片配置。
 * @returns {string} 卡片 HTML。
 */
const renderMetalsCardHtml = (card) => {
  const text = getMetalsText()
  const title = escapeHtml(String(card?.title || text.title))
  return `
    <div class="metals-card">
      <button class="metals-refresh" type="button" aria-label="刷新" data-metals-action="refresh">
        <svg class="metals-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 0 1-15.3 6.4"></path>
          <path d="M3 12a9 9 0 0 1 15.3-6.4"></path>
          <polyline points="3 16 5.7 18.4 6.6 15"></polyline>
          <polyline points="21 8 18.3 5.6 17.4 9"></polyline>
        </svg>
      </button>
      <div class="card-head-row">
        <div class="card-head-title">${title}</div>
        <div class="card-head-time" data-metals-updated-at></div>
      </div>
      <div class="metals-grid" data-metals-grid>
        <div class="metals-empty">${escapeHtml(text.loading)}</div>
      </div>
    </div>
  `
}

/**
 * 更新股票卡片 DOM 展示。
 */
const updateStockCardDom = ({ cardEl, renderToken, items, errorText }) => {
  if (!cardEl || cardEl.dataset.stockRenderToken !== renderToken) return
  const text = getStockText()
  const listEl = cardEl.querySelector('[data-stock-list]')
  const updatedAtEl = cardEl.querySelector('[data-stock-updated-at]')
  if (!listEl) return

  if (errorText) {
    if (updatedAtEl) updatedAtEl.textContent = ''
    listEl.innerHTML = `<div class="stock-empty">${escapeHtml(errorText)}</div>`
    return
  }

  if (!items?.length) {
    if (updatedAtEl) updatedAtEl.textContent = ''
    listEl.innerHTML = `<div class="stock-empty">暂无数据</div>`
    return
  }

  const latestMarketTime = items.map((it) => it?.marketTime).find((it) => typeof it === 'number')
  if (updatedAtEl) updatedAtEl.textContent = formatCardUpdateTime(latestMarketTime)

  const mini = items.map((it) => {
    const name = escapeHtml(it?.name || it?.symbol || '--')
    const symbol = escapeHtml(it?.symbol || '--')
    const price = escapeHtml(formatStockPrice(it?.price, it?.currency))
    const change = escapeHtml(formatStockChange(it?.change, it?.changePercent))
    const changeClass = getStockChangeClass(it?.change)
    return `
      <div class="stock-mini-item" data-stock-symbol="${symbol}">
        <div class="left">
          <div class="stock-mini-name">${name}</div>
          <div class="stock-mini-symbol">${symbol}</div>
        </div>
        <div class="right">
          <div class="stock-mini-price">${price}</div>
          <div class="stock-mini-change ${changeClass}">${change}</div>
        </div>
      </div>
    `
  })

  listEl.innerHTML = mini.length ? mini.join('') : `<div class="stock-empty">${escapeHtml(text.empty)}</div>`
}

/**
 * 更新黄金白银卡片 DOM。
 *
 * @param {{cardEl: HTMLElement, renderToken: string, items?: Array<any>, errorText?: string}} params 渲染参数。
 */
const updateMetalsCardDom = ({ cardEl, renderToken, items, errorText }) => {
  if (!cardEl || cardEl.dataset.metalsRenderToken !== renderToken) return
  const text = getMetalsText()
  const gridEl = cardEl.querySelector('[data-metals-grid]')
  const updatedAtEl = cardEl.querySelector('[data-metals-updated-at]')
  if (!gridEl) return

  if (errorText) {
    if (updatedAtEl) updatedAtEl.textContent = ''
    gridEl.innerHTML = `<div class="metals-empty">${escapeHtml(errorText)}</div>`
    return
  }

  if (!Array.isArray(items) || !items.length) {
    if (updatedAtEl) updatedAtEl.textContent = ''
    gridEl.innerHTML = `<div class="metals-empty">${escapeHtml(text.error)}</div>`
    return
  }

  const latestTimeText = items.map((item) => item?.timeText).find(Boolean)
  if (updatedAtEl) updatedAtEl.textContent = formatCardUpdateTime(latestTimeText)

  gridEl.innerHTML = items
    .map((item) => {
      const usdValue = escapeHtml(formatPlainPrice(item?.usdPrice, 2))
      const cnyValue = escapeHtml(formatPlainPrice(item?.cnyPrice, 2))
      const changeUsdText =
        typeof item?.changeUsd === 'number' && !Number.isNaN(item.changeUsd) ? escapeHtml(formatPlainPrice(item.changeUsd, 2)) : ''
      const changeCnyText =
        typeof item?.changeCny === 'number' && !Number.isNaN(item.changeCny) ? escapeHtml(formatPlainPrice(item.changeCny, 2)) : ''
      return `
        <div class="metals-item">
          <div class="metals-item-title">${escapeHtml(item?.title || '--')}</div>
          <div class="metals-prices">
            <div class="metals-price-line">
              <span class="metals-price-label">${escapeHtml(text.usd)}</span>
              <span class="metals-price-value">${usdValue}</span>
            </div>
            ${changeUsdText ? `<div class="metals-price-change">${changeUsdText}</div>` : ''}
            <div class="metals-price-line">
              <span class="metals-price-label">${escapeHtml(text.cny)}</span>
              <span class="metals-price-value">${cnyValue}</span>
            </div>
            ${changeCnyText ? `<div class="metals-price-change">${changeCnyText}</div>` : ''}
          </div>
        </div>
      `
    })
    .join('')
}

/**
 * 通过扩展后台抓取黄金白银报价并提取美元/人民币价格。
 *
 * 数据来源文档：
 * - 金价：`https://api.gold-api.com/price/XAU`
 * - 银价：`https://api.gold-api.com/price/XAG`
 * - 汇率：`https://open.er-api.com/v6/latest/USD`
 * - 换算规则：美元/盎司 -> 人民币/克
 * - 说明：抓取与汇率换算都在 background/service worker 中完成，用于规避前台跨域限制
 *
 * @returns {Promise<Array<{title: string, usdPrice: number|null, cnyPrice: number|null, timeText: string, changeUsd: number|null, changeCny: number|null}>>}
 */
const fetchMetalsItems = async () => {
  const text = getMetalsText()
  const res = await send({ type: 'fetchMetalsQuote' })
  console.log('[chrome-home] metals response', res)
  if (!res?.ok) throw new Error(res?.error || '黄金白银抓取失败')
  const items = Array.isArray(res.data?.items) ? res.data.items : []
  if (!items.length) throw new Error('metals data missing')

  // 重要逻辑：前台只负责展示，标题映射统一按组件文案处理。
  const normalizedItems = items.map((item) => ({
    title: item?.key === 'silver' ? text.silver : text.gold,
    usdPrice: Number.isFinite(Number(item?.usdPrice)) ? Number(item.usdPrice) : null,
    cnyPrice: Number.isFinite(Number(item?.cnyPrice)) ? Number(item.cnyPrice) : null,
    timeText: String(item?.timeText || ''),
    changeUsd: null,
    changeCny: null
  }))
  console.log('[chrome-home] metals items normalized', normalizedItems)
  return normalizedItems
}

/**
 * 为黄金白银卡片加载并渲染数据。
 *
 * @param {any} card 卡片配置。
 * @param {{cardEl: HTMLElement, renderToken: string, forceRefresh?: boolean}} options 渲染上下文。
 */
const ensureMetalsDataForCard = async (card, { cardEl, renderToken, forceRefresh = false }) => {
  const text = getMetalsText()
  const cached = state.metalsCache.get(card.id)
  const now = Date.now()
  if (!forceRefresh && cached && now - cached.ts < STOCK_CACHE_TTL && Array.isArray(cached.items)) {
    updateMetalsCardDom({ cardEl, renderToken, items: cached.items })
    return
  }

  try {
    const items = await fetchMetalsItems()
    state.metalsCache.set(card.id, { ts: Date.now(), items })
    updateMetalsCardDom({ cardEl, renderToken, items })
  } catch (error) {
    console.error('[chrome-home] ensureMetalsDataForCard:failed', error?.message || String(error))
    updateMetalsCardDom({ cardEl, renderToken, items: [], errorText: text.error })
  }
}

/**
 * 主动刷新黄金白银卡片。
 *
 * @param {string} cardId 卡片 ID。
 */
const refreshMetalsCard = async (cardId) => {
  const card = getCardById(cardId)
  if (!card || (card.type || 'link') !== 'metals') return
  state.metalsCache.delete(card.id)
  renderCards()
}

/**
 * 拉取股票行情并更新卡片（带缓存）。
 */
const ensureStockDataForCard = async (card, { cardEl, renderToken, forceRefresh = false }) => {
  const symbols = getStockSymbols(card)
  const text = getStockText()
  if (!symbols.length) {
    updateStockCardDom({ cardEl, renderToken, items: [], errorText: text.empty })
    return
  }

  const cached = state.stockCache.get(card.id)
  const now = Date.now()
  // 重要逻辑：短时缓存，降低频繁刷新带来的请求压力。
  if (!forceRefresh && cached && now - cached.ts < STOCK_CACHE_TTL && Array.isArray(cached.items)) {
    updateStockCardDom({ cardEl, renderToken, items: cached.items })
    return
  }

  try {
    const rawText = await fetchTextWithTimeout(getStockApiUrl(symbols), 9000)
    const items = parseStockApiData(rawText, symbols)
    state.stockCache.set(card.id, { ts: Date.now(), items })
    updateStockCardDom({ cardEl, renderToken, items })
  } catch {
    updateStockCardDom({ cardEl, renderToken, items: [], errorText: text.error })
  }
}

/**
 * 主动刷新股票卡片。
 */
const refreshStockCard = async (cardId) => {
  const card = getCardById(cardId)
  if (!card || (card.type || 'link') !== 'stock') return
  state.stockCache.delete(card.id)
  renderCards()
}

/**
 * 拉取 JSON 接口数据，并在超时时主动中止请求。
 *
 * @param {string} url 接口地址。
 * @param {number} timeoutMs 超时时间，单位毫秒。
 * @returns {Promise<any>} 解析后的 JSON 数据。
 */
const fetchJsonWithTimeout = async (url, timeoutMs = 8000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 获取文本并做超时控制（用于非 JSON 接口）。
 */
const fetchTextWithTimeout = async (url, timeoutMs = 8000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()
    const decoder = new TextDecoder('gbk')
    return decoder.decode(buffer)
  } finally {
    clearTimeout(timer)
  }
}
const getHotSourceTitle = (card) => String(card?.sourceTitle || card?.title || '知乎')

/**
 * 热搜接口地址构造器。
 *
 * API 文档：
 * - 方法：`GET`
 * - 地址：`https://bot.znzme.com/dailyhot`
 * - 查询参数：`title`，热搜来源名称，例如“知乎”“微博热搜”
 * - 成功响应：JSON，对象中的 `data` 字段为数组；数组项包含 `title` 与 `link`
 * - 使用约束：前端会对同一来源做并发复用与 5 分钟缓存，避免重复请求造成误判失败
 *
 * @param {string} sourceTitle 热搜来源名称。
 * @returns {string} 完整接口地址。
 */
const getHotApiUrl = (sourceTitle) =>
  `https://bot.znzme.com/dailyhot?title=${encodeURIComponent(String(sourceTitle || '知乎'))}`

const parseHotApiData = (raw) => {
  const list = raw?.data
  if (!Array.isArray(list)) return []
  return list
    .map((it) => ({
      title: String(it?.title || '').trim(),
      link: String(it?.link || '').trim()
    }))
    .filter((it) => it.title && it.link)
}

const renderHotCardHtml = (card) => {
  const sourceTitle = escapeHtml(getHotSourceTitle(card))
  return `
    <div class="hot-card">
      <div class="hot-header">
        <div class="hot-title">${sourceTitle}</div>
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
}

const updateHotCardDom = ({ cardEl, renderToken, items, errorText }) => {
  if (!cardEl || cardEl.dataset.hotRenderToken !== renderToken) return
  const listEl = cardEl.querySelector('[data-hot-list]')
  if (!listEl) return

  if (errorText) {
    listEl.innerHTML = `<div class="hot-empty">${escapeHtml(errorText)}</div>`
    return
  }

  if (!items?.length) {
    listEl.innerHTML = `<div class="hot-empty">暂无数据</div>`
    return
  }

  listEl.innerHTML = items
    .slice(0, 50)
    .map(
      (it, idx) => `
      <div class="hot-item" data-hot-link="${escapeHtml(it.link)}" title="${escapeHtml(it.title)}">
        <div class="hot-rank hot-rank-${idx + 1}">${idx + 1}</div>
        <div class="hot-text">${escapeHtml(it.title)}</div>
      </div>
    `
    )
    .join('')
}

/**
 * 获取指定热搜源的数据。
 * - 命中缓存时直接返回缓存结果
 * - 存在进行中的同源请求时复用同一个 Promise，避免重复请求被浏览器取消
 *
 * @param {string} sourceTitle 热搜来源名称。
 * @returns {Promise<Array<{title: string, link: string}>>} 热搜列表。
 */
const getHotItems = async (sourceTitle) => {
  const cached = state.hotCache.get(sourceTitle)
  const now = Date.now()
  if (cached && now - cached.ts < 5 * 60 * 1000 && Array.isArray(cached.items)) {
    return cached.items
  }

  const pending = state.hotPendingRequests.get(sourceTitle)
  if (pending) return pending

  const request = fetchJsonWithTimeout(getHotApiUrl(sourceTitle), 9000)
    .then((raw) => {
      const items = parseHotApiData(raw)
      state.hotCache.set(sourceTitle, { ts: Date.now(), items })
      return items
    })
    .finally(() => {
      state.hotPendingRequests.delete(sourceTitle)
    })

  state.hotPendingRequests.set(sourceTitle, request)
  return request
}

/**
 * 为热搜卡片加载并渲染数据。
 *
 * @param {{ sourceTitle?: string, title?: string }} card 热搜卡片配置。
 * @param {{ cardEl: HTMLElement, renderToken: string }} options 渲染上下文。
 * @returns {Promise<void>}
 */
const ensureHotDataForCard = async (card, { cardEl, renderToken }) => {
  const sourceTitle = getHotSourceTitle(card)
  try {
    const items = await getHotItems(sourceTitle)
    updateHotCardDom({ cardEl, renderToken, items })
  } catch {
    // 重要逻辑：请求失败时优先回退到旧缓存，减少接口瞬时抖动对界面的影响。
    const fallbackItems = state.hotCache.get(sourceTitle)?.items
    if (Array.isArray(fallbackItems) && fallbackItems.length) {
      updateHotCardDom({ cardEl, renderToken, items: fallbackItems })
      return
    }
    updateHotCardDom({ cardEl, renderToken, items: [], errorText: '加载失败，点击刷新重试' })
  }
}

const refreshHotCard = async (cardId) => {
  const card = getCardById(cardId)
  if (!card || (card.type || 'link') !== 'hot') return
  state.hotCache.delete(getHotSourceTitle(card))
  state.hotPendingRequests.delete(getHotSourceTitle(card))
  renderCards()
}

const closeHotModal = () => {
  $('#hotOverlay').hidden = true
  state.editingHotCardId = null
  state.hotModalMode = 'create'
}

const openHotModal = ({ mode, cardId }) => {
  const overlay = $('#hotOverlay')
  const titleEl = $('#hotModalTitle')
  const select = $('#hotSourceSelect')

  state.hotModalMode = mode === 'edit' ? 'edit' : 'create'
  state.editingHotCardId = mode === 'edit' ? cardId : null

  if (mode === 'edit') titleEl.textContent = getLang() === 'en' ? 'Hot search' : '热搜设置'
  else titleEl.textContent = getLang() === 'en' ? 'Add hot search' : '新增热搜'

  const current = mode === 'edit' ? getHotSourceTitle(getCardById(cardId)) : '知乎'
  const chosen = HOT_SOURCES.includes(current) ? current : '知乎'
  select.value = chosen

  overlay.hidden = false
  closeComponentList()
  closeCardMenu()
}

const addHotComponent = async (sourceTitle) => {
  const next = [...(state.config.cards || [])]
  const safeTitle = HOT_SOURCES.includes(sourceTitle) ? sourceTitle : '知乎'
  next.push({
    id: crypto.randomUUID(),
    type: 'hot',
    title: safeTitle,
    sourceTitle: safeTitle
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

const saveHotCardPatch = async (cardId, patch) => {
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
 * 关闭股票设置弹窗。
 */
const closeStockModal = () => {
  $('#stockOverlay').hidden = true
  state.editingStockCardId = null
  state.editingStockSymbol = null
  state.stockModalMode = 'create'
  $('#stockTitleInput').value = ''
  $('#stockSymbolInput').value = ''
}

/**
 * 打开股票设置弹窗。
 */
const openStockModal = ({ mode, cardId }) => {
  const overlay = $('#stockOverlay')
  const titleEl = $('#stockModalTitle')
  const titleInput = $('#stockTitleInput')
  const symbolInput = $('#stockSymbolInput')

  state.stockModalMode = mode === 'edit' ? 'edit' : 'create'
  state.editingStockCardId = mode === 'edit' ? cardId : null
  state.editingStockSymbol = null

  const defaultTitle = getLang() === 'en' ? 'Stocks' : '股票'
  if (mode === 'edit') titleEl.textContent = getLang() === 'en' ? 'Stock settings' : '股票设置'
  else titleEl.textContent = getLang() === 'en' ? 'Add stocks' : '新增股票'

  const card = mode === 'edit' ? getCardById(cardId) : null
  titleInput.value = getStockCardTitle(card) || defaultTitle
  symbolInput.value = ''
  renderStockList(card || { symbols: [] })

  overlay.hidden = false
  closeComponentList()
  closeCardMenu()
  requestAnimationFrame(() => symbolInput.focus())
}

/**
 * 新增股票组件。
 */
const addStockComponent = async ({ title, symbols }) => {
  const next = [...(state.config.cards || [])]
  const safeTitle = title || (getLang() === 'en' ? 'Stocks' : '股票')
  next.push({
    id: crypto.randomUUID(),
    type: 'stock',
    title: safeTitle,
    symbols
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

/**
 * 新增黄金白银组件。
 */
const addMetalsComponent = async () => {
  const next = [...(state.config.cards || [])]
  next.push({
    id: crypto.randomUUID(),
    type: 'metals',
    title: getMetalsText().title
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
  scheduleAutoPush()
}

/**
 * 保存股票卡片修改。
 */
const saveStockCardPatch = async (cardId, patch) => {
  const next = [...(state.config.cards || [])]
  const index = next.findIndex((c) => c.id === cardId)
  if (index === -1) return
  next[index] = { ...next[index], ...patch }
  state.config.cards = next
  await saveConfig({ cards: next })
  state.stockCache.delete(cardId)
  renderCards()
  scheduleAutoPush()
}

/**
 * 渲染股票编辑列表，支持在同一卡片中维护多个股票代码。
 *
 * @param {any} card 股票卡片配置。
 */
const renderStockList = (card) => {
  const root = $('#stockList')
  if (!root) return
  const symbols = getStockSymbols(card)
  if (!symbols.length) {
    root.innerHTML = `<div style="color: rgba(255,255,255,0.65); font-size: 13px; padding: 10px 2px;">暂无股票，右侧新增一个吧</div>`
    return
  }

  const cachedItems = state.stockCache.get(card.id)?.items || []
  const cachedMap = new Map(cachedItems.map((it) => [String(it?.symbol || '').toUpperCase(), it]))
  root.innerHTML = symbols
    .map((symbol) => {
      const quote = cachedMap.get(String(symbol).toUpperCase())
      const name = escapeHtml(String(quote?.name || symbol))
      const summary = quote
        ? `${escapeHtml(formatStockPrice(quote.price, quote.currency))} · ${escapeHtml(formatStockChange(quote.change, quote.changePercent))}`
        : escapeHtml(symbol)
      return `
        <div class="stock-list-item" data-symbol="${escapeHtml(symbol)}">
          <div class="meta">
            <div class="name">${name}</div>
            <div class="sub">${summary}</div>
          </div>
          <div class="actions">
            <div class="badge">${escapeHtml(symbol)}</div>
            <button class="danger-btn" type="button" data-action="delete" data-symbol="${escapeHtml(symbol)}">删除</button>
          </div>
        </div>
      `
    })
    .join('')
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
    root.innerHTML = `<div style="color: rgba(255,255,255,0.65); font-size: 13px; padding: 10px 2px;">暂无纪念日，右侧新增一个吧</div>`
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
      else if (!$('#hotOverlay').hidden) closeHotModal()
      else if (!$('#stockOverlay').hidden) closeStockModal()
      else if (!$('#componentListOverlay').hidden) closeComponentList()
      else if (!$('#addChooserOverlay').hidden) closeAddChooser()
    }
  })

  editBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    if ((card?.type || 'link') === 'anniversary') openAnniversaryModal(card.id)
    else if ((card?.type || 'link') === 'hot') openHotModal({ mode: 'edit', cardId: card.id })
    else if ((card?.type || 'link') === 'stock') openStockModal({ mode: 'edit', cardId: card.id })
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
  componentListOverlay.addEventListener('click', (evt) => {
    if (evt.target === componentListOverlay) closeComponentList()
  })
  componentListClose.addEventListener('click', closeComponentList)
  componentHotBtn.addEventListener('click', () => openHotModal({ mode: 'create' }))
  componentStockBtn.addEventListener('click', () => openStockModal({ mode: 'create' }))
  componentMetalsBtn.addEventListener('click', async () => {
    closeComponentList()
    await addMetalsComponent()
  })
  componentAnniversaryBtn.addEventListener('click', async () => {
    closeComponentList()
    await addAnniversaryComponent()
  })

  const hotOverlay = $('#hotOverlay')
  const hotCloseBtn = $('#hotCloseBtn')
  const hotCancelBtn = $('#hotCancelBtn')
  const hotForm = $('#hotForm')
  const hotSelect = $('#hotSourceSelect')
  hotOverlay.addEventListener('click', (evt) => {
    if (evt.target === hotOverlay) closeHotModal()
  })
  hotCloseBtn.addEventListener('click', closeHotModal)
  hotCancelBtn.addEventListener('click', closeHotModal)
  hotForm.addEventListener('submit', async (evt) => {
    evt.preventDefault()
    const sourceTitle = String(hotSelect.value || '知乎')
    const safeTitle = HOT_SOURCES.includes(sourceTitle) ? sourceTitle : '知乎'
    if (state.hotModalMode === 'edit' && state.editingHotCardId) {
      const prev = getCardById(state.editingHotCardId)
      if (prev) state.hotCache.delete(getHotSourceTitle(prev))
      await saveHotCardPatch(state.editingHotCardId, { title: safeTitle, sourceTitle: safeTitle })
    } else {
      await addHotComponent(safeTitle)
    }
    closeHotModal()
  })

  const stockOverlay = $('#stockOverlay')
  const stockCloseBtn = $('#stockCloseBtn')
  const stockCancelBtn = $('#stockCancelBtn')
  const stockForm = $('#stockForm')
  const stockTitleInput = $('#stockTitleInput')
  const stockSymbolInput = $('#stockSymbolInput')
  stockOverlay.addEventListener('click', (evt) => {
    if (evt.target === stockOverlay) closeStockModal()
  })
  stockCloseBtn.addEventListener('click', closeStockModal)
  stockCancelBtn.addEventListener('click', closeStockModal)
  $('#stockList').addEventListener('click', async (evt) => {
    const target = evt.target
    const cardId = state.editingStockCardId
    if (!cardId) return
    const card = getCardById(cardId)
    if (!card) return

    const delBtn = target?.closest?.('button[data-action="delete"]')
    if (delBtn) {
      const symbol = delBtn.getAttribute('data-symbol')
      if (!symbol) return
      openConfirm({
        title: '确认删除',
        text: `确认删除股票「${symbol}」吗？`,
        onConfirm: async () => {
          const nextSymbols = getStockSymbols(card).filter((it) => it !== symbol)
          await saveStockCardPatch(cardId, { title: getStockCardTitle(card), symbols: nextSymbols })
          const nextCard = getCardById(cardId)
          if (nextCard) renderStockList(nextCard)
          if (state.editingStockSymbol === symbol) {
            state.editingStockSymbol = null
            stockSymbolInput.value = ''
          }
        }
      })
      return
    }

    const itemEl = target?.closest?.('.stock-list-item')
    if (!itemEl) return
    const symbol = itemEl.getAttribute('data-symbol')
    if (!symbol) return
    state.editingStockSymbol = symbol
    stockSymbolInput.value = symbol
    stockTitleInput.value = getStockCardTitle(card)
  })
  stockForm.addEventListener('submit', async (evt) => {
    evt.preventDefault()
    const title = stockTitleInput.value.trim() || (getLang() === 'en' ? 'Stocks' : '股票')
    const inputSymbols = normalizeStockSymbolsInput(stockSymbolInput.value)
    if (state.stockModalMode === 'edit' && state.editingStockCardId) {
      const card = getCardById(state.editingStockCardId)
      if (!card) return
      const symbols = getStockSymbols(card)
      const symbol = inputSymbols[0]
      if (!symbol && !state.editingStockSymbol) {
        await saveStockCardPatch(state.editingStockCardId, { title, symbols })
        const nextCard = getCardById(state.editingStockCardId)
        if (nextCard) renderStockList(nextCard)
        state.editingStockSymbol = null
        stockSymbolInput.value = ''
        setError('')
        closeStockModal()
        return
      }
      if (!symbol) {
        setError(getLang() === 'en' ? 'Please input symbols' : '请输入股票代码')
        return
      }
      setError('')
      const nextSymbols = [...symbols]
      if (state.editingStockSymbol) {
        const index = nextSymbols.findIndex((it) => it === state.editingStockSymbol)
        if (index !== -1) nextSymbols[index] = symbol
      } else if (!nextSymbols.includes(symbol)) {
        nextSymbols.unshift(symbol)
      }
      // 重要逻辑：再次规范化，避免重复代码与替换后残留脏数据。
      await saveStockCardPatch(state.editingStockCardId, { title, symbols: normalizeStockSymbolsInput(nextSymbols) })
      const nextCard = getCardById(state.editingStockCardId)
      if (nextCard) renderStockList(nextCard)
    } else {
      const symbol = inputSymbols[0]
      if (!symbol) {
        setError(getLang() === 'en' ? 'Please input symbols' : '请输入股票代码')
        return
      }
      setError('')
      await addStockComponent({ title, symbols: [symbol] })
    }
    state.editingStockSymbol = null
    stockSymbolInput.value = ''
    closeStockModal()
  })

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

const initPopup = () => {
  $('#popupConfirmBtn').addEventListener('click', async () => {
    $('#popupOverlay').hidden = true
    state.config.popupTipDismissed = true
    await saveConfig({ popupTipDismissed: true })

    const pending = state.pendingSearch
    state.pendingSearch = null
    if (!pending) return

    const res = await send({ type: 'openTabs', urls: pending.urls })
    if (!res?.ok) {
      setError(res?.error || '打开标签页失败')
      return
    }
    if (pending.shouldAddToHistory) await addToHistory(pending.keyword)
  })
}

const initSettingsModal = () => {
  const overlay = $('#settingsOverlay')
  const openBtn = $('#openSettingsBtn')
  const closeBtn = $('#settingsCloseBtn')
  const title = $('#settingsTitle')
  const status = $('#syncStatus')

  const setStatus = (text, kind = 'info') => {
    status.textContent = text || ''
    if (kind === 'error') status.style.color = '#ff4848'
    else if (kind === 'ok') status.style.color = '#00f2ff'
    else status.style.color = 'rgba(255,255,255,0.7)'
  }

  const getFormSync = () => ({
    ...(() => {
      const gitUrl = $('#syncGitUrl').value.trim()
      const parsed = parseGitRemote(gitUrl)
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
    const normalized = normalizeSync(sync)
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
    selectTab('sync')
  }

  const close = () => {
    overlay.hidden = true
    setStatus('')
  }

  const selectTab = (tab) => {
    for (const btn of document.querySelectorAll('.settings-item')) {
      btn.classList.toggle('active', btn.dataset.tab === tab)
    }
    $('#settingsPanelSync').hidden = tab !== 'sync'
    $('#settingsPanelLanguage').hidden = tab !== 'language'
    $('#settingsPanelAbout').hidden = tab !== 'about'
    const dict = I18N[getLang()] || I18N.zh
    title.textContent = tab === 'sync' ? dict.settings_sync : tab === 'language' ? dict.settings_language : dict.settings_about
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
    state.config.searchHistory = []
    await saveConfig({ searchHistory: [] })
    renderHistory()
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
    if (target.closest('.cards-section, .history-sidebar, .card, .card-menu, .modal-overlay, .settings-overlay, .popup-overlay')) return

    const settingsOverlay = $('#settingsOverlay')
    if (settingsOverlay && !settingsOverlay.hasAttribute('hidden') && target.closest('#settingsOverlay')) return

    const popupOverlay = $('#popupOverlay')
    if (popupOverlay && !popupOverlay.hasAttribute('hidden') && target.closest('#popupOverlay')) return

    // 点击空白区域时，主动聚焦搜索框
    $('#keywordInput')?.focus()
  })
}

const main = async () => {
  const res = await send({ type: 'getConfig' })
  state.config = res?.data

  applyLanguage()
  renderEngines()
  renderHistory()
  renderCards()
  initSearchForm()
  initBlankClickFocus()
  initHistory()
  initPopup()
  initCardUi()
  initSettingsModal()
  $('#keywordInput').focus()

  // 性能优化：启动同步属于非首屏关键路径任务，延迟到空闲时执行，避免“打开新标签页时卡顿”。
  runWhenIdle(async () => {
    // 启动时若开启自动同步，执行一次拉取 + 推送。
    await runStartupSync({
      sync: normalizeSync(state.config?.sync),
      send,
      setStatus: setSyncStatus,
      renderLastSyncAt
    })
  }, 1500)
}

main().catch((err) => setError(err?.message || String(err)))
