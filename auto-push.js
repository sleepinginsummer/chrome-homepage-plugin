/**
 * @fileoverview
 * 自动推送调度：配置变更后延迟推送远端，并保证同一时刻只有一次推送在跑。
 *
 * 设计目标：
 * - 只负责调度与状态回调，推送本身、状态提示和最近同步时间渲染都由页面注入。
 * - 配置不完整（各服务商必填项缺失）时不推送，只通过状态回调提示，避免静默失败。
 *
 * 注意：
 * - 推送进行中再次触发会记 pending，等当前这次结束后再补一次，避免丢变更。
 * - 延迟 1500ms 是为了把连续编辑（拖拽排序、连续勾选）合并成一次推送。
 */

const DEFAULT_DEBOUNCE_MS = 1500

/**
 * 判断自动推送的前置条件是否满足。
 *
 * 必填项由服务商决定（代码片段要地址+token，WebDAV 要地址+账号+密码，
 * chrome.storage.sync 零配置），因此这里只调用注入的就绪判断，不重复写规则。
 *
 * @param {object} sync 同步配置。
 * @param {function(object): boolean} [isReady] 同步配置就绪判断（页面传入）。
 * @returns {boolean} 是否可以自动推送。
 */
export const canAutoPush = (sync, isReady) => {
  if (!sync?.autoPush) return false
  if (typeof isReady !== 'function') return false
  return Boolean(isReady(sync))
}

/**
 * 创建自动推送调度器。
 *
 * @param {object} options
 * @param {function(): object} options.getConfig 读取当前配置。
 * @param {function(object): boolean} options.isSyncReady 同步配置就绪判断。
 * @param {function(object): Promise<{ok: boolean, error?: string, lastSyncAt?: string}>} options.pushRemote 执行推送。
 * @param {function(string, string=): void} [options.setStatus] 状态提示（文案, kind）。
 * @param {function(string=): void} [options.afterPush] 推送成功后的收尾（刷新最近同步时间）。
 * @param {number} [options.debounceMs] 延迟毫秒数。
 * @returns {{ schedule: function(): void, canAutoPush: function(object): boolean, isPushing: function(): boolean }}
 */
export const createAutoPush = ({
  getConfig,
  isSyncReady,
  pushRemote,
  setStatus,
  afterPush,
  onConflict,
  debounceMs = DEFAULT_DEBOUNCE_MS
}) => {
  let timer = null
  let inProgress = false
  let pending = false

  const canPush = (sync) => canAutoPush(sync, isSyncReady)

  const run = async () => {
    timer = null
    if (inProgress) {
      // 重要逻辑：推送进行中再来的变更先记下，结束后补一次。
      pending = true
      return
    }

    inProgress = true
    try {
      setStatus?.('自动同步中...')
      const pushed = await pushRemote({ type: 'autoSync' })
      if (!pushed?.ok) {
        setStatus?.(pushed?.error || '自动同步失败', 'error')
        if (pushed?.code === 'SYNC_CONFLICT') onConflict?.(pushed.error)
      } else {
        setStatus?.(pushed.skipped ? '' : pushed.accountStorage ? '已更新本机 Chrome 同步存储' : '已自动同步', 'ok')
        await afterPush?.(pushed?.lastSyncAt)
      }
    } finally {
      inProgress = false
      if (pending) {
        pending = false
        schedule()
      }
    }
  }

  const schedule = () => {
    const sync = getConfig()?.sync
    if (!canPush(sync)) {
      if (sync?.autoPush) {
        setStatus?.('自动同步已开启，但同步配置不完整', 'error')
      }
      return
    }

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), debounceMs)
  }

  return { schedule, canAutoPush: canPush, isPushing: () => inProgress }
}
