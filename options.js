import { createExtensionApiClient } from './extension-api.js'
import { initThemeController } from './theme-controller.js'
import {
  applyProviderVisibility,
  clearRemoteSearchHistory,
  sendManualSync,
  readSyncForm,
  renderSnapshotList,
  requestProviderPermission,
  writeSyncForm
} from './sync-form.js'
import { applyTranslations, getDict } from './i18n.js'

const $ = (selector) => document.querySelector(selector)

/**
 * 选项页持有的配置副本。
 * 注意：这一行在 8b0660f 收敛同步规则时被误删过（当时和它相邻的 DEFAULT_SYNC_PATH 一起被当副本删掉），
 * 导致整页 main() 抛 ReferenceError、主题与同步表单全废——tests/options-module.test.js 现在会守住它。
 */
let currentConfig = null

const setStatus = (text, kind = 'info') => {
  const el = $('#status')
  el.textContent = text || ''
  el.dataset.kind = kind
}

/**
 * 扩展内部消息发送封装：
 * - 优先走 background/service worker
 * - 若短暂离线导致 “Receiving end does not exist”，自动切换到本地兜底（storage/tabs/fetch）
 */
let fallbackTipTimer = null
const apiClient = createExtensionApiClient({
  chromeApi: chrome,
  onFallback: (reason) => {
    setStatus(`后台暂不可用，已切换本地模式（${reason}）`, 'info')
    if (fallbackTipTimer) clearTimeout(fallbackTipTimer)
    fallbackTipTimer = setTimeout(() => setStatus(''), 3000)
  }
})
const send = (payload) => apiClient.send(payload)

const getFormSync = () => readSyncForm($)
const setFormSync = (sync) => writeSyncForm($, sync)
const getLang = () => (currentConfig?.ui?.language === 'en' ? 'en' : 'zh')

/**
 * 动作前确保同步域名已授权。
 *
 * 必须在点击处理器的最前面调用：chrome.permissions.request 依赖用户手势，
 * 前面插一个 await 就可能被浏览器拒绝弹窗。
 *
 * @returns {Promise<boolean>} 是否拿到权限。
 */
const ensurePermission = async () => {
  const granted = await requestProviderPermission(chrome, getFormSync())
  if (!granted) setStatus('需要授权访问同步服务商域名，已取消本次操作', 'error')
  return granted
}

const disableActions = (disabled) => {
  for (const id of ['saveBtn', 'pushBtn', 'pullBtn', 'testBtn', 'exportBtn', 'refreshBackupsBtn', 'clearRemoteHistoryBtn']) {
    const el = $(`#${id}`)
    if (el) el.disabled = disabled
  }
  const importFile = $('#importFile')
  if (importFile) importFile.disabled = disabled
}

const downloadJson = (filename, obj) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=UTF-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * 刷新备份版本列表。
 *
 * 远端无配置（首次使用）不是错误：此时列表为空，提示"还没有历史版本"。
 */
const refreshBackups = async ({ silent = false } = {}) => {
  if (!silent) setStatus('读取备份版本...')
  const state = await send({ type: 'readRemoteState' })
  if (!state?.ok || !state.data) {
    // 静默刷新用于首屏：此时没配好同步是常态，把报错写上去会盖住加载结果。
    if (!silent) setStatus(state?.error || '读取备份版本失败', 'error')
    return
  }
  renderSnapshotList({
    $,
    state: state.data,
    lang: getLang(),
    onRestore: (at) => void restoreBackup(at),
    setText: setStatus
  })
  if (!silent) setStatus('已读取备份版本')
}

/**
 * 回滚到指定备份版本。
 *
 * @param {string} at 快照时间戳。
 */
const restoreBackup = async (at) => {
  if (!at) return
  const confirmed = window.confirm('回滚会用该备份覆盖远端当前配置，并保留回滚前的状态。继续？')
  if (!confirmed) return

  disableActions(true)
  setStatus('回滚中...')
  const restored = await send({ type: 'restoreRemote', at })
  disableActions(false)
  if (!restored?.ok) {
    setStatus(restored?.error || '回滚失败', 'error')
    return
  }
  currentConfig = restored.data
  applyConfigToPage()
  setStatus('已回滚到该备份版本', 'ok')
  await refreshBackups({ silent: true })
}

/**
 * 配置变更后刷新主题与表单（拉取、导入、回滚都走这里）。
 */
let themeControllerRef = null
const applyConfigToPage = () => {
  themeControllerRef?.applyCurrent()
  setFormSync(currentConfig?.sync || {})
  applyTranslations({ lang: getLang() })
}

const main = async () => {
  const res = await send({ type: 'getConfig' })
  if (!res?.ok) {
    setStatus(res?.error || '读取配置失败', 'error')
    return
  }
  currentConfig = res.data

  // 主题面板的 UI 绑定、持久化与跨页面同步统一交给 theme-controller。
  const themeController = initThemeController({
    chromeApi: chrome,
    getConfig: () => currentConfig,
    saveTheme: async (theme) => {
      const saved = await send({
        type: 'setConfig',
        data: { ui: { ...(currentConfig.ui || {}), theme } }
      })
      if (!saved?.ok) throw new Error(saved?.error || '保存主题失败')
      currentConfig = saved.data
    },
    onConfigChange: (_theme, nextConfig) => {
      currentConfig = nextConfig
    }
  })
  themeControllerRef = themeController
  themeController.applyCurrent()
  applyTranslations({ lang: getLang() })
  setFormSync(res.data.sync || {})
  setStatus('已加载当前配置')

  // 切换服务商时立即切换字段，无需先保存。
  $('#syncProvider')?.addEventListener('change', (evt) => {
    applyProviderVisibility($, evt.target.value)
  })

  $('#saveBtn').addEventListener('click', async () => {
    if (!(await ensurePermission())) return
    disableActions(true)
    setStatus('保存中...')
    const sync = getFormSync()
    const saved = await send({ type: 'setConfig', data: { sync } })
    disableActions(false)
    if (!saved?.ok) {
      setStatus(saved?.error || '保存失败', 'error')
      return
    }
    currentConfig = saved.data
    setStatus('已保存', 'ok')
  })

  $('#pushBtn').addEventListener('click', async () => {
    if (!(await ensurePermission())) return
    disableActions(true)
    setStatus('推送中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pushed = await sendManualSync(send, 'pushRemote', () => window.confirm(getDict(getLang()).sync_confirm_push))
    disableActions(false)
    if (!pushed?.ok) {
      setStatus(pushed?.error || '推送失败', 'error')
      return
    }
    setStatus(pushed.accountStorage ? getDict(getLang()).sync_account_saved : '推送成功', 'ok')
    await refreshBackups({ silent: true })
  })

  $('#pullBtn').addEventListener('click', async () => {
    if (!(await ensurePermission())) return
    disableActions(true)
    setStatus('拉取中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pulled = await sendManualSync(send, 'pullRemote', () => window.confirm(getDict(getLang()).sync_confirm_pull))
    disableActions(false)
    if (!pulled?.ok) {
      setStatus(pulled?.error || '拉取失败', 'error')
      return
    }
    currentConfig = pulled.data
    applyConfigToPage()
    setStatus('拉取成功，已写入本地配置', 'ok')
  })

  // 与新标签页一致，历史分区切换后立即保存，避免继续自动上传。
  $('#syncSectionHistory')?.addEventListener('change', async (event) => {
    const input = event.target
    const saved = await send({ type: 'setConfig', data: { sync: { sections: { history: input.checked } } } })
    if (saved?.ok) currentConfig = saved.data
    else {
      input.checked = Boolean(currentConfig?.sync?.sections?.history)
      setStatus(saved?.error || '保存失败', 'error')
    }
  })

  $('#clearRemoteHistoryBtn')?.addEventListener('click', async () => {
    const dict = getDict(getLang())
    const sync = getFormSync()
    if (sync.sections.history) return setStatus(dict.sync_clear_remote_history_disabled, 'error')
    if (!window.confirm(dict.sync_clear_remote_history_confirm) || !(await ensurePermission())) return
    disableActions(true)
    try {
      setStatus(dict.sync_clear_remote_history)
      const result = await clearRemoteSearchHistory(send, sync)
      if (!result?.ok) return setStatus(result?.error || '清除失败', 'error')
      setStatus(dict.sync_clear_remote_history_done, 'ok')
      await refreshBackups({ silent: true })
    } finally {
      disableActions(false)
    }
  })
  $('#testBtn').addEventListener('click', async () => {
    if (!(await ensurePermission())) return
    disableActions(true)
    setStatus('测试中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const tested = await send({ type: 'testRemote' })
    disableActions(false)
    if (!tested?.ok) {
      setStatus(tested?.error || '测试失败', 'error')
      return
    }
    setStatus('连接正常', 'ok')
  })

  $('#refreshBackupsBtn')?.addEventListener('click', async () => {
    if (!(await ensurePermission())) return
    disableActions(true)
    await refreshBackups()
    disableActions(false)
  })

  $('#exportBtn').addEventListener('click', async () => {
    disableActions(true)
    setStatus('导出中...')
    const current = await send({ type: 'getConfig' })
    disableActions(false)
    if (!current?.ok) {
      setStatus(current?.error || '导出失败', 'error')
      return
    }
    downloadJson('chrome-home-plugin-config.json', current.data)
    setStatus('已导出', 'ok')
  })

  $('#importFile').addEventListener('change', async (evt) => {
    const file = evt.target.files?.[0]
    if (!file) return
    disableActions(true)
    setStatus('导入中...')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const saved = await send({ type: 'setConfig', data: json })
      if (!saved?.ok) throw new Error(saved?.error || '写入失败')
      currentConfig = saved.data
      applyConfigToPage()
      setStatus('导入成功', 'ok')
    } catch (err) {
      setStatus(err?.message || String(err), 'error')
    } finally {
      evt.target.value = ''
      disableActions(false)
    }
  })

  // 首次进入静默读一次备份列表：没配同步时失败提示会盖住"已加载当前配置"，所以只在不报错时更新。
  void refreshBackups({ silent: true })
}

main().catch((err) => setStatus(err?.message || String(err), 'error'))
