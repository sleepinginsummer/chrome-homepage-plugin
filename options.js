import { createExtensionApiClient } from './extension-api.js'
import { applyTheme, bindThemeRadioNavigation, getConfigTheme, persistThemeSelection, subscribeToThemeChanges } from './theme.js'

const $ = (selector) => document.querySelector(selector)

const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'
let currentConfig = null

const parseGitRemote = (gitUrl) => {
  const raw = String(gitUrl || '').trim()
  if (!raw) return null

  const giteeCodes = raw.match(/^https?:\/\/gitee\.com\/[^/]+\/codes\/([^/?#]+)(?:[/?#]|$)/i)
  if (giteeCodes) return { provider: 'gitee_gist', gistId: giteeCodes[1] }
  return null
}

const normalizeSync = (sync) => {
  const raw = sync || {}
  const parsed = parseGitRemote(raw.gitUrl)
  return {
    gitUrl: raw.gitUrl || '',
    token: raw.token || '',
    autoPush: Boolean(raw.autoPush),
    provider: 'gitee_gist',
    owner: '',
    repo: '',
    gistId: raw.gistId || parsed?.gistId || '',
    path: raw.path || DEFAULT_SYNC_PATH
  }
}

const setStatus = (text, kind = 'info') => {
  const el = $('#status')
  el.textContent = text || ''
  el.dataset.kind = kind
}

const setThemeStatus = (text, kind = 'info') => {
  const el = $('#themeStatus')
  el.textContent = text || ''
  el.dataset.kind = kind
}

const renderThemeSelection = (theme = getConfigTheme(currentConfig)) => {
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.checked = input.value === theme
    input.closest('.theme-option')?.classList.toggle('active', input.checked)
  }
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

const getFormSync = () => ({
  ...(() => {
    const gitUrl = $('#gitUrl').value.trim()
    const parsed = parseGitRemote(gitUrl)
    return {
      gitUrl,
      ...(parsed?.provider === 'gitee_gist'
        ? { provider: parsed.provider, gistId: parsed.gistId }
        : {})
    }
  })(),
  token: $('#token').value.trim(),
  autoPush: Boolean($('#autoPush')?.checked),
  path: DEFAULT_SYNC_PATH
})

const setFormSync = (sync) => {
  const normalized = normalizeSync(sync)
  $('#gitUrl').value = normalized.gitUrl || ''
  $('#token').value = normalized.token || ''
  const autoPush = $('#autoPush')
  if (autoPush) autoPush.checked = Boolean(normalized.autoPush)
}

const disableActions = (disabled) => {
  for (const id of ['saveBtn', 'pushBtn', 'pullBtn', 'testBtn', 'exportBtn']) {
    $(id.startsWith('#') ? id : `#${id}`).disabled = disabled
  }
  $('#importFile').disabled = disabled
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

const main = async () => {
  const res = await send({ type: 'getConfig' })
  if (!res?.ok) {
    setStatus(res?.error || '读取配置失败', 'error')
    return
  }
  currentConfig = res.data
  applyTheme(getConfigTheme(currentConfig))
  renderThemeSelection()
  setFormSync(res.data.sync || {})
  setStatus('已加载当前配置')

  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.addEventListener('change', async () => {
      if (!input.checked) return
      const result = await persistThemeSelection({
        currentTheme: getConfigTheme(currentConfig),
        nextTheme: input.value,
        saveTheme: async (theme) => {
          const saved = await send({
            type: 'setConfig',
            data: { ui: { ...(currentConfig.ui || {}), theme } }
          })
          if (!saved?.ok) throw new Error(saved?.error || '保存主题失败')
          currentConfig = saved.data
        }
      })
      renderThemeSelection(result.theme)
      setThemeStatus(result.ok ? '' : '主题保存失败，已恢复原主题', result.ok ? 'info' : 'error')
    })
  }
  bindThemeRadioNavigation()

  subscribeToThemeChanges(chrome, (theme, nextConfig) => {
    currentConfig = nextConfig
    applyTheme(theme)
    renderThemeSelection(theme)
  })

  $('#saveBtn').addEventListener('click', async () => {
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
    disableActions(true)
    setStatus('推送中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pushed = await send({ type: 'pushRemote' })
    disableActions(false)
    if (!pushed?.ok) {
      setStatus(pushed?.error || '推送失败', 'error')
      return
    }
    setStatus('推送成功', 'ok')
  })

  $('#pullBtn').addEventListener('click', async () => {
    disableActions(true)
    setStatus('拉取中...')
    await send({ type: 'setConfig', data: { sync: getFormSync() } })
    const pulled = await send({ type: 'pullRemote' })
    disableActions(false)
    if (!pulled?.ok) {
      setStatus(pulled?.error || '拉取失败', 'error')
      return
    }
    setFormSync(pulled.data.sync || {})
    currentConfig = pulled.data
    applyTheme(getConfigTheme(currentConfig))
    renderThemeSelection()
    setStatus('拉取成功，已写入本地配置', 'ok')
  })

  $('#testBtn').addEventListener('click', async () => {
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
      applyTheme(getConfigTheme(currentConfig))
      renderThemeSelection()
      setFormSync(saved.data.sync || {})
      setStatus('导入成功', 'ok')
    } catch (err) {
      setStatus(err?.message || String(err), 'error')
    } finally {
      evt.target.value = ''
      disableActions(false)
    }
  })
}

main().catch((err) => setStatus(err?.message || String(err), 'error'))
