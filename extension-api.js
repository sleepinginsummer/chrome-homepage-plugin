/**
 * @fileoverview
 * 扩展内部消息 API 客户端（带本地兜底）。
 *
 * ## 为什么需要它
 * MV3 的 background/service worker 可能在扩展更新、重载、系统回收等时机短暂离线。
 * 此时调用 `chrome.runtime.sendMessage` 会触发：
 * - 控制台：Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.
 * - 业务侧：拿到 undefined response，导致 newtab 继续渲染时读取 state.config.engines 崩溃。
 *
 * 本模块通过两点解决：
 * 1) 在 sendMessage 回调中读取并处理 `chrome.runtime.lastError`（避免 Unchecked 噪音）
 * 2) 当检测到“无接收端”时，自动切换到本地实现（storage/tabs/fetch），保证页面可用
 *
 * ## 消息协议（Message / Response）
 *
 * ### Request（发送到 background 的 message）
 * - `{ type: 'getConfig' }`
 * - `{ type: 'setConfig', data: Partial<Config> }`
 * - `{ type: 'openTabs', urls: string[] }`
 * - `{ type: 'openTabsInNewActive', urls: string[] }`
 * - `{ type: 'pullRemote' }`
 * - `{ type: 'pushRemote' }`
 * - `{ type: 'testRemote' }`
 * - `{ type: 'fetchMetalsQuote' }`
 *
 * ### Response（统一返回）
 * - 成功：`{ ok: true, data?: any, lastSyncAt?: string }`
 * - 失败：`{ ok: false, error: string, code?: string }`
 *
 * 约定：
 * - 所有 handler 不应抛出到调用方（除非调用方选择自行 throw），而是返回 ok=false。
 * - 本地兜底的行为应尽量与 background.js 的 onMessage 分支一致。
 */

import { DEFAULT_CONFIG, deepMerge, readConfig, writeConfig, writeLastSyncAt } from './config-store.js'
import { openTabs, openTabsInNewActive } from './tabs-ops.js'
import { computeConfigBeforePush, pullRemoteConfig, pushRemoteConfig, testRemoteConfig } from './remote-sync.js'

const GOLD_API_BASE_URL = 'https://api.gold-api.com/price'
const USD_CNY_API_URL = 'https://open.er-api.com/v6/latest/USD'
const OUNCE_TO_GRAM = 31.1034768

/**
 * 本地兜底拉取单个贵金属美元报价。
 *
 * @param {'XAU'|'XAG'} symbol 贵金属代码。
 * @returns {Promise<{price: number, updatedAt: string, symbol: string, name: string}>}
 */
const fetchMetalQuoteUsdLocally = async (symbol) => {
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
 * 本地兜底拉取美元兑人民币汇率。
 *
 * @returns {Promise<number>}
 */
const fetchUsdCnyRateLocally = async () => {
  const res = await fetch(USD_CNY_API_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`usd cny api HTTP ${res.status}`)
  const data = await res.json()
  const rate = Number(data?.rates?.CNY)
  if (!Number.isFinite(rate)) throw new Error('usd cny api invalid rate')
  return rate
}

/**
 * 本地兜底抓取黄金白银报价。
 *
 * @returns {Promise<{items: Array<any>, exchangeRate: number, updatedAt: string}>}
 */
const fetchMetalsQuoteLocally = async () => {
  const [gold, silver, usdCnyRate] = await Promise.all([
    fetchMetalQuoteUsdLocally('XAU'),
    fetchMetalQuoteUsdLocally('XAG'),
    fetchUsdCnyRateLocally()
  ])

  /**
   * 将美元/盎司换算为人民币/克。
   *
   * @param {number} usdPerOunce 美元/盎司价格。
   * @returns {number}
   */
  const toCnyPerGram = (usdPerOunce) => (usdPerOunce / OUNCE_TO_GRAM) * usdCnyRate

  return {
    items: [
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
    ],
    exchangeRate: usdCnyRate,
    updatedAt: gold.updatedAt || silver.updatedAt || ''
  }
}

/**
 * 判断错误是否属于“无接收端（background 不存在/未就绪）”。
 */
const isNoReceivingEndError = (message) => {
  const text = String(message || '')
  return /Receiving end does not exist|Could not establish connection/i.test(text)
}

/**
 * 带超时的 Promise 包装，避免 sendMessage 卡死导致 UI 启动挂起。
 */
const withTimeout = (promise, timeoutMs, onTimeoutValue) =>
  new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(onTimeoutValue)
    }, timeoutMs)

    promise
      .then((v) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(v)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, error: err?.message || String(err), code: 'SEND_EXCEPTION' })
      })
  })

/**
 * 本地兜底 handler：直接执行对应逻辑并返回与 background 一致的结构。
 */
export const handleMessageLocally = async (chromeApi, message) => {
  if (message?.type === 'getConfig') {
    return { ok: true, data: await readConfig(chromeApi) }
  }

  if (message?.type === 'setConfig') {
    const current = await readConfig(chromeApi)
    const next = deepMerge(current, message.data || {})
    await writeConfig(chromeApi, next)
    return { ok: true, data: next }
  }

  if (message?.type === 'openTabs') {
    await openTabs(chromeApi, message.urls || [], { preferCurrentTab: true })
    return { ok: true }
  }

  if (message?.type === 'openTabsInNewActive') {
    await openTabsInNewActive(chromeApi, message.urls || [])
    return { ok: true }
  }

  if (message?.type === 'pullRemote') {
    const config = await readConfig(chromeApi)
    const remote = await pullRemoteConfig(config.sync)
    const merged = deepMerge(DEFAULT_CONFIG, remote)
    await writeConfig(chromeApi, merged)
    const lastSyncAt = await writeLastSyncAt(chromeApi)
    return { ok: true, data: merged, lastSyncAt }
  }

  if (message?.type === 'pushRemote') {
    const config = await readConfig(chromeApi)
    const nextConfig = await computeConfigBeforePush({
      sync: config.sync,
      localConfig: config,
      deepMerge,
      defaultConfig: DEFAULT_CONFIG
    })
    await writeConfig(chromeApi, nextConfig)
    await pushRemoteConfig(nextConfig.sync, nextConfig)
    const lastSyncAt = await writeLastSyncAt(chromeApi)
    return { ok: true, lastSyncAt }
  }

  if (message?.type === 'testRemote') {
    const config = await readConfig(chromeApi)
    await testRemoteConfig(config.sync)
    return { ok: true }
  }

  if (message?.type === 'fetchMetalsQuote') {
    console.log('[chrome-home] fetchMetalsQuote:local:start')
    const data = await fetchMetalsQuoteLocally()
    console.log('[chrome-home] fetchMetalsQuote:local:success', data)
    return { ok: true, data }
  }

  return { ok: false, error: '未知消息类型' }
}

/**
 * 创建扩展内部 API 客户端。
 *
 * @param {object} options
 * @param {typeof chrome} options.chromeApi Chrome 扩展 API（通常传 chrome）
 * @param {number} [options.timeoutMs=1500] 单次 sendMessage 超时毫秒
 * @param {function} [options.onFallback] 发生“无接收端”并切换本地兜底时回调（用于轻提示）
 */
export const createExtensionApiClient = ({ chromeApi, timeoutMs = 1500, onFallback } = {}) => {
  let fallbackNotified = false

  /**
   * 封装 sendMessage，并在回调中消费 lastError（避免 Unchecked runtime.lastError）。
   */
  const trySendMessageOnce = (payload) =>
    new Promise((resolve) => {
      try {
        chromeApi.runtime.sendMessage(payload, (response) => {
          const err = chromeApi.runtime?.lastError
          if (err) {
            resolve({ ok: false, error: err.message, code: 'RUNTIME_LAST_ERROR' })
            return
          }
          resolve(response)
        })
      } catch (error) {
        resolve({ ok: false, error: error?.message || String(error), code: 'SEND_THROWN' })
      }
    })

  const notifyFallbackOnce = (reason) => {
    if (fallbackNotified) return
    fallbackNotified = true
    try {
      onFallback?.(reason)
    } catch {
      // 重要逻辑：提示失败不应影响业务继续运行
    }
  }

  /**
   * 发送消息：优先 background；“无接收端”时自动切换本地兜底。
   */
  const send = async (payload) => {
    // 重要逻辑：避免 background 不在线时一直 await，导致 newtab 启动卡住。
    const first = await withTimeout(trySendMessageOnce(payload), timeoutMs, {
      ok: false,
      error: 'sendMessage timeout',
      code: 'SEND_TIMEOUT'
    })

    if (first?.ok) return first

    const errorText = first?.error || ''
    const shouldFallbackForMetals = payload?.type === 'fetchMetalsQuote' && /未知消息类型/i.test(errorText)
    const shouldFallback =
      shouldFallbackForMetals ||
      first?.code === 'SEND_TIMEOUT' ||
      (first?.code === 'RUNTIME_LAST_ERROR' && isNoReceivingEndError(errorText))

    if (!shouldFallback) {
      // 非“无接收端”错误：直接返回，让 UI 展示具体原因
      return { ok: false, error: errorText || 'sendMessage failed', code: first?.code || 'SEND_FAILED' }
    }

    // 小幅重试一次，降低竞态窗口（service worker 正在唤醒时）。
    await new Promise((r) => setTimeout(r, 50))
    const second = await withTimeout(trySendMessageOnce(payload), timeoutMs, {
      ok: false,
      error: 'sendMessage timeout',
      code: 'SEND_TIMEOUT'
    })
    if (second?.ok) return second

    // 仍失败：切换本地兜底
    const reason = second?.error || errorText || 'background unavailable'
    notifyFallbackOnce(reason)
    console.warn('[chrome-home] fallback to local handler:', reason)

    try {
      const result = await handleMessageLocally(chromeApi, payload)
      if (payload?.type === 'fetchMetalsQuote') {
        console.log('[chrome-home] fetchMetalsQuote:fallback:result', result)
      }
      return result
    } catch (err) {
      if (payload?.type === 'fetchMetalsQuote') {
        console.error('[chrome-home] fetchMetalsQuote:fallback:failed', err?.message || String(err))
      }
      return { ok: false, error: err?.message || String(err), code: 'LOCAL_HANDLER_ERROR' }
    }
  }

  return { send }
}
