/**
 * 判断启动时是否满足自动同步条件。
 */
export const isAutoSyncReady = (sync) => {
  if (!sync?.autoPush) return false
  const required = ['gitUrl', 'token']
  return required.every((key) => Boolean(sync?.[key]))
}

/**
 * 启动时执行一次同步（拉取 + 推送）。
 */
export const runStartupSync = async ({ sync, send, setStatus, renderLastSyncAt }) => {
  if (!isAutoSyncReady(sync)) return { ok: false, skipped: true }

  setStatus?.('启动同步中...')
  // 先拉取，再推送，保证远端覆盖冲突最小化。
  const pulled = await send({ type: 'pullRemote' })
  if (!pulled?.ok) {
    setStatus?.(pulled?.error || '启动同步拉取失败', 'error')
    return { ok: false, stage: 'pull' }
  }

  const pushed = await send({ type: 'pushRemote' })
  if (!pushed?.ok) {
    setStatus?.(pushed?.error || '启动同步推送失败', 'error')
    return { ok: false, stage: 'push' }
  }

  setStatus?.('启动同步完成', 'ok')
  await renderLastSyncAt?.(pushed?.lastSyncAt || pulled?.lastSyncAt)
  return { ok: true }
}
