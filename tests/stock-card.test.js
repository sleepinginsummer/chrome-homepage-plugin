import { describe, expect, it } from 'vitest'
import {
  formatMarketTime,
  formatStockChange,
  formatStockPrice,
  getStockCardTitle,
  getStockChangeClass,
  renderStockCardHtml,
  renderStockEditorHtml,
  updateStockCardDom
} from '../stock-card.js'

const TEXT = { liveLabel: '实时行情', updatedAt: '更新于', loading: '加载中...', empty: '暂无数据', error: '加载失败，点击刷新重试' }
const LIST_SELECTOR = '[data-stock-list]'
const UPDATED_AT_SELECTOR = '[data-stock-updated-at]'

const createCardEl = (renderToken = 'token-1') => {
  const list = { innerHTML: '' }
  const updatedAt = { textContent: '' }
  return {
    dataset: { stockRenderToken: renderToken },
    querySelector: (selector) => (selector === LIST_SELECTOR ? list : selector === UPDATED_AT_SELECTOR ? updatedAt : null),
    list,
    updatedAt
  }
}

const ITEMS = [
  { symbol: '600000', name: '浦发银行', price: 10.5, change: 0.5, changePercent: 5, currency: 'CNY', marketTime: 1789000000 }
]

describe('stock card render', () => {
  it('renders the card shell with the localized title and loading text', () => {
    const html = renderStockCardHtml({ title: '<股票>' }, { text: TEXT, lang: 'zh' })

    expect(html).toContain('&lt;股票&gt;')
    expect(html).not.toContain('<股票>')
    expect(html).toContain(TEXT.loading)
    expect(html).toContain('data-stock-action="refresh"')
    expect(html).toContain('data-stock-list')
  })

  it('falls back to the localized default title', () => {
    expect(getStockCardTitle({}, 'en')).toBe('Stocks')
    expect(getStockCardTitle({}, 'zh')).toBe('股票')
    expect(renderStockCardHtml({}, { text: TEXT, lang: 'en' })).toContain('Stocks')
  })

  it.each([
    [10.5, 'CNY', '10.50'],
    [null, 'CNY', '--'],
    [undefined, 'USD', '--']
  ])('formats price %s (%s) as %s', (price, currency, expected) => {
    expect(formatStockPrice(price, currency)).toBe(expected)
  })

  it('formats US prices with a currency symbol', () => {
    expect(formatStockPrice(200, 'USD')).toBe('$200.00')
  })

  it.each([
    [0.5, 5, '+0.50 (+5.00%)'],
    [-0.5, -5, '-0.50 (-5.00%)'],
    [0, 0, '0.00 (0.00%)'],
    [null, null, '--']
  ])('formats change %s / %s as %s', (change, percent, expected) => {
    expect(formatStockChange(change, percent)).toBe(expected)
  })

  it.each([
    [1, 'up'],
    [-1, 'down'],
    [0, 'flat'],
    [null, 'flat']
  ])('maps change %s to class %s', (change, expected) => {
    expect(getStockChangeClass(change)).toBe(expected)
  })

  it('formats the market time with the language locale', () => {
    expect(formatMarketTime('not-a-number', 'zh')).toBe('')
    const text = formatMarketTime(1789000000, 'zh')
    expect(text).toBe(new Date(1789000000 * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
  })
})

describe('stock card dom', () => {
  it('ignores stale render tokens', () => {
    const cardEl = createCardEl('token-new')

    updateStockCardDom({ cardEl, renderToken: 'token-old', items: ITEMS, text: TEXT, lang: 'zh' })

    expect(cardEl.list.innerHTML).toBe('')
  })

  it('renders the quote rows and the update time', () => {
    const cardEl = createCardEl()

    updateStockCardDom({ cardEl, renderToken: 'token-1', items: ITEMS, text: TEXT, lang: 'zh' })

    expect(cardEl.list.innerHTML).toContain('浦发银行')
    expect(cardEl.list.innerHTML).toContain('10.50')
    expect(cardEl.list.innerHTML).toContain('stock-mini-change up')
    expect(cardEl.list.innerHTML).toContain('data-stock-symbol="600000"')
    expect(cardEl.updatedAt.textContent).toBe(formatMarketTime(ITEMS[0].marketTime, 'zh'))
  })

  it('renders the error and empty states', () => {
    const cardEl = createCardEl()

    updateStockCardDom({ cardEl, renderToken: 'token-1', items: [], errorText: TEXT.error, text: TEXT, lang: 'zh' })
    expect(cardEl.list.innerHTML).toContain(TEXT.error)
    expect(cardEl.updatedAt.textContent).toBe('')

    updateStockCardDom({ cardEl, renderToken: 'token-1', items: [], text: TEXT, lang: 'zh' })
    expect(cardEl.list.innerHTML).toContain('暂无数据')
  })
})

describe('stock editor list', () => {
  it('renders an empty hint without symbols', () => {
    expect(renderStockEditorHtml({ symbols: [] })).toContain('editor-empty')
  })

  it('uses cached quotes when available and falls back to the symbol', () => {
    const html = renderStockEditorHtml({ symbols: ['600000', '300750'], items: ITEMS })

    expect(html).toContain('浦发银行')
    expect(html).toContain('10.50 · +0.50 (+5.00%)')
    expect(html).toContain('data-symbol="300750"')
    // 没有缓存的代码只展示代码本身。
    expect(html).toContain('<div class="name">300750</div>')
    expect(html).toContain('data-action="delete"')
  })
})
