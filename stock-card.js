/**
 * @fileoverview
 * 股票卡片的纯渲染层：HTML 模板、DOM 更新与价格/涨跌格式化。
 *
 * 注意：
 * - 不读页面 i18n 与全局状态，文案与语言都由参数传入，便于直接测试。
 * - 更新时间跟随语言使用 zh-CN / en-US 时区格式。
 */

const escapeHtml = (raw) =>
  String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * 获取股票卡片标题，缺省时回退到本地化默认标题。
 */
export const getStockCardTitle = (card, lang) =>
  String(card?.title || (lang === 'en' ? 'Stocks' : '股票')).trim()

/**
 * 格式化股票价格展示。
 */
export const formatStockPrice = (price, currency) => {
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
export const formatStockChange = (change, changePercent) => {
  if (typeof change !== 'number' || Number.isNaN(change)) return '--'
  const sign = change > 0 ? '+' : ''
  const percent = typeof changePercent === 'number' && !Number.isNaN(changePercent) ? ` (${sign}${changePercent.toFixed(2)}%)` : ''
  return `${sign}${change.toFixed(2)}${percent}`
}

/**
 * 获取涨跌样式类名。
 */
export const getStockChangeClass = (change) => {
  if (typeof change !== 'number' || Number.isNaN(change) || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/**
 * 格式化行情更新时间（腾讯接口给的是秒级时间戳）。
 */
export const formatMarketTime = (unixSeconds, lang) => {
  if (typeof unixSeconds !== 'number') return ''
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: lang === 'en' })
}

/**
 * 生成股票卡片 HTML。
 *
 * @param {any} card 卡片配置。
 * @param {{text: object, lang: string}} options 文案与语言。
 */
export const renderStockCardHtml = (card, { text, lang }) => `
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
        <div class="card-head-title">${escapeHtml(getStockCardTitle(card, lang))}</div>
        <div class="card-head-time" data-stock-updated-at></div>
      </div>
      <div class="stock-list-mini" data-stock-list>
        <div class="stock-empty">${escapeHtml(text.loading)}</div>
      </div>
    </div>
  `

/**
 * 更新股票卡片 DOM 展示。
 *
 * @param {{cardEl: object, renderToken: string, items?: Array<any>, errorText?: string, text: object, lang: string}} params 渲染参数。
 */
export const updateStockCardDom = ({ cardEl, renderToken, items, errorText, text, lang }) => {
  if (!cardEl || cardEl.dataset.stockRenderToken !== renderToken) return
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
    listEl.innerHTML = '<div class="stock-empty">暂无数据</div>'
    return
  }

  const latestMarketTime = items.map((it) => it?.marketTime).find((it) => typeof it === 'number')
  if (updatedAtEl) updatedAtEl.textContent = formatMarketTime(latestMarketTime, lang)

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
 * 生成股票编辑弹窗里的代码列表 HTML。
 *
 * @param {{symbols: string[], items?: Array<any>}} params 代码列表与已缓存的行情。
 * @returns {string} 列表 HTML，无代码时返回空态提示。
 */
export const renderStockEditorHtml = ({ symbols, items }) => {
  const list = Array.isArray(symbols) ? symbols : []
  if (!list.length) return '<div class="editor-empty">暂无股票，右侧新增一个吧</div>'

  const cachedMap = new Map((Array.isArray(items) ? items : []).map((it) => [String(it?.symbol || '').toUpperCase(), it]))
  return list
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
