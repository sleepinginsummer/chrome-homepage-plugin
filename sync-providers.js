/**
 * @fileoverview
 * 云同步 provider 层：把"存到哪儿"从同步逻辑里拆出来。
 *
 * 契约（每个 provider 实现五个方法，读写都以文本为单位）：
 * - `fields`            必需配置字段，用于表单校验与自动同步前置判断。
 * - `supportsSnapshots` 该源能否承载内嵌快照环（容量受限的源必须为 false）。
 * - `test(sync, ctx)`   连通性检查，失败抛错。
 * - `read(sync, ctx)`   读远端文本，不存在返回 null。
 * - `write(sync, ctx, text)` 整份覆盖写入。
 *
 * ctx 里带 `chromeApi`（chrome.storage.sync 需要），其余源忽略。
 *
 * 注意：
 * - provider 只处理"文本怎么存"，不知道配置结构、分区和快照规则，那些在
 *   sync-remote-doc.js 与 remote-sync.js。
 * - 所有网络错误都归一化成中文可读消息，页面直接把 message 显示给用户。
 */

export const DEFAULT_SYNC_FILENAME = 'config.json'
export const DEFAULT_WEBDAV_FILENAME = 'config.json'

const DEFAULT_TIMEOUT_MS = 15000

/**
 * 带超时的 fetch：MV3 的 service worker 里 fetch 没有默认超时，卡住会一直转圈。
 *
 * @param {string} url 请求地址。
 * @param {object} [init] fetch 初始化参数。
 * @param {number} [timeoutMs] 超时毫秒。
 * @returns {Promise<Response>} 响应。
 */
const fetchWithTimeout = async (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时，请检查网络或代理后重试')
    throw new Error(`网络请求失败：${error?.message || String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取远端文件名：允许配置 `path`，但只取 basename，避免上游写入目录穿越路径。
 *
 * @param {object} sync 同步配置。
 * @param {string} fallback 默认文件名。
 * @returns {string} 文件名。
 */
export const resolveFilename = (sync, fallback = DEFAULT_SYNC_FILENAME) => {
  const raw = typeof sync?.path === 'string' ? sync.path.trim() : ''
  if (!raw) return fallback
  const base = raw.split('/').filter(Boolean).pop() || fallback
  return base === '.' || base === '..' ? fallback : base
}

/**
 * UTF-8 安全的 base64，WebDAV 的 Basic 认证用它（用户名可能是中文）。
 *
 * @param {string} text 原文本。
 * @returns {string} base64 串。
 */
const toBase64Utf8 = (text) => {
  const bytes = new TextEncoder().encode(String(text))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Gitee 代码片段：走 v5 API，token 放在 query 上（Gitee 只支持这种传法）。
 */
const giteeGistProvider = {
  id: 'gitee_gist',
  fields: ['gitUrl', 'token'],
  supportsSnapshots: true,

  apiUrl: (sync) =>
    `https://gitee.com/api/v5/gists/${encodeURIComponent(sync.gistId)}?access_token=${encodeURIComponent(sync.token)}`,

  async read(sync) {
    const res = await fetchWithTimeout(this.apiUrl(sync))
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) throw new Error('Gitee 拒绝访问：请检查 token 是否有效且有该代码片段权限')
    if (!res.ok) throw new Error(`Gitee 代码片段读取失败：HTTP ${res.status}`)
    const data = await res.json()
    const file = data?.files?.[resolveFilename(sync)]
    return typeof file?.content === 'string' ? file.content : null
  },

  async write(sync, _ctx, text) {
    const res = await fetchWithTimeout(this.apiUrl(sync), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `chore: update chrome-home-plugin config (${new Date().toISOString()})`,
        files: { [resolveFilename(sync)]: { content: text } }
      })
    })
    if (res.status === 404) throw new Error('Gitee 代码片段不存在：请检查代码片段地址')
    if (res.status === 401 || res.status === 403) throw new Error('Gitee 拒绝写入：请检查 token 权限')
    if (!res.ok) throw new Error(`Gitee 代码片段写入失败：HTTP ${res.status}`)
  },

  async test(sync) {
    const text = await this.read(sync)
    // 读不到文件也算连通：首次推送就是这种状态。
    void text
  }
}

/**
 * GitHub 代码片段：走 REST API，Bearer 鉴权；文件超过 1MB 时 content 会被截断，需回源 raw_url。
 */
const githubGistProvider = {
  id: 'github_gist',
  fields: ['gitUrl', 'token'],
  supportsSnapshots: true,

  apiUrl: (sync) => `https://api.github.com/gists/${encodeURIComponent(sync.gistId)}`,

  headers: (sync) => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${sync.token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }),

  async read(sync) {
    const res = await fetchWithTimeout(this.apiUrl(sync), { headers: this.headers(sync) })
    if (res.status === 404) return null
    if (res.status === 401) throw new Error('GitHub 拒绝访问：token 无效或已过期')
    if (res.status === 403) throw new Error('GitHub 拒绝访问：token 缺少 gist 权限，或已触发速率限制')
    if (!res.ok) throw new Error(`GitHub 代码片段读取失败：HTTP ${res.status}`)

    const data = await res.json()
    const file = data?.files?.[resolveFilename(sync)]
    if (!file) return null
    if (typeof file.content === 'string' && !file.truncated) return file.content

    // 重要逻辑：大文件被 API 截断时必须回源 raw_url，否则拿到的是半截 JSON。
    if (typeof file.raw_url === 'string' && file.raw_url) {
      const raw = await fetchWithTimeout(file.raw_url, { headers: this.headers(sync) })
      if (!raw.ok) throw new Error(`GitHub 代码片段原文下载失败：HTTP ${raw.status}`)
      return raw.text()
    }
    return typeof file.content === 'string' ? file.content : null
  },

  async write(sync, _ctx, text) {
    const res = await fetchWithTimeout(this.apiUrl(sync), {
      method: 'PATCH',
      headers: { ...this.headers(sync), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: `chore: update chrome-home-plugin config (${new Date().toISOString()})`,
        files: { [resolveFilename(sync)]: { content: text } }
      })
    })
    if (res.status === 404) throw new Error('GitHub 代码片段不存在：请检查代码片段地址')
    if (res.status === 401 || res.status === 403) throw new Error('GitHub 拒绝写入：请检查 token 的 gist 权限')
    if (!res.ok) throw new Error(`GitHub 代码片段写入失败：HTTP ${res.status}`)
  },

  async test(sync) {
    await this.read(sync)
  }
}

/**
 * WebDAV：坚果云 / Nextcloud / Alist / 群晖通用。
 *
 * 约定：`webdavUrl` 是一级目录地址，文件按 `path` 的名字存进该目录，
 * 目录本身需要用户先建好（WebDAV 的 PUT 不会自动建集合，会返回 409）。
 */
const webdavProvider = {
  id: 'webdav',
  fields: ['webdavUrl', 'username', 'token'],
  supportsSnapshots: true,

  /**
   * 拼出目标文件 URL。
   *
   * @param {object} sync 同步配置。
   * @returns {string} 文件地址。
   */
  fileUrl(sync) {
    const base = typeof sync?.webdavUrl === 'string' ? sync.webdavUrl.trim().replace(/\/+$/, '') : ''
    if (!base) throw new Error('WebDAV 配置缺少：webdavUrl')
    return `${base}/${encodeURIComponent(resolveFilename(sync, DEFAULT_WEBDAV_FILENAME))}`
  },

  headers: (sync) => ({
    Authorization: `Basic ${toBase64Utf8(`${sync.username || ''}:${sync.token || ''}`)}`
  }),

  async read(sync, ctx = {}) {
    const res = await fetchWithTimeout(this.fileUrl(sync), { method: 'GET', headers: this.headers(sync), cache: 'no-store' })
    if (res.status === 404) {
      ctx.webdavCondition = { 'If-None-Match': '*' }
      return null
    }
    const etag = res.headers?.get('ETag')
    // 强 ETag 才能用于 If-Match；无此能力的服务器仍兼容普通 WebDAV 写入。
    if (etag && !etag.startsWith('W/')) ctx.webdavCondition = { 'If-Match': etag }
    if (res.status === 401 || res.status === 403) throw new Error('WebDAV 拒绝访问：请检查用户名与密码（应用密码）')
    if (!res.ok) throw new Error(`WebDAV 读取失败：HTTP ${res.status}`)
    return res.text()
  },

  async write(sync, ctx = {}, text) {
    const res = await fetchWithTimeout(this.fileUrl(sync), {
      method: 'PUT',
      headers: { ...this.headers(sync), ...ctx.webdavCondition, 'Content-Type': 'application/json;charset=utf-8' },
      body: text
    })
    if (res.status === 401 || res.status === 403) throw new Error('WebDAV 拒绝写入：请检查用户名与密码（应用密码）')
    if (res.status === 412) throw new Error('远端文件刚被更新，已取消覆盖。请重新同步。')
    if (res.status === 404 || res.status === 409) throw new Error('WebDAV 目录不存在：请先在网盘中创建该目录')
    if (!res.ok) throw new Error(`WebDAV 写入失败：HTTP ${res.status}`)
  },

  async test(sync) {
    const res = await fetchWithTimeout(this.fileUrl(sync), { method: 'GET', headers: this.headers(sync) })
    if (res.status === 404) return
    if (res.status === 401 || res.status === 403) throw new Error('WebDAV 拒绝访问：请检查用户名与密码（应用密码）')
    if (!res.ok) throw new Error(`WebDAV 连接失败：HTTP ${res.status}`)
  }
}

const STORAGE_SYNC_KEY = 'chromeHomeSyncDoc'
const STORAGE_SYNC_ITEM_BYTES = 8192
const STORAGE_SYNC_TOTAL_BYTES = 102400
const STORAGE_SYNC_MAX_ITEMS = 512
const storageByteLength = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length
const capacityError = () => new Error('配置超过 Chrome 同步存储容量，未写入。请减少同步内容或改用其他同步源。')

const getSyncStorage = (ctx) => {
  const api = ctx?.chromeApi
  if (!api?.storage?.sync) throw new Error('当前环境不支持 chrome.storage.sync')
  return api.storage.sync
}

/**
 * 简单 Promise 化，避免依赖 MV3 里 storage 的双形态（Promise / 回调）。
 *
 * 注意：lastError 必须用调用方传进来的 chromeApi 读，测试与本地兜底会传桩对象。
 *
 * @param {object} ctx provider 上下文。
 * @param {function} fn 调用形式为 fn(callback) 的函数。
 * @returns {Promise<any>} 结果。
 */
const callStorage = (ctx, fn) =>
  new Promise((resolve, reject) => {
    const api = ctx?.chromeApi
    fn((result) => {
      const err = api?.runtime?.lastError || globalThis.chrome?.runtime?.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(result)
    })
  })

/**
 * chrome.storage.sync：零配置跨设备，代价是单条 8KB、总量 100KB，且没有版本历史。
 */
const storageSyncProvider = {
  id: 'storage_sync',
  fields: [],
  supportsSnapshots: false,

  async read(sync, ctx) {
    const storage = getSyncStorage(ctx)
    // 一次读取元数据及分片，避免在两次 get 之间拼接不同版本。
    const chunked = await callStorage(ctx, (cb) => storage.get(null, cb))
    const count = chunked?.[STORAGE_SYNC_KEY]?.count
    if (count === undefined) return null
    if (!Number.isInteger(count) || count < 0 || count >= STORAGE_SYNC_MAX_ITEMS) throw new Error('Chrome 同步存储分片无效')
    if (count === 0) return null
    let text = ''
    for (let index = 0; index < count; index++) {
      const part = chunked[`${STORAGE_SYNC_KEY}:${index}`]
      if (typeof part !== 'string') throw new Error('Chrome 同步存储数据不完整，请稍后重试')
      text += part
    }
    return text
  },

  async write(sync, ctx, text) {
    const storage = getSyncStorage(ctx)
    const payload = {}
    let count = 0
    // 配额按键名及 JSON 序列化后的 UTF-8 字节数计算，包含转义开销。
    for (let start = 0; start < text.length;) {
      if (count >= STORAGE_SYNC_MAX_ITEMS - 1) throw capacityError()
      const key = `${STORAGE_SYNC_KEY}:${count++}`
      let low = start + 1
      let high = Math.min(text.length, start + STORAGE_SYNC_ITEM_BYTES)
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (storageByteLength(key, text.slice(start, mid)) <= STORAGE_SYNC_ITEM_BYTES) low = mid
        else high = mid - 1
      }
      payload[key] = text.slice(start, low)
      start = low
    }
    payload[STORAGE_SYNC_KEY] = { count, updatedAt: new Date().toISOString() }
    const existing = await callStorage(ctx, (cb) => storage.get(null, cb))
    const entries = Object.entries({ ...existing, ...payload })
    if (entries.length > STORAGE_SYNC_MAX_ITEMS ||
        entries.reduce((sum, [key, value]) => sum + storageByteLength(key, value), 0) > STORAGE_SYNC_TOTAL_BYTES) {
      throw capacityError()
    }
    await callStorage(ctx, (cb) => storage.set(payload, cb))
    const stale = Object.keys(existing).filter((key) => key.startsWith(`${STORAGE_SYNC_KEY}:`) && !(key in payload))
    if (stale.length) await callStorage(ctx, (cb) => storage.remove(stale, cb))
  },

  async test(_sync, ctx) {
    const storage = getSyncStorage(ctx)
    await callStorage(ctx, (cb) => storage.get(STORAGE_SYNC_KEY, cb))
  }
}

/**
 * provider 元信息表：设置页按它渲染服务商下拉，按 `fields` 决定显示哪些输入框。
 */
export const SYNC_PROVIDER_LIST = [githubGistProvider, giteeGistProvider, webdavProvider, storageSyncProvider]

export const DEFAULT_SYNC_PROVIDER = 'github_gist'

const PROVIDER_MAP = new Map(SYNC_PROVIDER_LIST.map((provider) => [provider.id, provider]))

export const isSyncProviderId = (id) => PROVIDER_MAP.has(id)

/**
 * 取 provider 实现，未知 id 直接抛错（配置写错要 fail-fast，不能静默换成别的源）。
 *
 * @param {string} id provider id。
 * @returns {object} provider 实现。
 */
export const getProvider = (id) => {
  const provider = PROVIDER_MAP.get(id)
  if (!provider) throw new Error(`未知的同步服务商：${id || '(空)'}`)
  return provider
}

/**
 * 按 provider 的字段表判断配置是否齐备。
 *
 * @param {string} id provider id。
 * @param {object} sync 同步配置。
 * @returns {boolean} 是否可直接发请求。
 */
export const isProviderConfigured = (id, sync) => {
  const provider = PROVIDER_MAP.get(id)
  if (!provider) return false
  return provider.fields.every((field) => Boolean(sync?.[field]))
}

/**
 * 取 provider 需要申请的可选主机权限（WebDAV 的域名由用户自己填）。
 *
 * @param {string} id provider id。
 * @param {object} sync 同步配置。
 * @returns {string|null} 形如 https://dav.jianguoyun.com/* 的 origin 模式。
 */
export const getProviderOrigin = (id, sync) => {
  if (id === 'webdav') {
    try {
      const url = new URL(sync?.webdavUrl || '')
      return `${url.origin}/*`
    } catch {
      return null
    }
  }
  if (id === 'github_gist') return 'https://api.github.com/*'
  if (id === 'gitee_gist') return 'https://gitee.com/*'
  return null
}
