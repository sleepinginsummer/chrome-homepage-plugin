/**
 * @fileoverview
 * 本地配置存储与默认值合并工具。
 *
 * 设计目标：
 * - newtab/options 在 background/service worker 暂不可用时，也能直接读写配置，避免页面崩溃。
 * - 统一 storage 的 Promise 封装，并正确读取 chrome.runtime.lastError，避免 Unchecked runtime.lastError 噪音。
 *
 * 注意：
 * - 所有数据均存储于 chrome.storage.sync（配置）与 chrome.storage.local（最近同步时间）。
 * - 返回的配置始终会与 DEFAULT_CONFIG 深合并，保证 engines 等关键字段不为 undefined。
 */

export const STORAGE_KEY = 'chromeHomeConfig'
export const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

export const DEFAULT_ENGINES = [
  { name: 'GOOGLE', baseUrl: 'https://www.google.com/search?q=' },
  { name: 'BING', baseUrl: 'https://www.bing.com/search?q=' },
  { name: 'DuckDuckGo', baseUrl: 'https://duckduckgo.com/?q=' },
  { name: 'GitHub Search', baseUrl: 'https://github.com/search?q=' },
  { name: 'BAIDU', baseUrl: 'https://www.baidu.com/s?wd=' }
]

export const DEFAULT_CONFIG = {
  engines: DEFAULT_ENGINES,
  selectedEngines: ['GOOGLE', 'BING', 'BAIDU'],
  rememberSelections: true,
  popupTipDismissed: false,
  searchHistory: [],
  cards: [],
  ui: {
    language: 'zh'
  },
  sync: {
    gitUrl: '',
    token: '',
    autoPush: false
  }
}

/**
 * 在缺少 structuredClone 时安全复制对象，避免默认配置被意外引用修改。
 */
export const safeStructuredClone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

/**
 * 深合并：对象递归合并；数组整体替换；其它类型直接覆盖。
 */
export const deepMerge = (base, patch) => {
  if (!patch || typeof patch !== 'object') return safeStructuredClone(base)
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * storage.sync.get 的 Promise/回调兼容封装（带 lastError 处理）。
 */
export const storageSyncGet = (chromeApi, keys) =>
  new Promise((resolve, reject) => {
    try {
      chromeApi.storage.sync.get(keys, (result) => {
        const err = chromeApi.runtime?.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        resolve(result || {})
      })
    } catch (error) {
      reject(error)
    }
  })

/**
 * storage.sync.set 的 Promise/回调兼容封装（带 lastError 处理）。
 */
export const storageSyncSet = (chromeApi, data) =>
  new Promise((resolve, reject) => {
    try {
      chromeApi.storage.sync.set(data, () => {
        const err = chromeApi.runtime?.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        resolve()
      })
    } catch (error) {
      reject(error)
    }
  })

/**
 * storage.local.set 的 Promise/回调兼容封装（带 lastError 处理）。
 */
export const storageLocalSet = (chromeApi, data) =>
  new Promise((resolve, reject) => {
    try {
      chromeApi.storage.local.set(data, () => {
        const err = chromeApi.runtime?.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        resolve()
      })
    } catch (error) {
      reject(error)
    }
  })

/**
 * storage.local.get 的 Promise/回调兼容封装（带 lastError 处理）。
 */
export const storageLocalGet = (chromeApi, keys) =>
  new Promise((resolve, reject) => {
    try {
      chromeApi.storage.local.get(keys, (result) => {
        const err = chromeApi.runtime?.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        resolve(result || {})
      })
    } catch (error) {
      reject(error)
    }
  })

/**
 * 读取配置并与默认值合并，确保 engines 等字段存在。
 */
export const readConfig = async (chromeApi) => {
  const result = await storageSyncGet(chromeApi, STORAGE_KEY)
  const raw = result?.[STORAGE_KEY]
  return raw ? deepMerge(DEFAULT_CONFIG, raw) : safeStructuredClone(DEFAULT_CONFIG)
}

/**
 * 写入完整配置对象到 storage.sync。
 */
export const writeConfig = async (chromeApi, nextConfig) => {
  await storageSyncSet(chromeApi, { [STORAGE_KEY]: nextConfig })
}

/**
 * 写入最近同步时间到 storage.local。
 */
export const writeLastSyncAt = async (chromeApi, isoTime) => {
  const value = typeof isoTime === 'string' && isoTime ? isoTime : new Date().toISOString()
  await storageLocalSet(chromeApi, { [LAST_SYNC_AT_KEY]: value })
  return value
}

