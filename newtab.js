const $ = (selector) => document.querySelector(selector)

const STORAGE_DEFAULT_SELECTED = ['GOOGLE', 'BING', 'BAIDU']

const state = {
  config: null,
  pendingSearch: null,
  scrollProgress: 0
}

const send = (payload) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response))
  })

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

      if (state.config.rememberSelections) {
        await saveConfig({ selectedEngines: state.config.selectedEngines })
      }
    })
  }
}

const renderRemember = () => {
  const checkbox = $('#rememberCheckbox')
  checkbox.checked = Boolean(state.config.rememberSelections)
  const label = $('#rememberOption')
  label.classList.toggle('active', checkbox.checked)

  checkbox.addEventListener('change', async () => {
    state.config.rememberSelections = checkbox.checked
    label.classList.toggle('active', checkbox.checked)

    if (!checkbox.checked) {
      await saveConfig({ rememberSelections: false, selectedEngines: STORAGE_DEFAULT_SELECTED })
      state.config.selectedEngines = [...STORAGE_DEFAULT_SELECTED]
      renderEngines()
      return
    }
    await saveConfig({ rememberSelections: true, selectedEngines: state.config.selectedEngines })
  })
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
    div.innerHTML = `
      <img class="card-icon" alt="" />
      <div class="card-text">
        <div class="card-title"></div>
        <div class="card-url"></div>
      </div>
      <button class="card-delete" type="button" title="删除">×</button>
    `

    const icon = div.querySelector('.card-icon')
    icon.src = faviconUrl(card.url)
    div.querySelector('.card-title').textContent = card.title
    div.querySelector('.card-url').textContent = getHostname(card.url)

    div.addEventListener('click', async (evt) => {
      const target = evt.target
      if (target && target.classList.contains('card-delete')) return
      await send({ type: 'openTabs', urls: [card.url] })
    })

    div.querySelector('.card-delete').addEventListener('click', async (evt) => {
      evt.stopPropagation()
      await deleteCard(card.id)
    })

    root.appendChild(div)
  }
}

const saveConfig = async (patch) => {
  const res = await send({ type: 'setConfig', data: patch })
  if (!res?.ok) throw new Error(res?.error || '保存失败')
  state.config = res.data
  return res.data
}

const addCard = async ({ title, url }) => {
  const next = [...(state.config.cards || [])]
  next.unshift({
    id: crypto.randomUUID(),
    title,
    url
  })
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
}

const deleteCard = async (id) => {
  const next = (state.config.cards || []).filter((c) => c.id !== id)
  state.config.cards = next
  await saveConfig({ cards: next })
  renderCards()
}

const initCardEditor = () => {
  const editor = $('#cardEditor')
  const addBtn = $('#addCardBtn')
  const cancelBtn = $('#cancelCardBtn')
  const titleInput = $('#cardTitleInput')
  const urlInput = $('#cardUrlInput')

  const show = () => {
    editor.hidden = false
    titleInput.value = ''
    urlInput.value = ''
    titleInput.focus()
  }
  const hide = () => {
    editor.hidden = true
    setError('')
  }

  addBtn.addEventListener('click', show)
  cancelBtn.addEventListener('click', hide)

  editor.addEventListener('submit', async (evt) => {
    evt.preventDefault()
    const title = titleInput.value.trim()
    const url = normalizeUrl(urlInput.value)
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
    await addCard({ title, url })
    hide()
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

const initOptionsButton = () => {
  $('#openOptionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage())
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

  if (!state.config.rememberSelections) {
    state.config.selectedEngines = [...STORAGE_DEFAULT_SELECTED]
  }

  renderEngines()
  renderRemember()
  renderHistory()
  renderCards()
  initSearchForm()
  initHistory()
  initPopup()
  initCardEditor()
  initOptionsButton()

  $('#keywordInput').focus()
}

main().catch((err) => setError(err?.message || String(err)))
