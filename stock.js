/**
 * @fileoverview
 * 股票行情数据层：代码规范化、腾讯行情接口地址、GBK 响应解析与带短时缓存的客户端。
 *
 * 注意：
 * - 这里不碰 DOM，也不读页面 i18n，纯数据与网络。
 * - 行情接口返回 GBK 编码文本，需要按 ArrayBuffer 解码。
 */

const DEFAULT_CACHE_TTL_MS = 60 * 1000
const DEFAULT_TIMEOUT_MS = 9000
const MAX_SYMBOLS = 20

/**
 * 安全转换数字。
 */
export const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 规范化股票代码输入：去空格、转大写、去重并限制数量。
 */
export const normalizeStockSymbolsInput = (raw) => {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw || '')
  const parts = text.split(/[\s,，;；]+/).map((it) => it.trim()).filter(Boolean)
  const seen = new Set()
  const result = []
  for (const item of parts) {
    const symbol = item.toUpperCase()
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    result.push(symbol)
    if (result.length >= MAX_SYMBOLS) break
  }
  return result
}

/**
 * 从卡片配置中提取股票代码列表。
 */
export const getStockSymbols = (card) => normalizeStockSymbolsInput(card?.symbols || [])

/**
 * 按编辑状态算出提交后的代码列表：选中列表条目则原地替换，否则插到最前。
 *
 * @param {string[]} symbols 现有代码。
 * @param {string|null} editingSymbol 正在替换的代码，新增时传 null。
 * @param {string} inputSymbol 输入框里的新代码。
 * @returns {string[]} 规范化后的代码列表。
 */
export const buildNextSymbols = (symbols, editingSymbol, inputSymbol) => {
  const next = [...(Array.isArray(symbols) ? symbols : [])]
  if (editingSymbol) {
    const index = next.findIndex((item) => item === editingSymbol)
    if (index !== -1) next[index] = inputSymbol
  } else if (!next.includes(inputSymbol)) {
    next.unshift(inputSymbol)
  }
  // 重要逻辑：再次规范化，避免重复代码与替换后残留脏数据。
  return normalizeStockSymbolsInput(next)
}

/**
 * 将用户输入的股票代码转为腾讯接口格式。
 */
export const formatTencentSymbol = (symbol) => {
  const raw = String(symbol || '').trim()
  if (!raw) return ''
  const upper = raw.toUpperCase()
  const pref = upper.match(/^(SH|SZ|BJ|HK|US)(.+)$/)
  if (pref) return `${pref[1].toLowerCase()}${pref[2]}`

  if (/^\d{6}$/.test(upper)) {
    if (upper.startsWith('6')) return `sh${upper}`
    if (upper.startsWith('0') || upper.startsWith('3')) return `sz${upper}`
    if (upper.startsWith('8') || upper.startsWith('4') || upper.startsWith('9')) return `bj${upper}`
  }

  if (/^[A-Z]{1,6}$/.test(upper)) return `us${upper}`

  return raw
}

/**
 * 构建股票行情接口地址（腾讯接口）。
 */
export const getStockApiUrl = (symbols) =>
  `https://qt.gtimg.cn/q=${symbols.map(formatTencentSymbol).filter(Boolean).join(',')}`

/**
 * 解析腾讯行情时间字段。
 */
export const parseTencentTime = (timeText) => {
  if (!timeText) return null
  const compactMatch = String(timeText).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (compactMatch) {
    const [, year, month, day, hour, minute, second] = compactMatch
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
    if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000)
  }
  const date = new Date(timeText)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor(date.getTime() / 1000)
}

/**
 * 解析腾讯股票接口返回的数据并按输入顺序对齐。
 */
export const parseStockApiData = (rawText, symbols) => {
  const list = String(rawText || '').split(';').map((it) => it.trim()).filter(Boolean)
  const map = new Map()

  for (const line of list) {
    const match = line.match(/^v_([^=]+)="([\s\S]*)"$/)
    if (!match) continue
    const rawCode = match[1]
    const fields = String(match[2] || '').split('~')
    const code = String(fields[2] || '').toUpperCase()
    const name = String(fields[1] || code || rawCode || '').trim()
    const price = toNumber(fields[3])
    const prevClose = toNumber(fields[4])
    const change = price !== null && prevClose !== null ? price - prevClose : null
    const changePercent = change !== null && prevClose ? (change / prevClose) * 100 : null
    const timeText = String(fields[30] || '').trim()
    const marketTime = parseTencentTime(timeText)
    const currency = String(rawCode || '').toLowerCase().startsWith('us') ? 'USD' : 'CNY'

    if (!code) continue
    map.set(code, {
      symbol: code,
      name: name || code,
      price,
      change,
      changePercent,
      currency,
      marketTime
    })
  }

  return symbols.map((symbol) => {
    const key = String(symbol || '').toUpperCase()
    return map.get(key) || { symbol: key, name: key, price: null, change: null, changePercent: null, currency: '', marketTime: null }
  })
}

/**
 * 获取文本并做超时控制（腾讯行情接口返回 GBK，需要按 ArrayBuffer 解码）。
 */
export const fetchGbkText = async (url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch } = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()
    const decoder = new TextDecoder('gbk')
    return decoder.decode(buffer)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 创建股票行情客户端：按卡片 id 做短时缓存，降低频繁刷新带来的请求压力。
 *
 * @param {object} [options]
 * @param {function} [options.fetchFn] fetch 实现，测试可注入。
 * @param {function(): number} [options.now] 当前时间戳。
 * @param {number} [options.cacheTtlMs] 缓存有效期。
 * @param {number} [options.timeoutMs] 单次请求超时。
 */
export const createStockClient = ({
  fetchFn = globalThis.fetch,
  now = Date.now,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  const cache = new Map()

  /**
   * 读取指定卡片的行情；命中缓存且未过期时直接返回缓存。
   */
  const load = async (cardId, symbols, { forceRefresh = false } = {}) => {
    const cached = cache.get(cardId)
    if (!forceRefresh && cached && now() - cached.ts < cacheTtlMs && Array.isArray(cached.items)) {
      return cached.items
    }

    const rawText = await fetchGbkText(getStockApiUrl(symbols), { timeoutMs, fetchFn })
    const items = parseStockApiData(rawText, symbols)
    cache.set(cardId, { ts: now(), items })
    return items
  }

  /**
   * 只读缓存：编辑弹窗展示行情时用，不触发请求。
   */
  const peek = (cardId) => cache.get(cardId)?.items || []

  const invalidate = (cardId) => {
    cache.delete(cardId)
  }

  return { load, peek, invalidate }
}
