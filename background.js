import { DEFAULT_CONFIG, deepMerge, readConfig, writeConfig, writeLastSyncAt } from './config-store.js'
import { openTabs, openTabsInNewActive } from './tabs-ops.js'
import { computeConfigBeforePush, pullRemoteConfig, pushRemoteConfig, testRemoteConfig } from './remote-sync.js'

const GOLD_API_BASE_URL = 'https://api.gold-api.com/price'
const USD_CNY_API_URL = 'https://open.er-api.com/v6/latest/USD'
const OUNCE_TO_GRAM = 31.1034768

/**
 * 拉取单个贵金属美元报价。
 *
 * 接口文档：
 * - 方法：`GET`
 * - 地址：`${GOLD_API_BASE_URL}/{symbol}`
 * - 参数：`symbol` 取值 `XAU` 或 `XAG`
 * - 返回：`{ price, updatedAt, symbol, name }`
 *
 * @param {'XAU'|'XAG'} symbol 贵金属代码。
 * @returns {Promise<{price: number, updatedAt: string, symbol: string, name: string}>}
 */
const fetchMetalQuoteUsd = async (symbol) => {
  const res = await fetch(`${GOLD_API_BASE_URL}/${symbol}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`gold api HTTP ${res.status}`)
  const data = await res.json()
  const price = Number(data?.price)
  if (!Number.isFinite(price)) throw new Error(`gold api invalid price for ${symbol}`)
  return {
    price,
    updatedAt: String(data?.updatedAt || ''),
    symbol: String(data?.symbol || symbol),
    name: String(data?.name || symbol)
  }
}

/**
 * 拉取美元兑人民币汇率。
 *
 * 接口文档：
 * - 方法：`GET`
 * - 地址：`https://open.er-api.com/v6/latest/USD`
 * - 返回：`{ rates: { CNY } }`
 *
 * @returns {Promise<number>}
 */
const fetchUsdCnyRate = async () => {
  const res = await fetch(USD_CNY_API_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`usd cny api HTTP ${res.status}`)
  const data = await res.json()
  const rate = Number(data?.rates?.CNY)
  if (!Number.isFinite(rate)) throw new Error('usd cny api invalid rate')
  return rate
}

/**
 * 拉取黄金白银报价并聚合出美元/人民币价格。
 *
 * 接口文档：
 * - 方法：`GET`
 * - 数据源一：`https://api.gold-api.com/price/XAU`
 * - 数据源二：`https://api.gold-api.com/price/XAG`
 * - 数据源三：`https://open.er-api.com/v6/latest/USD`
 * - 换算规则：美元/盎司 ÷ `31.1034768` = 美元/克，再乘以 USD/CNY 汇率得到人民币/克
 * - 返回结构：
 *   `{ items: [{ key, usdPrice, cnyPrice, timeText, sourceUrl, exchangeRate }], exchangeRate, updatedAt }`
 *
 * @returns {Promise<{items: Array<any>, exchangeRate: number, updatedAt: string}>}
 */
const fetchMetalsQuote = async () => {
  const [gold, silver, usdCnyRate] = await Promise.all([
    fetchMetalQuoteUsd('XAU'),
    fetchMetalQuoteUsd('XAG'),
    fetchUsdCnyRate()
  ])

  /**
   * 将美元/盎司换算为人民币/克。
   *
   * @param {number} usdPerOunce 美元/盎司。
   * @returns {number}
   */
  const toCnyPerGram = (usdPerOunce) => (usdPerOunce / OUNCE_TO_GRAM) * usdCnyRate

  // 重要逻辑：统一在后台完成换算，避免前台重复依赖多个外部源。
  const items = [
    {
      key: 'gold',
      usdPrice: gold.price,
      cnyPrice: toCnyPerGram(gold.price),
      timeText: gold.updatedAt,
      sourceUrl: `${GOLD_API_BASE_URL}/XAU`,
      exchangeRate: usdCnyRate
    },
    {
      key: 'silver',
      usdPrice: silver.price,
      cnyPrice: toCnyPerGram(silver.price),
      timeText: silver.updatedAt,
      sourceUrl: `${GOLD_API_BASE_URL}/XAG`,
      exchangeRate: usdCnyRate
    }
  ]

  console.log('[chrome-home] metals quote fetched', {
    exchangeRate: usdCnyRate,
    updatedAt: gold.updatedAt || silver.updatedAt || '',
    items
  })

  return {
    items,
    exchangeRate: usdCnyRate,
    updatedAt: gold.updatedAt || silver.updatedAt || ''
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[chrome-home] onInstalled:start')
  const config = await readConfig(chrome)
  await writeConfig(chrome, config)
  console.log('[chrome-home] onInstalled:done')
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[chrome-home] onMessage', message?.type)
  ;(async () => {
    if (message?.type === 'getConfig') {
      sendResponse({ ok: true, data: await readConfig(chrome) })
      return
    }
    if (message?.type === 'setConfig') {
      const current = await readConfig(chrome)
      const next = deepMerge(current, message.data || {})
      await writeConfig(chrome, next)
      sendResponse({ ok: true, data: next })
      return
    }
    if (message?.type === 'openTabs') {
      // 重要逻辑：background 分支优先复用 sender tab（如果能拿到）。
      const senderTabId = _sender?.tab?.id
      if (typeof senderTabId === 'number') {
        // 保持在当前标签页打开首个结果
        const list = Array.isArray(message.urls) ? message.urls.filter(Boolean) : []
        if (list.length) {
          const [first, ...rest] = list
          await chrome.tabs.update(senderTabId, { url: first, active: true })
          for (const url of rest) await chrome.tabs.create({ url, active: false })
        }
      } else {
        await openTabs(chrome, message.urls || [], { preferCurrentTab: true })
      }
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'openTabsInNewActive') {
      await openTabsInNewActive(chrome, message.urls || [])
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'pullRemote') {
      const config = await readConfig(chrome)
      const remote = await pullRemoteConfig(config.sync)
      const merged = deepMerge(DEFAULT_CONFIG, remote)
      await writeConfig(chrome, merged)
      const lastSyncAt = await writeLastSyncAt(chrome)
      sendResponse({ ok: true, data: merged, lastSyncAt })
      return
    }
    if (message?.type === 'pushRemote') {
      const config = await readConfig(chrome)
      const nextConfig = await computeConfigBeforePush({
        sync: config.sync,
        localConfig: config,
        deepMerge,
        defaultConfig: DEFAULT_CONFIG
      })
      await writeConfig(chrome, nextConfig)
      await pushRemoteConfig(nextConfig.sync, nextConfig)
      const lastSyncAt = await writeLastSyncAt(chrome)
      sendResponse({ ok: true, lastSyncAt })
      return
    }
    if (message?.type === 'testRemote') {
      const config = await readConfig(chrome)
      await testRemoteConfig(config.sync)
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'fetchMetalsQuote') {
      console.log('[chrome-home] fetchMetalsQuote:start')
      const data = await fetchMetalsQuote()
      sendResponse({ ok: true, data })
      return
    }
    sendResponse({ ok: false, error: '未知消息类型' })
  })().catch((err) => {
    console.error('[chrome-home] onMessage:error', err)
    if (message?.type === 'fetchMetalsQuote') {
      console.error('[chrome-home] fetchMetalsQuote:failed', err?.message || String(err))
    }
    sendResponse({ ok: false, error: err?.message || String(err) })
  })
  return true
})
