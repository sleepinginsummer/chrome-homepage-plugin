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
  rememberSelections: false,
  popupTipDismissed: false,
  searchHistory: [],
  cards: [],
  sync: {
    provider: 'github',
    owner: '',
    repo: '',
    branch: 'main',
    path: 'chrome-home-plugin/config.json',
    token: ''
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

const encodeConfigAsBase64 = (config) => {
  const json = JSON.stringify(config, null, 2)
  return btoa(unescape(encodeURIComponent(json)))
}

const decodeBase64Json = (base64) => {
  const text = decodeURIComponent(escape(atob(base64)))
  return JSON.parse(text)
}

const validateSyncConfig = (sync) => {
  if (!sync) throw new Error('缺少同步配置')
  const required = ['provider', 'owner', 'repo', 'branch', 'path']
  for (const key of required) {
    if (!sync[key]) throw new Error(`同步配置缺少：${key}`)
  }
  if (!sync.token) throw new Error('同步配置缺少：token')
}

const pullRemoteConfig = async (sync) => {
  validateSyncConfig(sync)
  if (sync.provider === 'github') {
    const file = await githubGetFile(sync)
    if (!file) throw new Error('远端文件不存在，请先推送一次')
    return decodeBase64Json(file.content)
  }
  if (sync.provider === 'gitee') {
    const file = await giteeGetFile(sync)
    if (!file) throw new Error('远端文件不存在，请先推送一次')
    return decodeBase64Json(file.content)
  }
  throw new Error(`不支持的 provider：${sync.provider}`)
}

const pushRemoteConfig = async (sync, config) => {
  validateSyncConfig(sync)
  const contentBase64 = encodeConfigAsBase64(config)
  const message = `chore: update chrome-home-plugin config (${new Date().toISOString()})`

  if (sync.provider === 'github') {
    const existing = await githubGetFile(sync)
    const sha = existing?.sha
    await githubPutFile({ ...sync, message, contentBase64, sha })
    return
  }

  if (sync.provider === 'gitee') {
    const existing = await giteeGetFile(sync)
    const sha = existing?.sha
    await giteePutFile({ ...sync, message, contentBase64, sha })
    return
  }

  throw new Error(`不支持的 provider：${sync.provider}`)
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
    sendResponse({ ok: false, error: '未知消息类型' })
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) })
  })
  return true
})
