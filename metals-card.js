/**
 * @fileoverview
 * 黄金白银卡片的纯渲染层：HTML 模板、DOM 更新与价格/时间格式化。
 *
 * 注意：
 * - 不读页面 i18n 与全局状态，文案与语言都由参数传入，便于直接测试。
 * - formatUpdateTime 兼容 Date / 秒级时间戳 / 时间文本三种输入（历史遗留调用形态）。
 */

const escapeHtml = (raw) =>
  String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * 按普通数值格式化价格，避免给页面抓取值附带额外货币符号。
 *
 * @param {number|null} value 数值。
 * @param {number} [digits] 保留小数位。
 * @returns {string} 格式化后的文本。
 */
export const formatPlainPrice = (value, digits = 2) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--'
  return value.toFixed(digits)
}

/**
 * 把秒级时间戳格式化为本地时刻。
 */
const formatUnixTime = (unixSeconds, lang) => {
  if (typeof unixSeconds !== 'number') return ''
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const locale = lang === 'en' ? 'en-US' : 'zh-CN'
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: lang === 'en' })
}

/**
 * 格式化卡片顶部更新时间。
 *
 * @param {string|number|Date|null|undefined} value 原始时间值。
 * @param {string} lang 当前语言。
 * @returns {string} 适合展示在卡片标题后的时间文本。
 */
export const formatUpdateTime = (value, lang) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const locale = lang === 'en' ? 'en-US' : 'zh-CN'
    return value.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: lang === 'en' })
  }

  if (typeof value === 'number') return formatUnixTime(value, lang)

  const text = String(value || '').trim()
  if (!text) return ''
  const date = new Date(text)
  // 能被解析的时间文本（如「2026-09-10 20:00」）转成时刻展示，其余原样返回。
  if (Number.isNaN(date.getTime())) return text
  return formatUpdateTime(date, lang)
}

/**
 * 生成黄金白银卡片 HTML。
 *
 * @param {any} card 卡片配置。
 * @param {{text: object, lang: string}} options 文案与语言。
 * @returns {string} 卡片 HTML。
 */
export const renderMetalsCardHtml = (card, { text, lang }) => {
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
 * 更新黄金白银卡片 DOM。
 *
 * @param {{cardEl: object, renderToken: string, items?: Array<any>, errorText?: string, text: object, lang: string}} params 渲染参数。
 */
export const updateMetalsCardDom = ({ cardEl, renderToken, items, errorText, text, lang }) => {
  if (!cardEl || cardEl.dataset.metalsRenderToken !== renderToken) return
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
  if (updatedAtEl) updatedAtEl.textContent = formatUpdateTime(latestTimeText, lang)

  gridEl.innerHTML = items
    .map((item) => {
      // 标题在渲染时才映射语言，缓存里只存 gold/silver 这类稳定 key。
      const itemTitle = item?.key === 'silver' ? text.silver : text.gold
      const usdValue = escapeHtml(formatPlainPrice(item?.usdPrice, 2))
      const cnyValue = escapeHtml(formatPlainPrice(item?.cnyPrice, 2))
      const changeUsdText =
        typeof item?.changeUsd === 'number' && !Number.isNaN(item.changeUsd) ? escapeHtml(formatPlainPrice(item.changeUsd, 2)) : ''
      const changeCnyText =
        typeof item?.changeCny === 'number' && !Number.isNaN(item.changeCny) ? escapeHtml(formatPlainPrice(item.changeCny, 2)) : ''
      return `
        <div class="metals-item">
          <div class="metals-item-title">${escapeHtml(itemTitle)}</div>
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
