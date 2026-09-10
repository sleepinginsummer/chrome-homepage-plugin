import { describe, expect, it, vi } from 'vitest'
import { createMetalsClient, normalizeMetalsItems } from '../metals.js'

const QUOTE_PAYLOAD = {
  items: [
    { key: 'gold', usdPrice: 2400.5, cnyPrice: 560.25, timeText: '2026-09-10 20:00' },
    { key: 'silver', usdPrice: '28.4', cnyPrice: 6.6, timeText: '' }
  ],
  exchangeRate: 7.1
}

const createSendStub = (response = { ok: true, data: QUOTE_PAYLOAD }) => vi.fn(async () => response)

describe('metals normalization', () => {
  it('keeps stable keys and numbers instead of localized titles', () => {
    const items = normalizeMetalsItems(QUOTE_PAYLOAD)

    // 数据层不带文案：语言切换后缓存仍可复用，标题在渲染时映射。
    expect(items.map((item) => item.key)).toEqual(['gold', 'silver'])
    expect(items[0]).toEqual({
      key: 'gold',
      usdPrice: 2400.5,
      cnyPrice: 560.25,
      timeText: '2026-09-10 20:00',
      changeUsd: null,
      changeCny: null
    })
    expect(items[1].usdPrice).toBe(28.4)
    expect(items.some((item) => 'title' in item)).toBe(false)
  })

  it('falls back to gold for unknown keys and nulls for bad numbers', () => {
    const items = normalizeMetalsItems({ items: [{ key: 'platinum', usdPrice: 'nope', cnyPrice: undefined, timeText: null }] })

    expect(items[0]).toMatchObject({ key: 'gold', usdPrice: null, cnyPrice: null, timeText: '' })
  })

  it('returns an empty list for a malformed payload', () => {
    expect(normalizeMetalsItems(null)).toEqual([])
    expect(normalizeMetalsItems({ items: 'nope' })).toEqual([])
  })
})

describe('metals client', () => {
  it('fetches once and serves the cached items afterwards', async () => {
    const send = createSendStub()
    const client = createMetalsClient({ send, now: () => 1000 })

    const first = await client.load('card-1')
    const second = await client.load('card-1')

    expect(first.map((item) => item.key)).toEqual(['gold', 'silver'])
    expect(second).toBe(first)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'fetchMetalsQuote' })
  })

  it('refetches when forced or after the cache expires', async () => {
    const send = createSendStub()
    let now = 1000
    const client = createMetalsClient({ send, now: () => now, cacheTtlMs: 100 })

    await client.load('card-1')
    await client.load('card-1', { forceRefresh: true })
    expect(send).toHaveBeenCalledTimes(2)

    now = 1200
    await client.load('card-1')
    expect(send).toHaveBeenCalledTimes(3)

    client.invalidate('card-1')
    await client.load('card-1')
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('rejects when the background reports an error', async () => {
    const client = createMetalsClient({ send: createSendStub({ ok: false, error: '后台不可用' }) })

    await expect(client.load('card-1')).rejects.toThrow('后台不可用')
  })

  it('rejects when the payload has no items', async () => {
    const client = createMetalsClient({ send: createSendStub({ ok: true, data: { items: [] } }) })

    await expect(client.load('card-1')).rejects.toThrow('metals data missing')
  })
})
