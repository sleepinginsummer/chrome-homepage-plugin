const $ = (selector) => document.querySelector(selector)

const DEFAULT_SYNC_PATH = 'chrome-home-plugin/config.json'

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

const send = (payload) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => resolve(response))
  })

const setStatus = (text, kind = 'info') => {
  const el = $('#status')
  el.textContent = text || ''
  if (kind === 'error') el.style.color = '#ff4848'
  else if (kind === 'ok') el.style.color = '#00f2ff'
  else el.style.color = 'rgba(255,255,255,0.7)'
}

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
  setFormSync(res.data.sync || {})
  setStatus('已加载当前配置')

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
