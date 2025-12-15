const STORAGE_KEY = 'chromeHomeConfig'

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

const readConfig = async () => {
  const result = await chrome.storage.sync.get(STORAGE_KEY)
  return result[STORAGE_KEY] ? deepMerge(DEFAULT_CONFIG, result[STORAGE_KEY]) : structuredClone(DEFAULT_CONFIG)
}

const writeConfig = async (nextConfig) => {
  await chrome.storage.sync.set({ [STORAGE_KEY]: nextConfig })
}

const deepMerge = (base, patch) => {
  if (!patch || typeof patch !== 'object') return structuredClone(base)
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
  const config = await readConfig()
  await writeConfig(config)
})

const openTabs = async (urls) => {
  for (const url of urls) {
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

  const scpLike = raw.match(/^git@([^:]+):(.+)$/i)
  const normalized = scpLike ? `ssh://${raw.replace(':', '/')}` : raw

  let url
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('gitUrl 格式不正确（示例：git@github.com:owner/repo.git）')
  }

  const host = url.hostname.toLowerCase()
  const provider = host.includes('gitee.com') ? 'gitee' : host.includes('github.com') ? 'github' : null
  if (!provider) throw new Error('暂仅支持 GitHub / Gitee 的 gitUrl')

  const parts = url.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('gitUrl 需包含 owner 与 repo（示例：git@github.com:owner/repo.git）')

  const owner = parts[0]
  const repo = parts[1]
  return { provider, owner, repo }
}

const normalizeSyncConfig = (sync) => {
  const raw = sync || {}

  const gitUrl = raw.gitUrl || (raw.owner && raw.repo ? `https://${raw.provider === 'gitee' ? 'gitee.com' : 'github.com'}/${raw.owner}/${raw.repo}` : '')
  const parsed = gitUrl ? parseGitRemote(gitUrl) : null

  return {
    provider: raw.provider || parsed?.provider || 'github',
    owner: raw.owner || parsed?.owner || '',
    repo: raw.repo || parsed?.repo || '',
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
  if (normalized.provider === 'gitee_gist') {
    if (!normalized.gistId) throw new Error('同步配置缺少：gistId')
  } else {
    const required = ['provider', 'owner', 'repo', 'branch', 'path']
    for (const key of required) {
      if (!normalized[key]) throw new Error(`同步配置缺少：${key}`)
    }
  }
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
      await openTabs(message.urls || [])
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'pullRemote') {
      const config = await readConfig()
      const remote = await pullRemoteConfig(config.sync)
      const merged = deepMerge(DEFAULT_CONFIG, remote)
      await writeConfig(merged)
      sendResponse({ ok: true, data: merged })
      return
    }
    if (message?.type === 'pushRemote') {
      const config = await readConfig()
      await pushRemoteConfig(config.sync, config)
      sendResponse({ ok: true })
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
    sendResponse({ ok: false, error: err?.message || String(err) })
  })
  return true
})
