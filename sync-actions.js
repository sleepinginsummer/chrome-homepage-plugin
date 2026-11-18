import { commitSyncState, readSyncDevice, readSyncState } from './config-store.js'
import {
  assertRemoteConfigMatches,
  computeConfigHash,
  isSyncConfigured,
  pushRemoteConfigAndVerify,
  readRemoteDocument,
  pullRemoteState,
  restoreRemoteSnapshot,
  testRemoteConfig,
  validateSyncConfig
} from './remote-sync.js'
import { buildRemotePayload, parseRemoteDoc, serializeRemoteDoc } from './sync-remote-doc.js'
import { resolveFilename } from './sync-providers.js'

const syncTypes = new Set([
  'pullRemote', 'pushRemote', 'autoSync', 'testRemote', 'readRemoteState', 'restoreRemote', 'clearRemoteHistory'
])
export const isSyncMessage = (message) => syncTypes.has(message?.type)

const targetKey = (sync) => JSON.stringify([
  sync.provider,
  sync.provider === 'webdav'
    ? [sync.webdavUrl.trim().replace(/\/+$/, ''), sync.username]
    : sync.gistId,
  sync.provider === 'storage_sync' ? '' : resolveFilename(sync)
])

const conflict = (remoteVersion) => ({
  ok: false,
  code: 'SYNC_CONFLICT',
  remoteVersion,
  error: '本机与远端版本冲突，已保留本机改动。请在同步设置中选择推送本机版本或拉取远端版本。'
})

/** 原地移除历史，不生成包含被清除数据的新快照。 */
const withoutHistory = (doc) => {
  const omit = (payload) => {
    if (!payload || typeof payload !== 'object') return payload
    const { searchHistory: _history, ...remaining } = payload
    return remaining
  }
  return {
    ...doc,
    schemaVersion: 1,
    payload: omit(doc.payload),
    snapshots: doc.snapshots.map((item) => item?.payload ? { ...item, payload: omit(item.payload) } : item)
  }
}

const execute = async (chromeApi, message) => {
  const { type } = message
  const started = await readSyncState(chromeApi)
  const { config, revision } = started
  const ctx = { chromeApi }
  if (type === 'testRemote') {
    await testRemoteConfig(config.sync, ctx)
    return { ok: true }
  }
  if (type === 'readRemoteState') return { ok: true, data: await pullRemoteState(config.sync, ctx) }
  if (type === 'autoSync' && (!config.sync.autoPush || !isSyncConfigured(config.sync))) {
    return { ok: true, skipped: true }
  }

  const source = await readRemoteDocument(config.sync, ctx)
  const { doc, provider, sync } = source
  const target = targetKey(sync)
  const accountStorage = sync.provider === 'storage_sync'
  const remoteHash = doc ? await computeConfigHash(doc.payload) : ''
  const baseline = !started.target || started.target === target ? started.baseline : ''
  const commit = async (state) => ({ ...await commitSyncState(chromeApi, started, { target, ...state }), accountStorage })
  const ensureSameSettings = async () => {
    const latest = await readSyncState(chromeApi)
    if (await computeConfigHash(latest.config.sync) !== await computeConfigHash(config.sync)) {
      throw new Error('同步设置已变更，请重试')
    }
  }

  if (type === 'clearRemoteHistory') {
    if (!message.sync || targetKey(validateSyncConfig(message.sync)) !== target) {
      throw new Error('同步目标已变更，请重新确认后再清除')
    }
    if (sync.sections.history) throw new Error('请先关闭搜索历史同步')
    if (!doc) return { ok: true, accountStorage }
    const cleaned = withoutHistory(doc)
    if (await computeConfigHash(doc) !== await computeConfigHash(cleaned)) {
      await ensureSameSettings()
      await provider.write(sync, source.ctx, serializeRemoteDoc(cleaned))
      const readBack = parseRemoteDoc(await provider.read(sync, ctx))
      await assertRemoteConfigMatches({ expectedConfig: cleaned, actualConfig: readBack })
    }
    // 清理历史不是配置上传，保留待上传状态。只推进已确认过的远端基线。
    if (baseline === remoteHash) return commit({ baseline: await computeConfigHash(cleaned.payload), keepPending: true })
    return { ok: true, accountStorage }
  }

  if (type === 'restoreRemote') {
    const at = typeof message.at === 'string' ? message.at : ''
    if (!at) throw new Error('缺少要回滚的备份时间')
    const device = await readSyncDevice(chromeApi)
    await ensureSameSettings()
    const payload = await restoreRemoteSnapshot(config.sync, at, { ...ctx, device, source })
    return commit({ baseline: await computeConfigHash(payload), remote: payload })
  }

  if (type === 'pullRemote' || (type === 'autoSync' && !revision)) {
    if (!doc) {
      if (type === 'autoSync') return { ok: true, skipped: true }
      throw new Error('远端还没有配置文件，请先推送一次')
    }
    if (type === 'autoSync' && baseline === remoteHash && started.target === target) return { ok: true, skipped: true }
    if (type === 'pullRemote' && revision) {
      const remoteVersion = await computeConfigHash({ target, doc, revision })
      if (message.confirmedVersion !== remoteVersion) return conflict(remoteVersion)
    }
    return { ...await commit({ baseline: remoteHash, remote: doc.payload }), pulled: true }
  }

  const localPayload = buildRemotePayload(config, sync.sections)
  if (doc && await computeConfigHash(localPayload) === remoteHash) return commit({ baseline: remoteHash })
  if (remoteHash !== baseline) {
    // 只有手动确认，且目标和远端内容与确认时一致，才允许覆盖冲突版本。
    const remoteVersion = await computeConfigHash({ target, doc })
    if (type !== 'pushRemote' || message.confirmedVersion !== remoteVersion) return conflict(remoteVersion)
  }
  const device = await readSyncDevice(chromeApi)
  await ensureSameSettings()
  const verified = await pushRemoteConfigAndVerify(sync, config, { ...ctx, device, source })
  return commit({ baseline: await computeConfigHash(verified) })
}

// 同一浏览器的页面、后台及本地兜底共享同步锁；配置编辑使用独立的锁，不等网络。
export const handleSyncMessage = (chromeApi, message) =>
  navigator.locks.request('chrome-home-remote-sync', () => execute(chromeApi, message))
