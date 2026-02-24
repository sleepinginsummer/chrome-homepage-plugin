/**
 * @fileoverview
 * 远端同步（Gitee 代码片段优先）的共享实现。
 *
 * 该文件从 background.js 中抽离，供两处使用：
 * - background/service worker 正常在线时处理消息
 * - newtab/options 在 background 暂时不可用时，走本地兜底也能完成同步
 *
 * 注意：
 * - 当前版本仍保持“仅支持 Gitee 代码片段同步”的对外行为（与原实现一致）。
 * - 为了兼容 Node/Vitest，base64 编解码提供 Buffer fallback。
 */

const normalizeBase64 = (base64) => String(base64 || '').replace(/\n/g, '')

/**
 * 将 UTF-8 字符串编码为 base64（浏览器用 btoa，Node 用 Buffer 兜底）。
 */
const base64EncodeUtf8 = (text) => {
  const raw = String(text ?? '')
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(raw)))
  // Node 环境（vitest）兜底
  return Buffer.from(raw, 'utf8').toString('base64')
}

/**
 * 将 base64 解码为 UTF-8 字符串（浏览器用 atob，Node 用 Buffer 兜底）。
 */
const base64DecodeUtf8 = (base64) => {
  const raw = String(base64 ?? '')
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(raw)))
  return Buffer.from(raw, 'base64').toString('utf8')
}

const encodePath = (path) =>
  String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

export const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'
const DEFAULT_SYNC_BRANCH = 'main'
const DEFAULT_GITEE_GIST_FILENAME = 'config.json'

/**
 * 解析同步地址（仅支持 Gitee 代码片段 /codes/...）。
 */
export const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) throw new Error('同步配置缺少：gitUrl')

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) return { provider: 'gitee_gist', gistId: giteeCodes[1] }
  throw new Error('仅支持 Gitee 代码片段地址（示例：https://gitee.com/<用户名>/codes/<代码片段ID>）')
}

/**
 * 规范化 sync 配置：补齐默认值并从 gitUrl 推导 gistId。
 */
export const normalizeSyncConfig = (sync) => {
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

/**
 * 校验 sync 配置并返回规范化对象。
 */
export const validateSyncConfig = (sync) => {
  const normalized = normalizeSyncConfig(sync)
  if (!normalized.gitUrl) throw new Error('同步配置缺少：gitUrl')
  if (normalized.provider !== 'gitee_gist') throw new Error('当前版本仅支持 Gitee 代码片段同步')
  if (!normalized.gistId) throw new Error('同步配置缺少：gistId')
  if (!normalized.token) throw new Error('同步配置缺少：token')
  return normalized
}

const githubGetFile = async ({ owner, repo, path, branch, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
  const res = await fetch(url, { headers: token ? { Authorization: `token ${token}` } : {} })
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

const decodeBase64Json = (base64) => JSON.parse(base64DecodeUtf8(base64))

const encodeConfigAsBase64 = (config) => base64EncodeUtf8(JSON.stringify(config, null, 2))

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

/**
 * 测试远端配置是否可访问。
 */
export const testRemoteConfig = async (sync) => {
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

/**
 * 从远端拉取配置并返回 JSON 对象。
 */
export const pullRemoteConfig = async (sync) => {
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

/**
 * 推送配置到远端。
 */
export const pushRemoteConfig = async (sync, config) => {
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

/**
 * pushRemote 逻辑中“先拉取再推送”的合并策略（与原 background 实现一致）。
 */
export const computeConfigBeforePush = async ({ sync, localConfig, deepMerge, defaultConfig }) => {
  let nextConfig = localConfig
  try {
    const remote = await pullRemoteConfig(sync)
    const remoteWithDefaults = deepMerge(defaultConfig, remote)
    nextConfig = deepMerge(remoteWithDefaults, localConfig)
  } catch (err) {
    // 重要逻辑：远端不存在文件时允许直接推送首次配置。
    if (!shouldIgnorePullBeforePushError(err)) throw err
  }
  return nextConfig
}

