const defaultNormalizeKey = (key) => String(key || '').trim()

const defaultIsRetryableError = (error) => {
  const status = Number(error?.status)
  return error?.retryable !== false && (!status || status === 408 || status === 429 || status >= 500)
}

/**
 * 创建带缓存的请求客户端，统一处理超时、重试、并发复用及内存/持久缓存生命周期。
 */
export const createCachedRequestClient = ({
  loadOnce,
  normalizeKey = defaultNormalizeKey,
  isRetryableError = defaultIsRetryableError,
  persistentStore,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  now = Date.now,
  cacheTtlMs,
  timeoutMs,
  retryDelaysMs
}) => {
  if (typeof loadOnce !== 'function') throw new TypeError('loadOnce 必须是函数')

  const cache = new Map()
  const pendingRequests = new Map()
  const cacheVersions = new Map()
  const delay = (milliseconds) => new Promise((resolve) => setTimeoutFn(resolve, milliseconds))

  const readPersistentCache = async (key) => {
    if (!persistentStore) return null
    try {
      return await persistentStore.read(key)
    } catch (error) {
      console.warn('[chrome-home] persistent cache read failed', error)
      return null
    }
  }

  const writePersistentCache = async (key, entry) => {
    if (!persistentStore) return
    try {
      await persistentStore.write(key, entry)
    } catch (error) {
      console.warn('[chrome-home] persistent cache write failed', error)
    }
  }

  const removePersistentCache = async (key) => {
    if (!persistentStore) return
    try {
      await persistentStore.remove(key)
    } catch (error) {
      console.warn('[chrome-home] persistent cache remove failed', error)
    }
  }

  const runOnce = async (key) => {
    const controller = new AbortController()
    const timer = setTimeoutFn(() => controller.abort(), timeoutMs)
    try {
      return await loadOnce(key, controller.signal)
    } finally {
      clearTimeoutFn(timer)
    }
  }

  const runWithRetry = async (key) => {
    let lastError
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        return await runOnce(key)
      } catch (error) {
        lastError = error
        const retryDelay = retryDelaysMs[attempt]
        if (retryDelay === undefined || !isRetryableError(error)) throw error
        await delay(retryDelay)
      }
    }
    throw lastError
  }

  const load = (rawKey, { forceRefresh = false, fallbackToStale = true } = {}) => {
    const key = normalizeKey(rawKey)
    if (!key) return Promise.reject(new Error('请求键不能为空'))

    const cached = cache.get(key)
    if (!forceRefresh && cached && now() - cached.ts < cacheTtlMs) {
      return Promise.resolve(cached.data)
    }

    const pending = pendingRequests.get(key)
    if (pending) return pending

    const cacheVersion = cacheVersions.get(key) || 0
    let request
    const executeRequest = async (persisted) => {
      if (
        !forceRefresh &&
        persisted?.data &&
        (cacheVersions.get(key) || 0) === cacheVersion &&
        now() - persisted.ts < cacheTtlMs
      ) {
        cache.set(key, persisted)
        return persisted.data
      }

      try {
        const data = await runWithRetry(key)
        if ((cacheVersions.get(key) || 0) === cacheVersion) {
          const entry = { ts: now(), data }
          cache.set(key, entry)
          await writePersistentCache(key, entry)
        }
        return data
      } catch (error) {
        const staleData = cached?.data ?? persisted?.data
        if (fallbackToStale && staleData !== undefined) return staleData
        throw error
      }
    }

    const startedRequest = persistentStore
      ? readPersistentCache(key).then(executeRequest)
      : executeRequest(null)
    request = startedRequest.finally(() => {
      if (pendingRequests.get(key) === request) pendingRequests.delete(key)
    })

    pendingRequests.set(key, request)
    return request
  }

  const invalidate = async (rawKey) => {
    const key = normalizeKey(rawKey)
    cache.delete(key)
    cacheVersions.set(key, (cacheVersions.get(key) || 0) + 1)
    await removePersistentCache(key)
  }

  return { load, invalidate }
}
