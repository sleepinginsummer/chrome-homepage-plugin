import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExtensionApiClient } from '../extension-api.js'

import { createChromeStub, createLockManager } from './helpers/chrome-stub.js'

/**
 * 构造一个「service worker 失活」的 chrome stub：sendMessage 永不回调，
 * 用来验证超时后的兜底策略与重试次数。
 */
const createSilentSendChrome = () => {
  const chromeApi = createChromeStub()
  chromeApi.runtime.sendMessage = vi.fn(() => {})
  return chromeApi
}

describe('extension api client timeout policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { locks: createLockManager() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('falls back locally right after the short timeout for config messages', async () => {
    const chromeApi = createSilentSendChrome()
    const client = createExtensionApiClient({ chromeApi, timeoutMs: 1000, fastTimeoutMs: 120 })

    const pending = client.send({ type: 'getConfig' })
    await vi.advanceTimersByTimeAsync(150)
    const res = await pending

    expect(res.ok).toBe(true)
    expect(res.data.engines.length).toBeGreaterThan(0)
    // 重要断言：本地读写类消息超时后不再重试，否则用户要多等一整个超时窗口。
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('still retries once for messages that need the background worker', async () => {
    const chromeApi = createSilentSendChrome()
    const client = createExtensionApiClient({ chromeApi, timeoutMs: 100 })

    const pending = client.send({ type: 'testRemote' })
    await vi.advanceTimersByTimeAsync(100 + 50 + 100 + 50)
    await pending

    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2)
  })
})
