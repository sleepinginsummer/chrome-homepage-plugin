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
 */

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
 * 非抛错版的地址解析：表单与本地判断用它，地址不合法时返回 null 而不是中断交互。
 */
export const tryParseGitRemote = (gitUrl) => {
  try {
    return parseGitRemote(gitUrl)
  } catch {
    return null
  }
}

/**
 * 按 sync 字段表生成规范化对象（解析结果由调用方决定是否校验）。
 *
 * 注意：gistId 以地址推导为准。存量配置里可能同时留着旧 gistId 和新改的 gitUrl，
 * 若让存量值优先，校验与请求会继续打到旧代码片段；只有没有可用地址时才回退存量值。
 */
const buildSyncConfig = (raw, parsed) => ({
  provider: 'gitee_gist',
  owner: '',
  repo: '',
  gistId: parsed?.gistId || raw.gistId || '',
  branch: raw.branch || DEFAULT_SYNC_BRANCH,
  path: raw.path || DEFAULT_SYNC_PATH,
  token: raw.token || '',
  gitUrl: raw.gitUrl || '',
  autoPush: Boolean(raw.autoPush)
})

/**
 * 规范化 sync 配置：补齐默认值并从 gitUrl 推导 gistId；地址不合法时抛错。
 * 网络路径用这个版本，保证拿到合法的 gistId 再发请求。
 */
export const normalizeSyncConfig = (sync) => {
  const raw = sync || {}
  const gitUrl = raw.gitUrl || ''
  return buildSyncConfig(raw, gitUrl ? parseGitRemote(gitUrl) : null)
}

/**
 * 表单/本地判断用的非抛错规范化：地址写错时只保留原始输入，不打断表单与自动推送判断。
 * 与 normalizeSyncConfig 共用同一份字段表，避免两处规则漂移。
 */
export const normalizeSyncDraft = (sync) => {
  const raw = sync || {}
  return buildSyncConfig(raw, tryParseGitRemote(raw.gitUrl))
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
const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const hashString = async (text) => {
  const raw = String(text ?? '')
  if (globalThis.crypto?.subtle && typeof TextEncoder === 'function') {
    const bytes = new TextEncoder().encode(raw)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  if (typeof Buffer !== 'undefined') {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(raw, 'utf8').digest('hex')
  }
  throw new Error('当前环境不支持配置 hash 计算')
}

/**
 * 计算配置内容 hash。排序对象 key，避免 JSON 字段顺序变化导致误判。
 */
export const computeConfigHash = async (config) => hashString(stableStringify(config || {}))

/**
 * 推送前保护：远端自上次拉取/推送后发生变化时，阻止旧本地配置覆盖新远端。
 */
export const assertRemoteBaselineFresh = async ({ remoteConfig, lastRemoteHash }) => {
  if (!lastRemoteHash) return
  const currentRemoteHash = await computeConfigHash(remoteConfig)
  if (currentRemoteHash === lastRemoteHash) return
  throw new Error('远端配置已被其他设备更新，已阻止覆盖。请先从远端拉取确认后再推送。')
}

const getCardTitles = (config) => (Array.isArray(config?.cards) ? config.cards.map((card) => card?.title).filter(Boolean) : [])

/**
 * 推送后校验：重新读取远端，确认关键卡片数量和标题与本次推送一致。
 */
export const assertRemoteConfigMatches = ({ expectedConfig, actualConfig }) => {
  const expectedTitles = getCardTitles(expectedConfig)
  const actualTitles = getCardTitles(actualConfig)
  const missingTitles = expectedTitles.filter((title) => !actualTitles.includes(title))
  if (expectedTitles.length === actualTitles.length && missingTitles.length === 0) return

  const preview = missingTitles.slice(0, 6).join(' / ')
  throw new Error(
    `远端写入校验失败：期望 ${expectedTitles.length} 个卡片，实际 ${actualTitles.length} 个。缺少：${preview}`
  )
}

/**
 * 测试远端配置是否可访问。
 */
export const testRemoteConfig = async (sync) => {
  const normalized = validateSyncConfig(sync)
  const gist = await giteeGistGet(normalized)
  if (!gist) throw new Error('代码片段不存在或无权限访问')
}

/**
 * 从远端拉取配置并返回 JSON 对象。
 */
export const pullRemoteConfig = async (sync) => {
  const normalized = validateSyncConfig(sync)
  const gist = await giteeGistGet(normalized)
  if (!gist) throw new Error('远端代码片段不存在或无权限访问')
  const file = gist?.files?.[DEFAULT_GITEE_GIST_FILENAME]
  const content = typeof file?.content === 'string' ? file.content : null
  if (!content) throw new Error(`远端代码片段缺少文件：${DEFAULT_GITEE_GIST_FILENAME}`)
  return JSON.parse(content)
}

const shouldIgnorePullBeforePushError = (err) => {
  const message = err?.message || String(err || '')
  return message.includes('远端代码片段缺少文件：')
}

/**
 * 推送配置到远端。
 */
export const pushRemoteConfig = async (sync, config) => {
  const normalized = validateSyncConfig(sync)
  const message = `chore: update chrome-home-plugin config (${new Date().toISOString()})`
  await giteeGistUpdateFile({
    gistId: normalized.gistId,
    token: normalized.token,
    filename: DEFAULT_GITEE_GIST_FILENAME,
    content: JSON.stringify(config, null, 2),
    description: message
  })
}

/**
 * pushRemote 逻辑中“先拉取再推送”的合并策略（与原 background 实现一致）。
 */
export const computeConfigBeforePush = async ({ sync, localConfig, deepMerge, defaultConfig, lastRemoteHash = '' }) => {
  let nextConfig = localConfig
  try {
    const remote = await pullRemoteConfig(sync)
    await assertRemoteBaselineFresh({ remoteConfig: remote, lastRemoteHash })
    const remoteWithDefaults = deepMerge(defaultConfig, remote)
    nextConfig = deepMerge(remoteWithDefaults, localConfig)
  } catch (err) {
    // 重要逻辑：远端不存在文件时允许直接推送首次配置。
    if (!shouldIgnorePullBeforePushError(err)) throw err
  }
  return nextConfig
}

/**
 * 推送配置并立即读回校验，避免接口返回成功但远端内容并非本次配置。
 */
export const pushRemoteConfigAndVerify = async (sync, config) => {
  await pushRemoteConfig(sync, config)
  const remote = await pullRemoteConfig(sync)
  assertRemoteConfigMatches({ expectedConfig: config, actualConfig: remote })
  return remote
}
