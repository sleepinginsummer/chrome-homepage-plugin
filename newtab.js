const $ = (selector) => document.querySelector(selector)

const state = {
  config: null,
  pendingSearch: null,
  scrollProgress: 0,
  editingCardId: null,
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
    search_btn: '搜索',
    clear_history: '清空历史',
    popup_title: '请允许弹出窗口',
    popup_desc: '首次使用多引擎搜索时，Chrome 可能会拦截多个标签页。建议在设置中允许来自扩展新标签页的弹窗。',
    common_ok: '知道了',
    settings_sync: '同步设置',
    settings_language: '语言',
    settings_about: '关于',
    language_label: '语言',
    sync_giturl: 'Git 地址',
    sync_giturl_ph: '例如：git@github.com:owner/repo.git',
    sync_token: 'Token',
    sync_token_ph: 'GitHub Token / Gitee 私人令牌',
    sync_token_hint: 'token 仅保存在 `chrome.storage.sync`；推送/拉取时会使用。',
    sync_autopush: '自动同步',
    sync_autopush_desc: '配置变更后自动推送到远端',
    common_save: '保存',
    sync_push: '推送到远端',
    sync_pull: '从远端拉取',
    sync_test: '测试连接',
    card_title: '标题',
    card_title_ph: '例如：Google',
    card_url: '网址',
    card_url_ph: '例如：https://example.com',
    card_icon: 'Icon（选填，默认使用网站icon）',
    card_icon_ph: '例如：https://example.com/icon.png',
    common_cancel: '取消',
    confirm_title: '确认删除',
    common_confirm: '确认'
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
    sync_giturl: 'Git URL',
    sync_giturl_ph: 'e.g. git@github.com:owner/repo.git',
    sync_token: 'Token',
    sync_token_ph: 'GitHub Token / Gitee token',
    sync_token_hint: 'Token is stored only in `chrome.storage.sync`; used for push/pull.',
    sync_autopush: 'Auto Sync',
    sync_autopush_desc: 'Auto push changes to remote',
    common_save: 'Save',
    sync_push: 'Push',
    sync_pull: 'Pull',
    sync_test: 'Test',
    card_title: 'Title',
    card_title_ph: 'e.g. Google',
    card_url: 'URL',
    card_url_ph: 'e.g. https://example.com',
    card_icon: 'Icon (optional, fallback to site icon)',
    card_icon_ph: 'e.g. https://example.com/icon.png',
    common_cancel: 'Cancel',
    confirm_title: 'Confirm delete',
    common_confirm: 'Confirm'
  }
}

const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'

const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) return null

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) return { provider: 'gitee_gist', gistId: giteeCodes[1] }

  const scpLike = raw.match(/^git@([^:]+):(.+)$/i)
  const normalized = scpLike ? `ssh://${raw.replace(':', '/')}` : raw

  let url
  try {
    url = new URL(normalized)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  const provider = host.includes('gitee.com') ? 'gitee' : host.includes('github.com') ? 'github' : null
  if (!provider) return null

  const parts = url.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/').filter(Boolean)
  if (parts.length < 2) return null

  return { provider, owner: parts[0], repo: parts[1] }
}

const normalizeSync = (sync) => {
  const raw = sync || {}
  const parsed = parseGitRemote(raw.gitUrl)
  return {
    gitUrl: raw.gitUrl || '',
    token: raw.token || '',
    autoPush: Boolean(raw.autoPush),
    provider: raw.provider || parsed?.provider || 'github',
    owner: raw.owner || parsed?.owner || '',
    repo: raw.repo || parsed?.repo || '',
    gistId: raw.gistId || parsed?.gistId || '',
    path: raw.path || DEFAULT_SYNC_PATH
  }
}

const getLang = () => (state.config?.ui?.language === 'en' ? 'en' : 'zh')

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

const faviconUrl = (url) => {
  const hostname = getHostname(url)
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
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
    const div = document.createElement('div')
    div.className = 'card'
    div.draggable = true
    div.dataset.cardId = card.id
    div.innerHTML = `
      <img class="card-icon" alt="" />
      <div class="card-title"></div>
    `

    const icon = div.querySelector('.card-icon')
    const fallbackIcon = faviconUrl(card.url)
    icon.src = card.icon || fallbackIcon
    icon.addEventListener(
      'error',
      () => {
        icon.src = fallbackIcon
      },
      { once: true }
    )
    div.querySelector('.card-title').textContent = card.title

    div.addEventListener('click', async (evt) => {
      if (state.isDraggingCard) return
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
  addCard.addEventListener('click', () => openCardModal({ mode: 'create' }))
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

  const getCardById = (id) => (state.config.cards || []).find((c) => c.id === id) || null

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
    }
  })

  editBtn.addEventListener('click', () => {
    const card = getCardById(state.contextCardId)
    if (!card) return closeCardMenu()
    openCardModal({ mode: 'edit', card })
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
          : parsed
            ? { provider: parsed.provider, owner: parsed.owner, repo: parsed.repo }
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
