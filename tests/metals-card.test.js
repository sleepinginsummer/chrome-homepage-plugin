import { describe, expect, it } from 'vitest'
import { formatPlainPrice, formatUpdateTime, renderMetalsCardHtml, updateMetalsCardDom } from '../metals-card.js'

const TEXT_ZH = {
  title: '黄金白银',
  gold: '国际金价',
  silver: '国际银价',
  usd: '美元',
  cny: '人民币',
  loading: '加载中...',
  error: '加载失败，点击刷新重试'
}

const TEXT_EN = { ...TEXT_ZH, title: 'Gold & Silver', gold: 'Gold', silver: 'Silver', usd: 'USD', cny: 'CNY', loading: 'Loading...' }

const GRID_SELECTOR = '[data-metals-grid]'
const UPDATED_AT_SELECTOR = '[data-metals-updated-at]'

const ITEMS = [
  { key: 'gold', usdPrice: 2400.5, cnyPrice: 560.25, timeText: '2026-09-10 20:00', changeUsd: null, changeCny: null },
  { key: 'silver', usdPrice: 28.4, cnyPrice: 6.6, timeText: '', changeUsd: 0.12, changeCny: 0.03 }
]

const createCardEl = (renderToken = 'token-1') => {
  const grid = { innerHTML: '' }
  const updatedAt = { textContent: '' }
  return {
    dataset: { metalsRenderToken: renderToken },
    querySelector: (selector) => (selector === GRID_SELECTOR ? grid : selector === UPDATED_AT_SELECTOR ? updatedAt : null),
    grid,
    updatedAt
  }
}

describe('metals card render', () => {
  it('renders the shell with the card title and loading placeholder', () => {
    const html = renderMetalsCardHtml({ title: '<金银>' }, { text: TEXT_ZH, lang: 'zh' })

    expect(html).toContain('&lt;金银&gt;')
    expect(html).not.toContain('<金银>')
    expect(html).toContain(TEXT_ZH.loading)
    expect(html).toContain('data-metals-action="refresh"')
  })

  it('falls back to the localized default title', () => {
    expect(renderMetalsCardHtml({}, { text: TEXT_ZH, lang: 'zh' })).toContain('黄金白银')
    expect(renderMetalsCardHtml({}, { text: TEXT_EN, lang: 'en' })).toContain('Gold &amp; Silver')
  })
})

describe('metals card dom', () => {
  it('ignores stale render tokens', () => {
    const cardEl = createCardEl('token-new')

    updateMetalsCardDom({ cardEl, renderToken: 'token-old', items: ITEMS, text: TEXT_ZH, lang: 'zh' })

    expect(cardEl.grid.innerHTML).toBe('')
  })

  it('maps item keys to the current language at render time', () => {
    const cardEl = createCardEl()

    updateMetalsCardDom({ cardEl, renderToken: 'token-1', items: ITEMS, text: TEXT_ZH, lang: 'zh' })
    expect(cardEl.grid.innerHTML).toContain('国际金价')
    expect(cardEl.grid.innerHTML).toContain('国际银价')

    // 同一批缓存数据换语言重渲染：标题必须跟着变，说明缓存没有被语言污染。
    updateMetalsCardDom({ cardEl, renderToken: 'token-1', items: ITEMS, text: TEXT_EN, lang: 'en' })
    expect(cardEl.grid.innerHTML).toContain('Gold')
    expect(cardEl.grid.innerHTML).toContain('Silver')
    expect(cardEl.grid.innerHTML).not.toContain('国际金价')
  })

  it('renders prices, changes and the update time', () => {
    const cardEl = createCardEl()

    updateMetalsCardDom({ cardEl, renderToken: 'token-1', items: ITEMS, text: TEXT_ZH, lang: 'zh' })

    expect(cardEl.grid.innerHTML).toContain('2400.50')
    expect(cardEl.grid.innerHTML).toContain('560.25')
    expect(cardEl.grid.innerHTML).toContain('metals-price-change')
    expect(cardEl.updatedAt.textContent).toBe(
      new Date('2026-09-10 20:00').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    )
  })

  it('renders error and empty states and clears the update time', () => {
    const cardEl = createCardEl()

    updateMetalsCardDom({ cardEl, renderToken: 'token-1', items: [], errorText: TEXT_ZH.error, text: TEXT_ZH, lang: 'zh' })
    expect(cardEl.grid.innerHTML).toContain(TEXT_ZH.error)
    expect(cardEl.updatedAt.textContent).toBe('')

    updateMetalsCardDom({ cardEl, renderToken: 'token-1', items: [], text: TEXT_ZH, lang: 'zh' })
    expect(cardEl.grid.innerHTML).toContain(TEXT_ZH.error)
  })
})

describe('metals formatting', () => {
  it.each([
    [12.345, 2, '12.35'],
    [12.345, 1, '12.3'],
    [null, 2, '--'],
    [undefined, 2, '--']
  ])('formats %s with %s digits as %s', (value, digits, expected) => {
    expect(formatPlainPrice(value, digits)).toBe(expected)
  })

  it('formats seconds, dates and plain text time values', () => {
    expect(formatUpdateTime(1789000000, 'zh')).toBe(
      new Date(1789000000 * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    )
    expect(formatUpdateTime(new Date(1789000000 * 1000), 'en')).toMatch(/\d/)
    // 可解析的时间文本转成时刻，无法解析的原样展示。
    expect(formatUpdateTime('2026-09-10 20:00', 'zh')).toBe(
      new Date('2026-09-10 20:00').toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    )
    expect(formatUpdateTime('刚刚', 'zh')).toBe('刚刚')
    expect(formatUpdateTime('', 'zh')).toBe('')
    expect(formatUpdateTime(null, 'zh')).toBe('')
  })
})
