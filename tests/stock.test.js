import { describe, expect, it, vi } from 'vitest'
import {
  buildNextSymbols,
  createStockClient,
  formatTencentSymbol,
  getStockApiUrl,
  getStockSymbols,
  normalizeStockSymbolsInput,
  parseStockApiData,
  parseTencentTime
} from '../stock.js'

/** 构造一条腾讯行情响应；字段位置与真实接口一致。 */
const buildQuote = ({ prefix = 'sh', code = '600000', name = 'ACME', price = '10.50', prevClose = '10.00', time = '20260910150000' } = {}) => {
  const fields = new Array(31).fill('')
  fields[1] = name
  fields[2] = code
  fields[3] = price
  fields[4] = prevClose
  fields[30] = time
  return `v_${prefix}${code}="${fields.join('~')}";`
}

const createFetchStub = (text) => vi.fn(async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
}))

describe('stock symbols', () => {
  it('normalizes user input: trims, uppercases, dedupes and caps at 20', () => {
    expect(normalizeStockSymbolsInput(' sh600000, 600000 ，000001；aapl ')).toEqual(['SH600000', '600000', '000001', 'AAPL'])

    const many = Array.from({ length: 30 }, (_, index) => `SYM${index}`).join(',')
    expect(normalizeStockSymbolsInput(many)).toHaveLength(20)
  })

  it('inserts a new symbol, replaces the edited one and normalizes the result', () => {
    // 新增：插到最前
    expect(buildNextSymbols(['600000'], null, 'aapl')).toEqual(['AAPL', '600000'])
    // 新增已存在的代码：不重复插入
    expect(buildNextSymbols(['600000'], null, '600000')).toEqual(['600000'])
    // 替换：原地覆盖
    expect(buildNextSymbols(['600000', '300750'], '300750', 'AAPL')).toEqual(['600000', 'AAPL'])
    // 替换目标已经不在列表里：只做规范化，不新增
    expect(buildNextSymbols(['600000'], '300750', 'AAPL')).toEqual(['600000'])
    // 结果统一去重、大写
    expect(buildNextSymbols(['aapl'], null, '600000')).toEqual(['600000', 'AAPL'])
  })

  it('reads symbols from card config', () => {
    expect(getStockSymbols({ symbols: ['600000', '600000', 'AAPL'] })).toEqual(['600000', 'AAPL'])
    expect(getStockSymbols(null)).toEqual([])
  })

  it.each([
    ['600000', 'sh600000'],
    ['000001', 'sz000001'],
    ['300750', 'sz300750'],
    ['830799', 'bj830799'],
    ['AAPL', 'usAAPL'],
    ['sh600000', 'sh600000'],
    ['hk00700', 'hk00700'],
    ['', '']
  ])('maps %s to tencent code %s', (input, expected) => {
    expect(formatTencentSymbol(input)).toBe(expected)
  })

  it('builds the quote url and drops empty symbols', () => {
    expect(getStockApiUrl(['600000', 'AAPL', ''])).toBe('https://qt.gtimg.cn/q=sh600000,usAAPL')
  })
})

describe('stock parser', () => {
  it('parses a quote into the aligned item list', () => {
    const items = parseStockApiData(buildQuote(), ['600000'])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ symbol: '600000', name: 'ACME', price: 10.5, currency: 'CNY' })
    expect(items[0].change).toBeCloseTo(0.5, 5)
    expect(items[0].changePercent).toBeCloseTo(5, 5)
    expect(items[0].marketTime).toBe(parseTencentTime('20260910150000'))
  })

  it('marks US symbols as USD and keeps the requested order', () => {
    const raw = `${buildQuote({ prefix: 'us', code: 'AAPL', name: 'Apple', price: '200', prevClose: '190' })}${buildQuote()}`
    const items = parseStockApiData(raw, ['AAPL', '600000', '300750'])

    expect(items.map((item) => item.symbol)).toEqual(['AAPL', '600000', '300750'])
    expect(items[0].currency).toBe('USD')
    // 请求了但接口没返回的代码要保留占位，价格为空。
    expect(items[2]).toMatchObject({ symbol: '300750', price: null, change: null, currency: '' })
  })

  it('handles empty or malformed responses', () => {
    expect(parseStockApiData('', ['600000'])).toHaveLength(1)
    expect(parseStockApiData('garbage', ['600000'])[0].price).toBeNull()
  })

  it('parses both compact and human readable time text', () => {
    expect(typeof parseTencentTime('20260910150000')).toBe('number')
    expect(parseTencentTime('')).toBeNull()
    expect(parseTencentTime('not-a-time')).toBeNull()
  })
})

describe('stock client', () => {
  it('decodes the GBK response and caches by card id', async () => {
    const fetchFn = createFetchStub(buildQuote())
    const client = createStockClient({ fetchFn, now: () => 1000 })

    const first = await client.load('card-1', ['600000'])
    const second = await client.load('card-1', ['600000'])

    expect(first[0].name).toBe('ACME')
    expect(second).toBe(first)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(client.peek('card-1')).toBe(first)
  })

  it('refetches when forced and exposes the cache for the editor', async () => {
    const fetchFn = createFetchStub(buildQuote())
    const client = createStockClient({ fetchFn, now: () => 1000 })

    await client.load('card-1', ['600000'])
    await client.load('card-1', ['600000'], { forceRefresh: true })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    client.invalidate('card-1')
    expect(client.peek('card-1')).toEqual([])
  })

  it('refetches after the cache expires', async () => {
    const fetchFn = createFetchStub(buildQuote())
    let now = 1000
    const client = createStockClient({ fetchFn, now: () => now, cacheTtlMs: 100 })

    await client.load('card-1', ['600000'])
    now = 1200
    await client.load('card-1', ['600000'])

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('rejects when the interface returns a non-ok response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 502, arrayBuffer: async () => new ArrayBuffer(0) }))
    const client = createStockClient({ fetchFn })

    await expect(client.load('card-1', ['600000'])).rejects.toThrow('HTTP 502')
  })
})
