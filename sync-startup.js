import { isSyncConfigured } from './remote-sync.js'

export const isAutoSyncReady = (sync) => Boolean(sync?.autoPush) && isSyncConfigured(sync)

/** 启动只发一条消息，由后台根据持久化状态选择拉取或推送。 */
export const runStartupSync = async ({ sync, send, setStatus, renderLastSyncAt, applyConfig, onConflict }) => {
  if (!isAutoSyncReady(sync)) return { ok: false, skipped: true }
  setStatus?.('启动同步中...')
  const result = await send({ type: 'autoSync' })
  if (!result?.ok) {
    setStatus?.(result?.error || '启动同步失败', 'error')
    if (result?.code === 'SYNC_CONFLICT') onConflict?.(result.error)
    return { ok: false }
  }
  if (result.skipped) {
    setStatus?.('')
    return { ok: true, skipped: true }
  }
  if (result.pulled) applyConfig?.(result.data)
  setStatus?.(result.accountStorage ? '已更新本机 Chrome 同步存储' : '启动同步完成', 'ok')
  await renderLastSyncAt?.(result.lastSyncAt)
  return { ok: true }
}
