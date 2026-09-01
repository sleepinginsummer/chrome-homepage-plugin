import { createCachedRequestClient } from './request-cache.js'

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 9000
const DEFAULT_RETRY_DELAYS_MS = [800, 1600]

const getHotApiUrl = (sourceTitle) =>
  `https://bot.znzme.com/dailyhot?title=${encodeURIComponent(String(sourceTitle || '知乎'))}`

const parseHotApiData = (raw) => {
  const list = raw?.data
  if (!Array.isArray(list)) return []
  return list
    .map((item) => ({
      title: String(item?.title || '').trim(),
      link: String(item?.link || '').trim()
    }))
    .filter((item) => item.title && item.link)
}

/**
 * 创建热搜数据客户端，领域模块只负责请求地址与响应解析。
 */
export const createHotNewsClient = ({
  fetchFn = globalThis.fetch,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS
} = {}) => createCachedRequestClient({
  loadOnce: async (sourceTitle, signal) => {
    const response = await fetchFn(getHotApiUrl(sourceTitle), { signal, cache: 'no-store' })
    if (!response.ok) {
      const error = new Error(`hot news HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return parseHotApiData(await response.json())
  },
  normalizeKey: (sourceTitle) => String(sourceTitle || '知乎'),
  setTimeoutFn,
  clearTimeoutFn,
  now,
  cacheTtlMs,
  timeoutMs,
  retryDelaysMs
})

export { getHotApiUrl, parseHotApiData }
