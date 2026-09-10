/**
 * @fileoverview
 * 黄金白银数据层：向扩展后台取报价并标准化为卡片可直接展示的结构。
 *
 * 数据来源（抓取与汇率换算都在 background/service worker 中完成，规避前台跨域限制）：
 * - 金价：`https://api.gold-api.com/price/XAU`
 * - 银价：`https://api.gold-api.com/price/XAG`
 * - 汇率：`https://open.er-api.com/v6/latest/USD`
 * - 换算规则：美元/盎司 -> 人民币/克
 *
 * 注意：这里不碰 DOM，也不读页面 i18n；标题映射需要的文案由调用方传入。
 */

const DEFAULT_CACHE_TTL_MS = 60 * 1000

/**
 * 把后台返回的原始报价标准化。
 *
 * 注意：只保留稳定的 key（gold/silver）与数值，不带本地化文案，
 * 否则缓存会被语言污染、切语言后仍显示旧标题。
 *
 * @param {any} data 后台 `fetchMetalsQuote` 的 payload。
 * @returns {Array<object>} 标准化后的条目。
 */
export const normalizeMetalsItems = (data) => {
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map((item) => ({
    key: item?.key === 'silver' ? 'silver' : 'gold',
    usdPrice: Number.isFinite(Number(item?.usdPrice)) ? Number(item.usdPrice) : null,
    cnyPrice: Number.isFinite(Number(item?.cnyPrice)) ? Number(item.cnyPrice) : null,
    timeText: String(item?.timeText || ''),
    changeUsd: null,
    changeCny: null
  }))
}

/**
 * 创建黄金白银客户端：按卡片 id 缓存短时结果，降低轮询带来的后台请求压力。
 *
 * @param {object} options
 * @param {function(object): Promise<object>} options.send 扩展内部消息发送。
 * @param {function(): number} [options.now] 当前时间戳。
 * @param {number} [options.cacheTtlMs] 缓存有效期。
 */
export const createMetalsClient = ({
  send,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS
} = {}) => {
  const cache = new Map()

  /**
   * 读取报价；命中未过期缓存时直接返回（缓存与语言无关）。
   *
   * @param {string} cardId 卡片 id。
   * @param {{forceRefresh?: boolean}} [options] 是否强制刷新。
   */
  const load = async (cardId, { forceRefresh = false } = {}) => {
    const cached = cache.get(cardId)
    if (!forceRefresh && cached && now() - cached.ts < cacheTtlMs && Array.isArray(cached.items)) {
      return cached.items
    }

    const res = await send({ type: 'fetchMetalsQuote' })
    if (!res?.ok) throw new Error(res?.error || '黄金白银抓取失败')
    const items = normalizeMetalsItems(res.data)
    if (!items.length) throw new Error('metals data missing')

    cache.set(cardId, { ts: now(), items })
    return items
  }

  const invalidate = (cardId) => {
    cache.delete(cardId)
  }

  return { load, invalidate }
}
