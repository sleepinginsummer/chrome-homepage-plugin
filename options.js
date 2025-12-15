const $ = (selector) => document.querySelector(selector)

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
  provider: $('#provider').value,
  owner: $('#owner').value.trim(),
  repo: $('#repo').value.trim(),
  branch: $('#branch').value.trim() || 'main',
  path: $('#path').value.trim() || 'chrome-home-plugin/config.json',
  token: $('#token').value.trim()
})

const setFormSync = (sync) => {
  $('#provider').value = sync.provider || 'github'
  $('#owner').value = sync.owner || ''
  $('#repo').value = sync.repo || ''
  $('#branch').value = sync.branch || 'main'
  $('#path').value = sync.path || 'chrome-home-plugin/config.json'
  $('#token').value = sync.token || ''
}

const disableActions = (disabled) => {
  for (const id of ['saveBtn', 'pushBtn', 'pullBtn', 'exportBtn']) {
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

