const STORAGE_KEY = 'chromeHomeConfig'
const LAST_SYNC_AT_KEY = 'chromeHomeLastSyncAt'

const DEFAULT_ENGINES = [
  { name: 'GOOGLE', baseUrl: 'https://www.google.com/search?q=' },
  { name: 'BING', baseUrl: 'https://www.bing.com/search?q=' },
  { name: 'DuckDuckGo', baseUrl: 'https://duckduckgo.com/?q=' },
  { name: 'GitHub Search', baseUrl: 'https://github.com/search?q=' },
  { name: 'BAIDU', baseUrl: 'https://www.baidu.com/s?wd=' }
]

const DEFAULT_CONFIG = {
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

/** storage.sync.get 的 Promise/回调兼容封装 */
const storageSyncGet = (keys) =>
  new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(keys, (result) => {
        const err = chrome.runtime?.lastError
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

/** storage.sync.set 的 Promise/回调兼容封装 */
const storageSyncSet = (data) =>
  new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set(data, () => {
        const err = chrome.runtime?.lastError
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

/** storage.local.set 的 Promise/回调兼容封装 */
const storageLocalSet = (data) =>
  new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(data, () => {
        const err = chrome.runtime?.lastError
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

/** 在缺少 structuredClone 时安全复制对象 */
const safeStructuredClone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

/** 读取配置并合并默认值 */
const readConfig = async () => {
  console.log('[chrome-home] readConfig:start')
  const result = await storageSyncGet(STORAGE_KEY)
  const merged = result[STORAGE_KEY] ? deepMerge(DEFAULT_CONFIG, result[STORAGE_KEY]) : safeStructuredClone(DEFAULT_CONFIG)
  console.log('[chrome-home] readConfig:done')
  return merged
}

/** 写入配置 */
const writeConfig = async (nextConfig) => {
  console.log('[chrome-home] writeConfig:start')
  await storageSyncSet({ [STORAGE_KEY]: nextConfig })
  console.log('[chrome-home] writeConfig:done')
}

/** 写入最近同步时间 */
const writeLastSyncAt = async (isoTime) => {
  console.log('[chrome-home] writeLastSyncAt:start')
  const value = typeof isoTime === 'string' && isoTime ? isoTime : new Date().toISOString()
  await storageLocalSet({ [LAST_SYNC_AT_KEY]: value })
  console.log('[chrome-home] writeLastSyncAt:done')
  return value
}

const deepMerge = (base, patch) => {
  if (!patch || typeof patch !== 'object') return safeStructuredClone(base)
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[chrome-home] onInstalled:start')
  const config = await readConfig()
  await writeConfig(config)
  console.log('[chrome-home] onInstalled:done')
})

/** 按需使用当前标签页打开首个地址，其余在后台打开 */
const openTabs = async (urls, currentTabId) => {
  console.log('[chrome-home] openTabs', { count: Array.isArray(urls) ? urls.length : 0 })
  const list = Array.isArray(urls) ? urls.filter(Boolean) : []
  if (!list.length) return

  const [first, ...rest] = list
  if (typeof currentTabId === 'number') {
    // 保持在当前标签页打开首个结果
    await chrome.tabs.update(currentTabId, { url: first, active: true })
  } else {
    await chrome.tabs.create({ url: first, active: true })
  }

  for (const url of rest) {
    await chrome.tabs.create({ url, active: false })
  }
}

const normalizeBase64 = (base64) => base64.replace(/\n/g, '')

const encodePath = (path) =>
  String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'
const DEFAULT_SYNC_BRANCH = 'main'
const DEFAULT_GITEE_GIST_FILENAME = 'config.json'

const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) throw new Error('同步配置缺少：gitUrl')

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) {
    return { provider: 'gitee_gist', gistId: giteeCodes[1] }
  }
  throw new Error('仅支持 Gitee 代码片段地址（示例：https://gitee.com/<用户名>/codes/<代码片段ID>）')
}

const normalizeSyncConfig = (sync) => {
  const raw = sync || {}

  const gitUrl = raw.gitUrl || ''
  const parsed = gitUrl ? parseGitRemote(gitUrl) : null

  return {
    provider: 'gitee_gist',
    owner: '',
    repo: '',
    gistId: raw.gistId || parsed?.gistId || '',
    branch: raw.branch || DEFAULT_SYNC_BRANCH,
    path: raw.path || DEFAULT_SYNC_PATH,
    token: raw.token || '',
    gitUrl: raw.gitUrl || gitUrl,
    autoPush: Boolean(raw.autoPush)
  }
}

const githubGetFile = async ({ owner, repo, path, branch, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
  const res = await fetch(url, {
    headers: token ? { Authorization: `token ${token}` } : {}
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub 获取失败：${res.status}`)
  return res.json()
}

const githubPutFile = async ({ owner, repo, path, branch, token, message, contentBase64, sha }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `token ${token}` } : {})
    },
    body: JSON.stringify({
      message,
      content: normalizeBase64(contentBase64),
      branch,
      ...(sha ? { sha } : {})
    })
  })
  if (!res.ok) throw new Error(`GitHub 写入失败：${res.status}`)
  return res.json()
}

const giteeGetFile = async ({ owner, repo, path, branch, token }) => {
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Gitee 获取失败：${res.status}`)
  return res.json()
}

const giteePutFile = async ({ owner, repo, path, branch, token, message, contentBase64, sha }) => {
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`
  const form = new URLSearchParams()
  form.set('access_token', token)
  form.set('message', message)
  form.set('content', normalizeBase64(contentBase64))
  form.set('branch', branch)
  if (sha) form.set('sha', sha)

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form.toString()
  })
  if (!res.ok) throw new Error(`Gitee 写入失败：${res.status}`)
  return res.json()
}

const giteeGistGet = async ({ gistId, token }) => {
  const url = `https://gitee.com/api/v5/gists/${encodeURIComponent(gistId)}?access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Gitee 代码片段获取失败：${res.status}`)
  return res.json()
}

const giteeGistUpdateFile = async ({ gistId, token, filename, content, description }) => {
  const url = `https://gitee.com/api/v5/gists/${encodeURIComponent(gistId)}?access_token=${encodeURIComponent(token)}`
  const body = {
    ...(description ? { description } : {}),
    files: {
      [filename]: { content }
    }
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Gitee 代码片段更新失败：${res.status}`)
  return res.json()
}

const extractGiteeSha = (file) => {
  if (!file || typeof file !== 'object') return ''
  const sha = file.sha || file?.commit?.sha || file?.content?.sha
  return typeof sha === 'string' ? sha : ''
}

const encodeConfigAsBase64 = (config) => {
  const json = JSON.stringify(config, null, 2)
  return btoa(unescape(encodeURIComponent(json)))
}

const decodeBase64Json = (base64) => {
  const text = decodeURIComponent(escape(atob(base64)))
  return JSON.parse(text)
}

const validateSyncConfig = (sync) => {
  const normalized = normalizeSyncConfig(sync)
  if (!normalized.gitUrl) throw new Error('同步配置缺少：gitUrl')
  if (normalized.provider !== 'gitee_gist') throw new Error('当前版本仅支持 Gitee 代码片段同步')
  if (!normalized.gistId) throw new Error('同步配置缺少：gistId')
  if (!normalized.token) throw new Error('同步配置缺少：token')
  return normalized
}

const githubCheckRepo = async ({ owner, repo, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const res = await fetch(url, { headers: token ? { Authorization: `token ${token}` } : {} })
  if (res.status === 404) throw new Error('仓库不存在或无权限访问')
  if (!res.ok) throw new Error(`GitHub 仓库检查失败：${res.status}`)
}

const githubCheckBranch = async ({ owner, repo, branch, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
  const res = await fetch(url, { headers: token ? { Authorization: `token ${token}` } : {} })
  if (res.status === 404) throw new Error('分支不存在或无权限访问')
  if (!res.ok) throw new Error(`GitHub 分支检查失败：${res.status}`)
}

const giteeCheckRepo = async ({ owner, repo, token }) => {
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${
    token ? `?access_token=${encodeURIComponent(token)}` : ''
  }`
  const res = await fetch(url)
  if (res.status === 404) throw new Error('仓库不存在或无权限访问')
  if (!res.ok) throw new Error(`Gitee 仓库检查失败：${res.status}`)
}

const giteeCheckBranch = async ({ owner, repo, branch, token }) => {
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}${
    token ? `?access_token=${encodeURIComponent(token)}` : ''
  }`
  const res = await fetch(url)
  if (res.status === 404) throw new Error('分支不存在或无权限访问')
  if (!res.ok) throw new Error(`Gitee 分支检查失败：${res.status}`)
}

const testRemoteConfig = async (sync) => {
  const normalized = validateSyncConfig(sync)
  if (normalized.provider === 'gitee_gist') {
    const gist = await giteeGistGet(normalized)
    if (!gist) throw new Error('代码片段不存在或无权限访问')
    return
  }
  if (normalized.provider === 'github') {
    await githubCheckRepo(normalized)
    await githubCheckBranch(normalized)
    return
  }
  if (normalized.provider === 'gitee') {
    await giteeCheckRepo(normalized)
    await giteeCheckBranch(normalized)
    return
  }
  throw new Error(`不支持的 provider：${normalized.provider}`)
}

const pullRemoteConfig = async (sync) => {
  const normalized = validateSyncConfig(sync)
  if (normalized.provider === 'gitee_gist') {
    const gist = await giteeGistGet(normalized)
    if (!gist) throw new Error('远端代码片段不存在或无权限访问')
    const file = gist?.files?.[DEFAULT_GITEE_GIST_FILENAME]
    const content = typeof file?.content === 'string' ? file.content : null
    if (!content) throw new Error(`远端代码片段缺少文件：${DEFAULT_GITEE_GIST_FILENAME}`)
    return JSON.parse(content)
  }
  if (normalized.provider === 'github') {
    const file = await githubGetFile(normalized)
    if (!file) throw new Error('远端文件不存在，请先推送一次')
    return decodeBase64Json(file.content)
  }
  if (normalized.provider === 'gitee') {
    const file = await giteeGetFile(normalized)
    if (!file) throw new Error('远端文件不存在，请先推送一次')
    return decodeBase64Json(file.content)
  }
  throw new Error(`不支持的 provider：${normalized.provider}`)
}

const shouldIgnorePullBeforePushError = (err) => {
  const message = err?.message || String(err || '')
  return message.includes('远端代码片段缺少文件：') || message.includes('远端文件不存在，请先推送一次')
}

const pushRemoteConfig = async (sync, config) => {
  const normalized = validateSyncConfig(sync)
  const message = `chore: update chrome-home-plugin config (${new Date().toISOString()})`

  if (normalized.provider === 'gitee_gist') {
    const json = JSON.stringify(config, null, 2)
    await giteeGistUpdateFile({
      gistId: normalized.gistId,
      token: normalized.token,
      filename: DEFAULT_GITEE_GIST_FILENAME,
      content: json,
      description: message
    })
    return
  }

  const contentBase64 = encodeConfigAsBase64(config)

  if (normalized.provider === 'github') {
    const existing = await githubGetFile(normalized)
    const sha = existing?.sha
    await githubPutFile({ ...normalized, message, contentBase64, sha })
    return
  }

  if (normalized.provider === 'gitee') {
    const existing = await giteeGetFile(normalized)
    const sha = extractGiteeSha(existing)
    if (existing && !sha) {
      throw new Error('Gitee 更新需要 sha，但未能从远端文件信息中获取 sha（请先确认 token 有权限且文件存在）')
    }
    await giteePutFile({ ...normalized, message, contentBase64, sha })
    return
  }

  throw new Error(`不支持的 provider：${normalized.provider}`)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[chrome-home] onMessage', message?.type)
  ;(async () => {
    if (message?.type === 'getConfig') {
      sendResponse({ ok: true, data: await readConfig() })
      return
    }
    if (message?.type === 'setConfig') {
      const current = await readConfig()
      const next = deepMerge(current, message.data || {})
      await writeConfig(next)
      sendResponse({ ok: true, data: next })
      return
    }
    if (message?.type === 'openTabs') {
      await openTabs(message.urls || [], _sender?.tab?.id)
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'pullRemote') {
      const config = await readConfig()
      const remote = await pullRemoteConfig(config.sync)
      const merged = deepMerge(DEFAULT_CONFIG, remote)
      await writeConfig(merged)
      const lastSyncAt = await writeLastSyncAt()
      sendResponse({ ok: true, data: merged, lastSyncAt })
      return
    }
    if (message?.type === 'pushRemote') {
      const config = await readConfig()
      let nextConfig = config
      try {
        const remote = await pullRemoteConfig(config.sync)
        const remoteWithDefaults = deepMerge(DEFAULT_CONFIG, remote)
        nextConfig = deepMerge(remoteWithDefaults, config)
        await writeConfig(nextConfig)
      } catch (err) {
        if (!shouldIgnorePullBeforePushError(err)) throw err
      }
      await pushRemoteConfig(nextConfig.sync, nextConfig)
      const lastSyncAt = await writeLastSyncAt()
      sendResponse({ ok: true, lastSyncAt })
      return
    }
    if (message?.type === 'testRemote') {
      const config = await readConfig()
      await testRemoteConfig(config.sync)
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: '未知消息类型' })
  })().catch((err) => {
    console.error('[chrome-home] onMessage:error', err)
    sendResponse({ ok: false, error: err?.message || String(err) })
  })
  return true
})
