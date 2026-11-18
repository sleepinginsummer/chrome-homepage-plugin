/**
 * @fileoverview
 * 远端同步的对外实现：配置规范化 + 拉取/推送/回滚编排。
 *
 * 分层：
 * - sync-providers.js    管"存到哪儿"（Gitee/GitHub 代码片段、WebDAV、chrome.storage.sync）
 * - sync-remote-doc.js   管"存什么格式"（信封、快照环、分区挑选）
 * - 本文件                管"什么时候读、怎么合并、怎么校验"
 *
 * 兼容：
 * - 存量配置只有 { gitUrl, token }，没有 provider：按地址自动推断服务商。
 * - 存量远端文件是裸 config：parseRemoteDoc 按 schemaVersion 0 读取。
 * - 同步 token 永不写入远端，远端 payload 里不含 sync 字段。
 */

import {
  DEFAULT_SNAPSHOT_KEEP,
  DEFAULT_SYNC_SECTIONS,
  buildRemoteDoc,
  buildRemotePayload,
  clampSnapshotKeep,
  computeConfigHash,
  findSnapshotPayload,
  normalizeSyncSections,
  parseRemoteDoc,
  serializeRemoteDoc,
  summarizeSnapshots
} from './sync-remote-doc.js'
import { DEFAULT_SYNC_PROVIDER, getProvider, isSyncProviderId } from './sync-providers.js'

export const DEFAULT_SYNC_PATH = 'config.json'
const DEFAULT_SYNC_BRANCH = 'main'

export { DEFAULT_SNAPSHOT_KEEP, DEFAULT_SYNC_SECTIONS, computeConfigHash, normalizeSyncSections }

/**
 * 解析 Gist 地址，返回服务商与 gistId。
 *
 * 支持：
 * - Gitee 代码片段：https://gitee.com/<用户名>/codes/<ID>
 * - GitHub Gist：https://gist.github.com/<用户名>/<ID>、https://gist.github.com/<ID>
 * - GitHub 旧地址：https://github.com/<用户名>/gists/<ID>
 *
 * @param {string} gitUrl 用户填写的地址。
 * @returns {{provider: string, gistId: string}} 解析结果。
 */
export const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) throw new Error('同步配置缺少：gitUrl')

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) return { provider: 'gitee_gist', gistId: giteeCodes[1] }

  const githubGist = raw.match(/^https?:\/\/gist\.github\.com\/(?:[^/?#]+\/)?([0-9a-f]+)(?:[/?#]|$)/i)
  if (githubGist) return { provider: 'github_gist', gistId: githubGist[1] }

  const githubGists = raw.match(/^https?:\/\/github\.com\/[^/]+\/gists\/([0-9a-f]+)(?:[/?#]|$)/i)
  if (githubGists) return { provider: 'github_gist', gistId: githubGists[1] }

  throw new Error(
    '代码片段地址无法识别。支持：https://gitee.com/<用户名>/codes/<ID> 或 https://gist.github.com/<用户名>/<ID>'
  )
}

/**
 * 非抛错版的地址解析：表单与本地判断用它，地址不合法时返回 null 而不是中断交互。
 *
 * @param {string} gitUrl 地址。
 * @returns {{provider: string, gistId: string}|null} 解析结果。
 */
export const tryParseGitRemote = (gitUrl) => {
  try {
    return parseGitRemote(gitUrl)
  } catch {
    return null
  }
}

/**
 * 推断服务商：显式 provider 优先，其次按地址猜，最后回落到默认值。
 *
 * @param {object} raw 原始 sync 配置。
 * @returns {string} provider id。
 */
const inferProvider = (raw) => {
  if (isSyncProviderId(raw.provider)) return raw.provider
  const parsed = tryParseGitRemote(raw.gitUrl)
  if (parsed?.provider) return parsed.provider
  if (typeof raw.webdavUrl === 'string' && raw.webdavUrl.trim()) return 'webdav'
  return DEFAULT_SYNC_PROVIDER
}

const isGistProvider = (provider) => provider === 'gitee_gist' || provider === 'github_gist'

/**
 * 按 sync 字段表生成规范化对象。
 *
 * 注意：gistId 以地址推导为准。存量配置里可能同时留着旧 gistId 和新改的 gitUrl，
 * 若让存量值优先，校验与请求会继续打到旧代码片段；只有没有可用地址时才回退存量值。
 *
 * @param {object} raw 原始配置。
 * @param {{provider: string, gistId: string}|null} parsed 地址解析结果（容错版）。
 * @returns {object} 规范化配置。
 */
const buildSyncConfig = (raw, parsed) => {
  const provider = inferProvider(raw)
  return {
    provider,
    gitUrl: raw.gitUrl || '',
    gistId: isGistProvider(provider) ? parsed?.gistId || raw.gistId || '' : '',
    webdavUrl: raw.webdavUrl || '',
    username: raw.username || '',
    branch: raw.branch || DEFAULT_SYNC_BRANCH,
    path: raw.path || DEFAULT_SYNC_PATH,
    token: raw.token || '',
    autoPush: Boolean(raw.autoPush),
    sections: normalizeSyncSections(raw.sections),
    snapshotKeep: clampSnapshotKeep(raw.snapshotKeep ?? DEFAULT_SNAPSHOT_KEEP)
  }
}

/**
 * 规范化 sync 配置：补齐默认值并从 gitUrl 推导 gistId；地址不合法时抛错。
 *
 * @param {object} sync 同步配置。
 * @returns {object} 规范化配置。
 */
export const normalizeSyncConfig = (sync) => {
  const raw = sync || {}
  const provider = inferProvider(raw)
  if (!isGistProvider(provider)) return buildSyncConfig(raw, null)
  const gitUrl = raw.gitUrl || ''
  return buildSyncConfig(raw, gitUrl ? parseGitRemote(gitUrl) : null)
}

/**
 * 表单/本地判断用的非抛错规范化：地址写错时只保留原始输入，不打断表单与自动推送判断。
 * 与 normalizeSyncConfig 共用同一份字段表，避免两处规则漂移。
 *
 * @param {object} sync 同步配置。
 * @returns {object} 规范化配置。
 */
export const normalizeSyncDraft = (sync) => buildSyncConfig(sync || {}, tryParseGitRemote(sync?.gitUrl))

/**
 * 判断同步配置是否齐备（自动同步、启动同步都用它，避免各处重复写必填字段）。
 *
 * @param {object} sync 同步配置。
 * @returns {boolean} 是否可直接发起同步。
 */
export const isSyncConfigured = (sync) => {
  const normalized = normalizeSyncDraft(sync)
  if (!isSyncProviderId(normalized.provider)) return false
  if (normalized.provider === 'storage_sync') return true
  if (normalized.provider === 'webdav') return Boolean(normalized.webdavUrl.trim() && normalized.username && normalized.token)
  return Boolean(normalized.gistId && normalized.token)
}

/**
 * 校验 sync 配置并返回规范化对象，服务商各自的必填项有不同的提示。
 *
 * @param {object} sync 同步配置。
 * @returns {object} 规范化配置。
 */
export const validateSyncConfig = (sync) => {
  const normalized = normalizeSyncConfig(sync)
  if (!isSyncProviderId(normalized.provider)) throw new Error(`未知的同步服务商：${normalized.provider}`)

  if (normalized.provider === 'storage_sync') return normalized

  if (normalized.provider === 'webdav') {
    if (!normalized.webdavUrl.trim()) throw new Error('同步配置缺少：WebDAV 地址')
    let url
    try {
      url = new URL(normalized.webdavUrl.trim())
    } catch {
      throw new Error('WebDAV 地址无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WebDAV 地址须使用 HTTP 或 HTTPS')
    if (!normalized.username) throw new Error('同步配置缺少：WebDAV 用户名')
    if (!normalized.token) throw new Error('同步配置缺少：WebDAV 密码（应用密码）')
    return normalized
  }

  if (!normalized.gitUrl) throw new Error('同步配置缺少：代码片段地址')
  if (!normalized.gistId) throw new Error('同步配置缺少：gistId')
  if (!normalized.token) throw new Error('同步配置缺少：token')
  return normalized
}


/** 只在完整同步内容与写入值一致时，才确认推送成功。 */
export const assertRemoteConfigMatches = async ({ expectedConfig, actualConfig }) => {
  if (await computeConfigHash(expectedConfig) !== await computeConfigHash(actualConfig)) {
    throw new Error('远端写入校验失败：读回的同步内容与本次写入不一致')
  }
}

/**
 * 读远端并解析成文档。
 *
 * @param {object} sync 同步配置。
 * @param {object} [options]
 * @param {object} [options.chromeApi] Chrome API（storage.sync 源需要）。
 * @returns {Promise<{doc: object|null, provider: object, sync: object}>} 读取结果。
 */
export const readRemoteDocument = async (sync, options = {}) => {
  const normalized = validateSyncConfig(sync)
  const provider = getProvider(normalized.provider)
  const ctx = { chromeApi: options.chromeApi }
  const text = await provider.read(normalized, ctx)
  return { doc: parseRemoteDoc(text), provider, sync: normalized, ctx }
}

/**
 * 测试远端配置是否可访问。
 *
 * @param {object} sync 同步配置。
 * @param {object} [options] 透传 chromeApi。
 * @returns {Promise<void>} 失败抛错。
 */
export const testRemoteConfig = async (sync, options = {}) => {
  const normalized = validateSyncConfig(sync)
  await getProvider(normalized.provider).test(normalized, { chromeApi: options.chromeApi })
}

/**
 * 从远端拉取配置 payload。
 *
 * @param {object} sync 同步配置。
 * @param {object} [options] 透传 chromeApi。
 * @returns {Promise<object>} 远端 payload。
 */
export const pullRemoteConfig = async (sync, options = {}) => {
  const { doc } = await readRemoteDocument(sync, options)
  if (!doc) throw new Error('远端还没有配置文件，请先推送一次')
  return doc.payload
}

/**
 * 拉取远端状态：当前配置 + 备份版本摘要，供设置页展示。
 *
 * @param {object} sync 同步配置。
 * @param {object} [options] 透传 chromeApi。
 * @returns {Promise<{config: object|null, updatedAt: string, updatedAtDevice: string, snapshots: Array, supportsSnapshots: boolean}>}
 */
export const pullRemoteState = async (sync, options = {}) => {
  const { doc, provider } = await readRemoteDocument(sync, options)
  return {
    config: doc?.payload || null,
    updatedAt: doc?.updatedAt || '',
    updatedAtDevice: doc?.device?.name || '',
    snapshots: summarizeSnapshots(doc),
    supportsSnapshots: Boolean(provider.supportsSnapshots)
  }
}

/**
 * 推送配置到远端（整份覆盖，旧内容进快照环）。
 *
 * @param {object} sync 同步配置。
 * @param {object} config 完整本地配置。
 * @param {object} [options]
 * @param {object} [options.chromeApi] Chrome API。
 * @param {{id: string, name?: string}} [options.device] 设备信息。
 * @param {string} [options.now] 覆盖写入时间（测试用）。
 * @returns {Promise<object>} 写入的文档。
 */
export const pushRemoteConfig = async (sync, config, options = {}) => {
  const normalized = validateSyncConfig(sync)
  const provider = getProvider(normalized.provider)
  const ctx = options.source?.ctx || { chromeApi: options.chromeApi }
  const payload = buildRemotePayload(config, normalized.sections)

  // 使用做过冲突检查的同一份远端文档构建快照。
  const previous = provider.supportsSnapshots
    ? (options.source ? options.source.doc : parseRemoteDoc(await provider.read(normalized, ctx)))
    : null
  const doc = buildRemoteDoc({
    previous,
    payload,
    device: options.device,
    keep: normalized.snapshotKeep,
    now: options.now
  })
  await provider.write(normalized, ctx, serializeRemoteDoc(doc))
  return doc
}


/**
 * 推送配置并立即读回校验，避免接口返回成功但远端内容并非本次配置。
 *
 * @param {object} sync 同步配置。
 * @param {object} config 完整本地配置。
 * @param {object} [options] 透传 chromeApi/device。
 * @returns {Promise<object>} 校验后的远端 payload。
 */
export const pushRemoteConfigAndVerify = async (sync, config, options = {}) => {
  const normalized = validateSyncConfig(sync)
  const written = await pushRemoteConfig(normalized, config, options)
  const { doc } = await readRemoteDocument(normalized, options)
  await assertRemoteConfigMatches({ expectedConfig: written, actualConfig: doc })
  return doc.payload
}

/**
 * 回滚到指定备份版本。
 *
 * 关键逻辑：回滚本身也是一次写入，因此"回滚前的状态"会自动进快照环，
 * 用户回滚错了还能再回到回滚前。
 *
 * @param {object} sync 同步配置。
 * @param {string} at 快照时间戳。
 * @param {object} [options] 透传 chromeApi/device/now。
 * @returns {Promise<object>} 回滚后的 payload。
 */
export const restoreRemoteSnapshot = async (sync, at, options = {}) => {
  const { doc, provider, sync: normalized, ctx } = options.source || await readRemoteDocument(sync, options)
  if (!provider.supportsSnapshots) throw new Error('当前同步源不支持备份回滚')
  if (!doc) throw new Error('远端还没有配置文件')

  const payload = findSnapshotPayload(doc, at)
  const nextDoc = buildRemoteDoc({
    previous: doc,
    payload,
    device: options.device,
    keep: normalized.snapshotKeep,
    now: options.now
  })
  await provider.write(normalized, ctx, serializeRemoteDoc(nextDoc))
  return payload
}
