/**
 * @fileoverview
 * tabs 操作的本地实现（用于 message 兜底）。
 *
 * 注意：
 * - 这里只封装扩展内部使用的两类“打开多标签页”逻辑。
 * - urls 会做过滤，避免空字符串导致异常。
 */

/**
 * 按需使用当前标签页打开首个地址，其余在后台打开。
 */
export const openTabs = async (chromeApi, urls, { preferCurrentTab = true } = {}) => {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : []
  if (!list.length) return

  const [first, ...rest] = list

  if (preferCurrentTab) {
    // 重要逻辑：在 newtab 中优先复用当前标签页，避免“开太多 tab”。
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true })
    const activeTabId = tabs?.[0]?.id
    if (typeof activeTabId === 'number') {
      await chromeApi.tabs.update(activeTabId, { url: first, active: true })
    } else {
      await chromeApi.tabs.create({ url: first, active: true })
    }
  } else {
    await chromeApi.tabs.create({ url: first, active: true })
  }

  for (const url of rest) {
    await chromeApi.tabs.create({ url, active: false })
  }
}

/**
 * 总是新开标签页打开首个地址并切换，其余在后台打开。
 */
export const openTabsInNewActive = async (chromeApi, urls) => {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : []
  if (!list.length) return

  const [first, ...rest] = list
  await chromeApi.tabs.create({ url: first, active: true })

  for (const url of rest) {
    await chromeApi.tabs.create({ url, active: false })
  }
}

