import { describe, expect, it } from 'vitest'
import { handleMessageLocally } from '../extension-api.js'
import { STORAGE_KEY } from '../config-store.js'

/**
 * 构造最小可用的 chrome API stub（仅覆盖本地兜底需要的 storage/tabs/runtime）。
 */
const createChromeStub = () => {
  const syncStore = new Map()
  const localStore = new Map()
  const calls = {
    tabsQuery: 0,
    tabsUpdate: [],
    tabsCreate: []
  }

  const chromeApi = {
    runtime: {
      lastError: null
    },
    storage: {
      sync: {
        get: (keys, cb) => {
          const key = Array.isArray(keys) ? keys[0] : keys
          cb({ [key]: syncStore.get(key) })
        },
        set: (data, cb) => {
          for (const [k, v] of Object.entries(data || {})) syncStore.set(k, v)
          cb?.()
        }
      },
      local: {
        get: (keys, cb) => {
          const key = Array.isArray(keys) ? keys[0] : keys
          cb({ [key]: localStore.get(key) })
        },
        set: (data, cb) => {
          for (const [k, v] of Object.entries(data || {})) localStore.set(k, v)
          cb?.()
        }
      }
    },
    tabs: {
      query: async () => {
        calls.tabsQuery += 1
        return [{ id: 123 }]
      },
      update: async (tabId, updateProperties) => {
        calls.tabsUpdate.push({ tabId, updateProperties })
      },
      create: async (createProperties) => {
        calls.tabsCreate.push(createProperties)
      }
    },
    __stores: { syncStore, localStore },
    __calls: calls
  }

  return chromeApi
}

describe('extension api local fallback', () => {
  it('getConfig always returns merged default config with engines', async () => {
    const chromeApi = createChromeStub()
    // 不写入任何配置，模拟首次安装/空配置
    const res = await handleMessageLocally(chromeApi, { type: 'getConfig' })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.data.engines)).toBe(true)
    expect(res.data.engines.length).toBeGreaterThan(0)
  })

  it('setConfig deep merges and persists config', async () => {
    const chromeApi = createChromeStub()

    const saved = await handleMessageLocally(chromeApi, { type: 'setConfig', data: { ui: { language: 'en' } } })
    expect(saved.ok).toBe(true)
    expect(saved.data.ui.language).toBe('en')

    // 再读一次，验证确实持久化且 engines 不丢
    const loaded = await handleMessageLocally(chromeApi, { type: 'getConfig' })
    expect(loaded.ok).toBe(true)
    expect(loaded.data.ui.language).toBe('en')
    expect(Array.isArray(loaded.data.engines)).toBe(true)

    // 配置应写入 local，sync 仅保留给旧配置迁移。
    expect(chromeApi.__stores.localStore.has(STORAGE_KEY)).toBe(true)
    expect(chromeApi.__stores.syncStore.has(STORAGE_KEY)).toBe(false)
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

