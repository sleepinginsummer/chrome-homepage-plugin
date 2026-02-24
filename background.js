import { DEFAULT_CONFIG, deepMerge, readConfig, writeConfig, writeLastSyncAt } from './config-store.js'
import { openTabs, openTabsInNewActive } from './tabs-ops.js'
import { computeConfigBeforePush, pullRemoteConfig, pushRemoteConfig, testRemoteConfig } from './remote-sync.js'

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[chrome-home] onInstalled:start')
  const config = await readConfig(chrome)
  await writeConfig(chrome, config)
  console.log('[chrome-home] onInstalled:done')
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[chrome-home] onMessage', message?.type)
  ;(async () => {
    if (message?.type === 'getConfig') {
      sendResponse({ ok: true, data: await readConfig(chrome) })
      return
    }
    if (message?.type === 'setConfig') {
      const current = await readConfig(chrome)
      const next = deepMerge(current, message.data || {})
      await writeConfig(chrome, next)
      sendResponse({ ok: true, data: next })
      return
    }
    if (message?.type === 'openTabs') {
      // 重要逻辑：background 分支优先复用 sender tab（如果能拿到）。
      const senderTabId = _sender?.tab?.id
      if (typeof senderTabId === 'number') {
        // 保持在当前标签页打开首个结果
        const list = Array.isArray(message.urls) ? message.urls.filter(Boolean) : []
        if (list.length) {
          const [first, ...rest] = list
          await chrome.tabs.update(senderTabId, { url: first, active: true })
          for (const url of rest) await chrome.tabs.create({ url, active: false })
        }
      } else {
        await openTabs(chrome, message.urls || [], { preferCurrentTab: true })
      }
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'openTabsInNewActive') {
      await openTabsInNewActive(chrome, message.urls || [])
      sendResponse({ ok: true })
      return
    }
    if (message?.type === 'pullRemote') {
      const config = await readConfig(chrome)
      const remote = await pullRemoteConfig(config.sync)
      const merged = deepMerge(DEFAULT_CONFIG, remote)
      await writeConfig(chrome, merged)
      const lastSyncAt = await writeLastSyncAt(chrome)
      sendResponse({ ok: true, data: merged, lastSyncAt })
      return
    }
    if (message?.type === 'pushRemote') {
      const config = await readConfig(chrome)
      const nextConfig = await computeConfigBeforePush({
        sync: config.sync,
        localConfig: config,
        deepMerge,
        defaultConfig: DEFAULT_CONFIG
      })
      await writeConfig(chrome, nextConfig)
      await pushRemoteConfig(nextConfig.sync, nextConfig)
      const lastSyncAt = await writeLastSyncAt(chrome)
      sendResponse({ ok: true, lastSyncAt })
      return
    }
    if (message?.type === 'testRemote') {
      const config = await readConfig(chrome)
      await testRemoteConfig(config.sync)
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: '未知消息类型' })
  })().catch((err) => {
    console.error('[chrome-home] onMessage:error', err)
    sendResponse({ ok: false, error: err?.message || String(err) })
  })
  return true
})
