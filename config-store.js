/**
 * @fileoverview
 * 本地配置存储与默认值合并工具。
 *
 * 设计目标：
 * - newtab/options 在 background/service worker 暂不可用时，也能直接读写配置，避免页面崩溃。
 * - 统一 storage 的 Promise 封装，并正确读取 chrome.runtime.lastError，避免 Unchecked runtime.lastError 噪音。
 *
 * 注意：
 * - 配置存储于 chrome.storage.local，最近同步时间也存储于 chrome.storage.local。
 * - 兼容旧版本：若 local 中没有配置，会尝试从 chrome.storage.sync 读取一次旧配置并迁移到 local。
 * - 返回的配置始终会与 DEFAULT_CONFIG 深合并，保证 engines 等关键字段不为 undefined。
 */

export const STORAGE_KEY = 'chromeHomeConfig'
export const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'
export const LAST_REMOTE_HASH_KEY = 'chromeHomeLastRemoteHash'

export const THEME_IDS = ['cyber-dark', 'amber-neumorphic', 'neo-brutalism']
export const DEFAULT_THEME = 'cyber-dark'

export const normalizeThemeId = (value) => (THEME_IDS.includes(value) ? value : DEFAULT_THEME)

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
  // 兼容旧配置；搜索已不再依赖首次使用提示。
  popupTipDismissed: false,
  searchHistory: [],
  cards: [],
  ui: {
    language: 'zh',
    theme: DEFAULT_THEME
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
 * 规范化可由导入或远端同步写入的界面配置，避免未知主题污染运行时状态。
 */
export const normalizeConfig = (config) => {
  const merged = deepMerge(DEFAULT_CONFIG, config || {})
  merged.ui = {
    ...(merged.ui || {}),
    language: merged.ui?.language === 'en' ? 'en' : 'zh',
    theme: normalizeThemeId(merged.ui?.theme)
  }
  return merged
}

/**
 * storage.sync.get 的 Promise/回调兼容封装（仅用于旧配置迁移，带 lastError 处理）。
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
 * storage.sync.set 的 Promise/回调兼容封装（保留给测试/兼容场景，带 lastError 处理）。
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
  const localResult = await storageLocalGet(chromeApi, STORAGE_KEY)
  const localRaw = localResult?.[STORAGE_KEY]
  if (localRaw) return normalizeConfig(localRaw)

  // 重要逻辑：从旧版 chrome.storage.sync 平滑迁移到本机 local，避免升级后配置丢失。
  const syncResult = await storageSyncGet(chromeApi, STORAGE_KEY)
  const syncRaw = syncResult?.[STORAGE_KEY]
  if (!syncRaw) return safeStructuredClone(DEFAULT_CONFIG)

  const migrated = normalizeConfig(syncRaw)
  await writeConfig(chromeApi, migrated)
  return migrated
}

/**
 * 写入完整配置对象到 storage.local，避免 Chrome 账号同步与 Gitee 同步互相覆盖。
 */
export const writeConfig = async (chromeApi, nextConfig) => {
  const normalized = normalizeConfig(nextConfig)
  await storageLocalSet(chromeApi, { [STORAGE_KEY]: normalized })
  return normalized
}

/**
 * 在扩展页面与 service worker 之间串行化读改写，避免并发更新覆盖历史。
 * 网络请求应放在锁外，拿到结果后再基于最新本地配置更新。
 */
export const updateConfig = (chromeApi, patch) =>
  navigator.locks.request('chrome-home-config', async () => {
    const current = await readConfig(chromeApi)
    const next = typeof patch === 'function' ? patch(current) : deepMerge(current, patch || {})
    return writeConfig(chromeApi, next)
  })

export const addSearchHistory = (chromeApi, keyword) => {
  const term = typeof keyword === 'string' ? keyword.trim() : ''
  if (!term) throw new Error('请输入关键词')
  return updateConfig(chromeApi, (current) => ({
    ...current,
    searchHistory: [term, ...(current.searchHistory || []).filter((item) => item !== term)].slice(0, 20)
  }))
}

/**
 * 远端配置覆盖可同步设置；历史属于本机，包含主动清空的空数组。
 */
export const applyRemoteConfig = (chromeApi, remote) =>
  updateConfig(chromeApi, (current) => ({
    ...normalizeConfig(remote),
    searchHistory: current.searchHistory
  }))

/**
 * 写入最近一次成功拉取/推送确认后的远端配置 hash，用于防止旧本地配置覆盖新远端。
 */
export const writeLastRemoteHash = async (chromeApi, hash) => {
  const value = typeof hash === 'string' ? hash : ''
  await storageLocalSet(chromeApi, { [LAST_REMOTE_HASH_KEY]: value })
  return value
}

/**
 * 读取最近一次成功拉取/推送确认后的远端配置 hash。
 */
export const readLastRemoteHash = async (chromeApi) => {
  const result = await storageLocalGet(chromeApi, LAST_REMOTE_HASH_KEY)
  return result?.[LAST_REMOTE_HASH_KEY] || ''
}

/**
 * 写入最近同步时间到 storage.local。
 */
export const writeLastSyncAt = async (chromeApi, isoTime) => {
  const value = typeof isoTime === 'string' && isoTime ? isoTime : new Date().toISOString()
  await storageLocalSet(chromeApi, { [LAST_SYNC_AT_KEY]: value })
  return value
}
