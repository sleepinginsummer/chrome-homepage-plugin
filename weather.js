import { createCachedRequestClient } from './request-cache.js'

const WEATHER_API_BASE_URL = 'http://47.102.98.123:8778/weather'
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_RETRY_DELAYS_MS = [800, 1600]
const STORAGE_KEY_PREFIX = 'chromeHomeWeatherCache:'

export const getWeatherApiUrl = (city) =>
  `${WEATHER_API_BASE_URL}?city=${encodeURIComponent(String(city || '').trim())}`

const createResponseError = (message) => {
  const error = new Error(message)
  error.retryable = false
  return error
}

const parseCurrentLine = (line) => {
  const fields = String(line || '').split(',').map((item) => item.trim())
  const temperature = fields[0]?.match(/^气温:([^℃]+)℃$/)?.[1]?.trim() || ''
  const humidity = fields[1]?.replace(/^湿度/, '').trim() || ''
  const pm25 = fields[2]?.replace(/^pm2\.5:/i, '').trim() || ''
  const wind = fields[3] || ''
  const windSpeed = fields.slice(4).join(',').replace(/^风力/, '').trim()
  return { temperature, humidity, pm25, wind, windSpeed }
}

const parseForecastLine = (line) => {
  const match = String(line || '').match(/^\[(.+?)\]:(.*?),\s*气温(.*?),\s*风力(.*)$/)
  if (!match) return null
  return {
    date: match[1].trim(),
    condition: match[2].trim(),
    temperature: match[3].replace(/℃/g, '').trim(),
    wind: match[4].trim()
  }
}

/**
 * 将天气接口的多行文本转换为稳定的页面数据结构。
 */
export const parseWeatherApiData = (raw) => {
  const text = typeof raw === 'string' ? raw : raw?.data
  if (typeof text !== 'string' || !text.trim()) throw createResponseError('天气接口返回为空')

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== '!')
  const header = lines[0]?.match(/^(.+?)实时天气\(更新时间(.+?)\)$/)
  if (!header) throw createResponseError('天气接口返回格式错误')

  const forecasts = lines.slice(2).map(parseForecastLine).filter(Boolean).slice(0, 7)
  if (!forecasts.length) throw createResponseError('天气预报数据为空')

  const current = parseCurrentLine(lines[1])
  current.condition = forecasts[0]?.condition || ''
  return {
    city: header[1].trim(),
    updatedAt: header[2].trim(),
    current,
    forecasts
  }
}

const createPersistentStore = (storage) => {
  if (!storage) return undefined
  const getStorageKey = (city) => `${STORAGE_KEY_PREFIX}${city}`
  return {
    read: async (city) => {
      const key = getStorageKey(city)
      return (await storage.get(key))?.[key] || null
    },
    write: async (city, entry) => {
      const key = getStorageKey(city)
      await storage.set({ [key]: entry })
    },
    remove: async (city) => storage.remove(getStorageKey(city))
  }
}

/**
 * 创建天气客户端，使用 30 分钟浏览器持久缓存并复用共享请求生命周期。
 */
export const createWeatherClient = ({
  fetchFn = globalThis.fetch,
  storage,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS
} = {}) => createCachedRequestClient({
  loadOnce: async (city, signal) => {
    const response = await fetchFn(getWeatherApiUrl(city), { signal, cache: 'no-store' })
    if (!response.ok) {
      const error = new Error(`weather HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return parseWeatherApiData(await response.json())
  },
  normalizeKey: (city) => String(city || '').trim(),
  persistentStore: createPersistentStore(storage),
  setTimeoutFn,
  clearTimeoutFn,
  now,
  cacheTtlMs,
  timeoutMs,
  retryDelaysMs
})
