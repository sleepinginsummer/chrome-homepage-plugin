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

import { DEFAULT_SNAPSHOT_KEEP, DEFAULT_SYNC_SECTIONS, applyRemotePayload, buildRemotePayload, computeConfigHash } from './sync-remote-doc.js'

export const STORAGE_KEY = 'chromeHomeConfig'
export const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'
export const LAST_REMOTE_HASH_KEY = 'chromeHomeLastRemoteHash'
const SYNC_STATE_KEY = 'chromeHomeSyncState'
export const SYNC_DEVICE_KEY = 'chromeHomeSyncDevice'

export const THEME_IDS = ['cyber-dark', 'neo-brutalism']
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
    // provider 由 remote-sync 推断/校验；这里只给空骨架，避免默认值与真实规范化规则两处漂移。
    provider: '',
    gitUrl: '',
    webdavUrl: '',
    username: '',
    token: '',
    autoPush: false,
    sections: DEFAULT_SYNC_SECTIONS,
    snapshotKeep: DEFAULT_SNAPSHOT_KEEP
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
const withConfigLock = (run) => navigator.locks.request('chrome-home-config', run)
const payloadHash = (config) => computeConfigHash(buildRemotePayload(config, config.sync?.sections))

export const readSyncState = (chromeApi) => withConfigLock(async () => {
  const config = await readConfig(chromeApi)
  const stored = await storageLocalGet(chromeApi, [SYNC_STATE_KEY, LAST_REMOTE_HASH_KEY])
  return { config, revision: '', baseline: stored[LAST_REMOTE_HASH_KEY] || '', ...stored[SYNC_STATE_KEY] }
})

export const updateConfig = (chromeApi, patch) => withConfigLock(async () => {
  const current = await readConfig(chromeApi)
  const next = normalizeConfig(typeof patch === 'function' ? patch(current) : deepMerge(current, patch || {}))
  const values = { [STORAGE_KEY]: next }
  // 配置和待上传版本一起落盘，页面关闭也不会丢掉这笔改动。
  if (await payloadHash(current) !== await payloadHash(next)) {
    const stored = await storageLocalGet(chromeApi, [SYNC_STATE_KEY, LAST_REMOTE_HASH_KEY])
    values[SYNC_STATE_KEY] = {
      baseline: stored[LAST_REMOTE_HASH_KEY] || '',
      ...stored[SYNC_STATE_KEY],
      revision: createDeviceId()
    }
  }
  await storageLocalSet(chromeApi, values)
  return next
})

/** 在锁内提交同步结果。网络等待期间新增的改动必须保留，不能被拉取或清掉待上传标记。 */
export const commitSyncState = (chromeApi, started, { target, baseline, remote, keepPending = false }) =>
  withConfigLock(async () => {
    const current = await readConfig(chromeApi)
    const stored = await storageLocalGet(chromeApi, SYNC_STATE_KEY)
    const revision = stored[SYNC_STATE_KEY]?.revision || ''
    if (await computeConfigHash(current.sync) !== await computeConfigHash(started.config.sync)) {
      throw new Error('同步设置已变更，请重试')
    }
    const changed = revision !== started.revision
    if (remote && changed) throw new Error('同步期间本机配置已变更，已保留本机修改，请重试')
    const config = remote ? normalizeConfig(applyRemotePayload(current, remote, current.sync?.sections)) : current
    const lastSyncAt = new Date().toISOString()
    await storageLocalSet(chromeApi, {
      ...(remote ? { [STORAGE_KEY]: config } : {}),
      [SYNC_STATE_KEY]: { target, baseline, revision: keepPending || changed ? revision : '' },
      [LAST_SYNC_AT_KEY]: lastSyncAt
    })
    return { ok: true, data: config, lastSyncAt }
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
 * 生成设备标识，写进远端文档用来展示"这一版是哪台设备推的"。
 *
 * @param {object} chromeApi Chrome API。
 * @returns {Promise<{id: string, name: string}>} 设备信息。
 */
export const readSyncDevice = async (chromeApi) => {
  const result = await storageLocalGet(chromeApi, SYNC_DEVICE_KEY)
  const stored = result?.[SYNC_DEVICE_KEY]
  if (stored && typeof stored.id === 'string' && stored.id) {
    return { id: stored.id, name: typeof stored.name === 'string' ? stored.name : '' }
  }

  const device = { id: createDeviceId(), name: describePlatform() }
  await storageLocalSet(chromeApi, { [SYNC_DEVICE_KEY]: device })
  return device
}

/**
 * 优先用 crypto.randomUUID，老内核退化成随机串。
 *
 * @returns {string} 设备 id。
 */
const createDeviceId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const random = Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${random}`
}

/**
 * 从 userAgent 取一个人能看懂的平台名，避免在设置页显示一长串 UA。
 *
 * @returns {string} 平台名。
 */
const describePlatform = () => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Chrome'
}
