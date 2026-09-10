/**
 * @fileoverview
 * 搜索与历史控制器：引擎选择、发起搜索、历史侧栏与清空。
 *
 * 设计目标：
 * - 配置读写走页面注入的 applyConfig/saveConfig，控制器不直接持有页面 state。
 * - 历史仍然存在配置里（config-store 负责追加去重），这里只负责展示与触发。
 *
 * 注意：
 * - 搜索前先落盘历史：openTabs 会导航并卸载当前页面，晚一步就会丢记录。
 * - 重复提交用内部 isSearching 拦截，避免连点开出多批标签页。
 */

const HISTORY_ITEM_HEIGHT = 50
const HISTORY_PADDING = 150
const HISTORY_MAX_DISTANCE = 200

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 按选中的引擎生成搜索地址，顺序与配置里的 engines 一致。
 *
 * @param {Array<{name: string, baseUrl: string}>} engines 全部引擎。
 * @param {string} keyword 关键词。
 * @param {string[]} selectedEngines 选中的引擎名。
 * @returns {string[]} 搜索地址列表。
 */
export const computeSearchUrls = (engines, keyword, selectedEngines) => {
  const encoded = encodeURIComponent(keyword)
  const allowed = new Set(Array.isArray(selectedEngines) ? selectedEngines : [])
  return (Array.isArray(engines) ? engines : [])
    .filter((engine) => allowed.has(engine?.name))
    .map((engine) => `${engine.baseUrl}${encoded}`)
}

/**
 * 创建搜索与历史控制器。
 *
 * @param {object} options
 * @param {function(): object} options.getConfig 读取当前配置。
 * @param {function(object): void} options.applyConfig 写入控制器从后台拿到的最新配置。
 * @param {function(object): Promise<void>} options.saveConfig 持久化配置补丁（引擎选择、清空历史）。
 * @param {function(object): Promise<object>} options.send 扩展内部消息发送。
 * @param {function(string=): void} [options.setError] 页面级错误提示位。
 * @param {function(): void} [options.afterConfigChange] 配置写入后的收尾（自动推送调度）。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ renderEngines: function(): void, renderHistory: function(): void,
 *   triggerSearch: function({shouldAddToHistory: boolean}): Promise<void>,
 *   bindSearchForm: function(): void, bindHistoryUi: function(): void,
 *   isSearching: function(): boolean }}
 */
export const createSearchController = ({
  getConfig,
  applyConfig,
  saveConfig,
  send,
  setError,
  afterConfigChange,
  root = getDocument()
}) => {
  // 重要逻辑：搜索进行中标记，避免连点重复导航。
  let searching = false
  let scrollProgress = 0

  const $ = (selector) => root?.querySelector?.(selector) || null

  const getHistory = () => {
    const history = getConfig()?.searchHistory
    return Array.isArray(history) ? history : []
  }

  /**
   * 渲染引擎选择列表；勾选变化后持久化并触发自动推送调度。
   */
  const renderEngines = () => {
    const container = $('#engineSelection')
    if (!container) return
    container.innerHTML = ''
    for (const engine of getConfig()?.engines || []) {
      const label = root?.createElement?.('label')
      label.className = 'engine-checkbox'

      const input = root?.createElement?.('input')
      input.type = 'checkbox'
      input.value = engine.name
      input.checked = (getConfig()?.selectedEngines || []).includes(engine.name)

      const checkbox = root?.createElement?.('div')
      checkbox.className = 'checkbox-custom'
      checkbox.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `

      const name = root?.createElement?.('span')
      name.className = 'engine-name'
      name.textContent = engine.name

      label.append(input, checkbox, name)
      container.appendChild(label)

      const syncActive = () => {
        label.classList.toggle('active', input.checked)
      }
      syncActive()

      input.addEventListener('change', async () => {
        const nextSelected = new Set(getConfig()?.selectedEngines || [])
        if (input.checked) nextSelected.add(engine.name)
        else nextSelected.delete(engine.name)

        const selectedEngines = [...nextSelected]
        applyConfig({ ...getConfig(), selectedEngines })
        syncActive()

        await saveConfig({ selectedEngines })
        afterConfigChange?.()
      })
    }
  }

  /**
   * 追加历史：在存储层基于最新历史追加，避免多个新标签页拿旧数组互相覆盖。
   */
  const addToHistory = async (term) => {
    const res = await send({ type: 'addSearchHistory', keyword: term })
    if (!res?.ok) throw new Error(res?.error || '历史记录保存失败')
    applyConfig(res.data)
    renderHistory()
  }

  const scrollHistoryToCenter = (index) => {
    const list = $('#historyList')
    if (!list) return
    const itemCenter = HISTORY_PADDING + index * HISTORY_ITEM_HEIGHT + HISTORY_ITEM_HEIGHT / 2
    list.scrollTo({ top: itemCenter - list.clientHeight / 2, behavior: 'smooth' })
  }

  const updateHistoryTransforms = () => {
    const list = $('#historyList')
    if (!list) return
    const items = Array.from(root?.querySelectorAll?.('.history-item') || [])
    const centerOffset = list.clientHeight / 2
    scrollProgress = list.scrollTop + centerOffset

    for (const div of items) {
      const index = Number(div.dataset.index || 0)
      const itemCenter = index * HISTORY_ITEM_HEIGHT + HISTORY_ITEM_HEIGHT / 2 + HISTORY_PADDING
      const normalized = Math.min(Math.abs(scrollProgress - itemCenter), HISTORY_MAX_DISTANCE) / HISTORY_MAX_DISTANCE
      div.style.transform = `scale(${1 - normalized * 0.3})`
      div.style.opacity = String(1 - normalized * 0.7)
      div.style.filter = `blur(${normalized * 2}px)`
    }
  }

  const renderHistory = () => {
    const sidebar = $('#historySidebar')
    const footer = $('#historyFooter')
    const itemsRoot = $('#historyItems')
    if (!itemsRoot) return
    itemsRoot.innerHTML = ''

    const history = getHistory()
    sidebar?.classList.toggle('has-items', history.length > 0)
    if (footer) footer.hidden = history.length === 0

    history.forEach((term, index) => {
      const div = root?.createElement?.('div')
      div.className = 'history-item'
      div.dataset.index = String(index)
      div.innerHTML = '<span class="history-text"></span>'
      div.querySelector('.history-text').textContent = term
      div.addEventListener('click', async () => {
        const input = $('#keywordInput')
        if (input) input.value = term
        await triggerSearch({ shouldAddToHistory: false })
        scrollHistoryToCenter(index)
      })
      itemsRoot.appendChild(div)
    })

    requestAnimationFrame(updateHistoryTransforms)
  }

  const triggerSearch = async ({ shouldAddToHistory }) => {
    if (searching) return
    const keyword = $('#keywordInput')?.value.trim()
    if (!keyword) {
      setError?.('请输入关键词')
      return
    }
    const urls = computeSearchUrls(getConfig()?.engines, keyword, getConfig()?.selectedEngines || [])
    if (!urls.length) {
      setError?.('请至少选择一个搜索引擎')
      return
    }
    setError?.('')

    searching = true
    try {
      // openTabs 会导航并卸载当前页面，必须先确认历史已持久化。
      if (shouldAddToHistory) await addToHistory(keyword)
      const res = await send({ type: 'openTabs', urls })
      if (!res?.ok) setError?.(res?.error || '打开标签页失败')
    } catch (err) {
      setError?.(err?.message || '搜索失败，请重试')
    } finally {
      searching = false
    }
  }

  /**
   * 绑定搜索表单与清空历史的交互。
   */
  const bindSearchForm = () => {
    $('#searchForm')?.addEventListener('submit', async (evt) => {
      evt.preventDefault()
      await triggerSearch({ shouldAddToHistory: true })
    })
    $('#keywordInput')?.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Escape') return
      const input = $('#keywordInput')
      if (input) input.value = ''
      setError?.('')
    })
  }

  const bindHistoryUi = () => {
    $('#clearHistoryBtn')?.addEventListener('click', async () => {
      try {
        await saveConfig({ searchHistory: [] })
        renderHistory()
        setError?.('')
      } catch (err) {
        setError?.(err?.message || '清空历史失败')
      }
    })
    $('#historyList')?.addEventListener('scroll', () => updateHistoryTransforms())
  }

  return { renderEngines, renderHistory, triggerSearch, bindSearchForm, bindHistoryUi, isSearching: () => searching }
}
