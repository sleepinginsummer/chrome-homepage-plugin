/**
 * 构造最小可用的 chrome API stub（仅覆盖本地兜底需要的 storage/tabs/runtime）。
 *
 * storage.get 支持字符串/数组/对象/空参四种形式，并补上 remove，
 * 因为 chrome.storage.sync 同步源按分片读写，需要一次性取多个 key。
 */
export const createChromeStub = () => {
  const syncStore = new Map()
  const localStore = new Map()
  const calls = {
    tabsQuery: 0,
    tabsUpdate: [],
    tabsCreate: []
  }

  /**
   * 按 Chrome 的语义挑出要返回的 key。
   *
   * @param {string[]|string|object|null} keys 请求的 key。
   * @param {Map} store 存储。
   * @returns {object} 结果对象。
   */
  const pick = (keys, store) => {
    if (keys === null || keys === undefined) return Object.fromEntries(store)
    if (typeof keys === 'string') return { [keys]: store.get(keys) }
    if (Array.isArray(keys)) {
      const out = {}
      for (const key of keys) if (store.has(key)) out[key] = store.get(key)
      return out
    }
    const out = {}
    for (const [key, fallback] of Object.entries(keys)) out[key] = store.has(key) ? store.get(key) : fallback
    return out
  }

  const chromeApi = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (listener) => { chromeApi.__onMessage = listener } }
    },
    storage: {
      sync: {
        get: (keys, cb) => cb(pick(keys, syncStore)),
        set: (data, cb) => {
          for (const [k, v] of Object.entries(data || {})) syncStore.set(k, v)
          cb?.()
        },
        remove: (keys, cb) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) syncStore.delete(key)
          cb?.()
        }
      },
      local: {
        get: (keys, cb) => cb(pick(keys, localStore)),
        set: (data, cb) => {
          for (const [k, v] of Object.entries(data || {})) localStore.set(k, v)
          cb?.()
        },
        remove: (keys, cb) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) localStore.delete(key)
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
