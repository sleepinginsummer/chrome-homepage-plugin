const $ = (selector) => document.querySelector(selector)

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
  isDraggingCard: false,
  contextCardId: null,
  confirmAction: null
}

const send = (payload) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response))
  })

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
    hint: 'ONE INPUT, MULTIPLE ENGINES. INSTANT ACCESS.',
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
    component_anniversary: '纪念日',
    hot_source_label: '来源',
    anniversary_title: '纪念日',
    anniversary_item_title: '标题',
    anniversary_item_title_ph: '例如：小胖达生日',
    anniversary_item_date: '日期'
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
    component_anniversary: 'Anniversary',
    hot_source_label: 'Source',
    anniversary_title: 'Anniversary',
    anniversary_item_title: 'Title',
    anniversary_item_title_ph: 'e.g. Birthday',
    anniversary_item_date: 'Date'
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

const faviconAggregatedUrl = (hostname) => `https://favicon.im/${encodeURIComponent(hostname)}?larger=true`

const faviconCandidates = (url) => {
  const normalized = normalizeUrl(url)
  try {
    const u = new URL(normalized)
    const hostname = u.hostname
    return [`${u.origin}/favicon.ico`, faviconAggregatedUrl(hostname)]
  } catch {
    const hostname = getHostname(url)
    return [faviconAggregatedUrl(hostname)]
  }
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
  const cards = state.config.cards || []
  for (const card of cards) {
    const type = card?.type || 'link'
    const div = document.createElement('div')
    div.className = type === 'anniversary' ? 'card card-anniversary' : type === 'hot' ? 'card card-hot' : 'card'
    div.draggable = true
    div.dataset.cardId = card.id
    if (type === 'anniversary') {
      div.innerHTML = renderAnniversaryCardHtml(card)
    } else if (type === 'hot') {
      div.innerHTML = renderHotCardHtml(card)
    } else {
      div.innerHTML = `
        <img class="card-icon" alt="" />
        <div class="card-title"></div>
      `

      const icon = div.querySelector('.card-icon')
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
          if (url) await send({ type: 'openTabs', urls: [url] })
          return
        }

        openHotModal({ mode: 'edit', cardId: card.id })
        return
      }
      await send({ type: 'openTabs', urls: [card.url] })
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
      void ensureHotDataForCard(card, { cardEl: div, renderToken })
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
  next.unshift({
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

  const mini = items.slice(0, 4).map((it) => {
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
  next.unshift({
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

const getHotSourceTitle = (card) => String(card?.sourceTitle || card?.title || '知乎')

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

const ensureHotDataForCard = async (card, { cardEl, renderToken }) => {
  const sourceTitle = getHotSourceTitle(card)
  const cached = state.hotCache.get(sourceTitle)
  const now = Date.now()
  if (cached && now - cached.ts < 5 * 60 * 1000 && Array.isArray(cached.items)) {
    updateHotCardDom({ cardEl, renderToken, items: cached.items })
    return
  }

  try {
    const raw = await fetchJsonWithTimeout(getHotApiUrl(sourceTitle), 9000)
    const items = parseHotApiData(raw)
    state.hotCache.set(sourceTitle, { ts: Date.now(), items })
    updateHotCardDom({ cardEl, renderToken, items })
  } catch {
    updateHotCardDom({ cardEl, renderToken, items: [], errorText: '加载失败，点击刷新重试' })
  }
}

const refreshHotCard = async (cardId) => {
  const card = getCardById(cardId)
  if (!card || (card.type || 'link') !== 'hot') return
  state.hotCache.delete(getHotSourceTitle(card))
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
  next.unshift({
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
      else if (!$('#componentListOverlay').hidden) closeComponentList()
      else if (!$('#addChooserOverlay').hidden) closeAddChooser()
    }
  })

  editBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    if ((card?.type || 'link') === 'anniversary') openAnniversaryModal(card.id)
    else if ((card?.type || 'link') === 'hot') openHotModal({ mode: 'edit', cardId: card.id })
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
  const componentAnniversaryBtn = $('#componentAnniversaryBtn')
  componentListOverlay.addEventListener('click', (evt) => {
    if (evt.target === componentListOverlay) closeComponentList()
  })
  componentListClose.addEventListener('click', closeComponentList)
  componentHotBtn.addEventListener('click', () => openHotModal({ mode: 'create' }))
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

const main = async () => {
  const res = await send({ type: 'getConfig' })
  state.config = res?.data

  applyLanguage()
  renderEngines()
  renderHistory()
  renderCards()
  initSearchForm()
  initHistory()
  initPopup()
  initCardUi()
  initSettingsModal()

  $('#keywordInput').focus()
}

main().catch((err) => setError(err?.message || String(err)))
