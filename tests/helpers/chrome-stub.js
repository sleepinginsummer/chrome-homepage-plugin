/**
 * 构造最小可用的 chrome API stub（仅覆盖本地兜底需要的 storage/tabs/runtime）。
 */
export const createChromeStub = () => {
  const syncStore = new Map()
  const localStore = new Map()
  const calls = {
    tabsQuery: 0,
    tabsUpdate: [],
    tabsCreate: []
  }

  const chromeApi = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (listener) => { chromeApi.__onMessage = listener } }
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

/** Node 测试环境的同名独占锁，模拟 Chrome Web Locks 排队与异常释放。 */
export const createLockManager = () => {
  const queues = new Map()
  return {
    request: (name, callback) => {
      const result = (queues.get(name) || Promise.resolve()).then(callback)
      queues.set(name, result.catch(() => {}))
      return result
    }
  }
}
