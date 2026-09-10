import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMessageLocally } from '../extension-api.js'
import { DEFAULT_THEME, STORAGE_KEY } from '../config-store.js'

import { createChromeStub, createLockManager } from './helpers/chrome-stub.js'

describe('extension api local fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { locks: createLockManager() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getConfig always returns merged default config with engines', async () => {
    const chromeApi = createChromeStub()
    // 不写入任何配置，模拟首次安装/空配置
    const res = await handleMessageLocally(chromeApi, { type: 'getConfig' })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.data.engines)).toBe(true)
    expect(res.data.engines.length).toBeGreaterThan(0)
    expect(res.data.ui.theme).toBe(DEFAULT_THEME)
  })

  it('deep merges legacy ui config with the default theme', async () => {
    const chromeApi = createChromeStub()
    chromeApi.__stores.localStore.set(STORAGE_KEY, { ui: { language: 'en' } })

    const loaded = await handleMessageLocally(chromeApi, { type: 'getConfig' })

    expect(loaded.data.ui).toEqual({ language: 'en', theme: DEFAULT_THEME })
    expect(loaded.data.engines.length).toBeGreaterThan(0)
  })

  it('setConfig deep merges and persists language with theme', async () => {
    const chromeApi = createChromeStub()

    const saved = await handleMessageLocally(chromeApi, {
      type: 'setConfig',
      data: { ui: { language: 'en', theme: 'neo-brutalism' } }
    })
    expect(saved.ok).toBe(true)
    expect(saved.data.ui.language).toBe('en')
    expect(saved.data.ui.theme).toBe('neo-brutalism')

    // 再读一次，验证确实持久化且 engines 不丢
    const loaded = await handleMessageLocally(chromeApi, { type: 'getConfig' })
    expect(loaded.ok).toBe(true)
    expect(loaded.data.ui.language).toBe('en')
    expect(loaded.data.ui.theme).toBe('neo-brutalism')
    expect(Array.isArray(loaded.data.engines)).toBe(true)

    // 配置应写入 local，sync 仅保留给旧配置迁移。
    expect(chromeApi.__stores.localStore.has(STORAGE_KEY)).toBe(true)
    expect(chromeApi.__stores.syncStore.has(STORAGE_KEY)).toBe(false)
  })

  it('normalizes an invalid persisted theme to cyber dark', async () => {
    const chromeApi = createChromeStub()

    const saved = await handleMessageLocally(chromeApi, {
      type: 'setConfig',
      data: { ui: { theme: 'unknown-theme' } }
    })

    expect(saved.data.ui.theme).toBe(DEFAULT_THEME)
    expect(chromeApi.__stores.localStore.get(STORAGE_KEY).ui.theme).toBe(DEFAULT_THEME)
  })

  it('persists the theme received from a remote pull', async () => {
    const chromeApi = createChromeStub()
    await handleMessageLocally(chromeApi, {
      type: 'setConfig',
      data: {
        sync: {
          gitUrl: 'https://gitee.com/example/codes/theme-config',
          token: 'token'
        }
      }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        files: {
          'config.json': {
            content: JSON.stringify({ ui: { language: 'zh', theme: 'neo-brutalism' } })
          }
        }
      })
    }))

    const pulled = await handleMessageLocally(chromeApi, { type: 'pullRemote' })

    expect(pulled.ok).toBe(true)
    expect(pulled.data.ui.theme).toBe('neo-brutalism')
    expect(chromeApi.__stores.localStore.get(STORAGE_KEY).ui.theme).toBe('neo-brutalism')
  })

  it('openTabs uses current tab for first url and creates background tabs for the rest', async () => {
    const chromeApi = createChromeStub()

    const res = await handleMessageLocally(chromeApi, {
      type: 'openTabs',
      urls: ['', 'https://a.com', 'https://b.com']
    })
    expect(res.ok).toBe(true)

    // 重要断言：第一个有效 url 用 update(currentTab) 打开
    expect(chromeApi.__calls.tabsUpdate.length).toBe(1)
    expect(chromeApi.__calls.tabsUpdate[0].tabId).toBe(123)
    expect(chromeApi.__calls.tabsUpdate[0].updateProperties.url).toBe('https://a.com')

    // 其余 url 在后台新开
    expect(chromeApi.__calls.tabsCreate.length).toBe(1)
    expect(chromeApi.__calls.tabsCreate[0].url).toBe('https://b.com')
    expect(chromeApi.__calls.tabsCreate[0].active).toBe(false)
  })
})
