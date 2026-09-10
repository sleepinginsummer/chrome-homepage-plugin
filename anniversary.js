/**
 * @fileoverview
 * 纪念日日期计算：解析、闰年兜底、下一个纪念日与排序。
 *
 * 注意：
 * - 纯逻辑，不碰 DOM 与页面状态；`now` 可注入，便于测试跨年/闰年等边界。
 * - 所有比较都在「当天正午」进行，避开时区与夏令时导致的跨天误差。
 */

/** 闰年判断。 */
export const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/**
 * 构造当天正午的日期；2 月 29 日在非闰年回落到 2 月 28 日。
 */
export const createSafeDateAtNoon = (year, monthIndex, day) => {
  if (monthIndex === 1 && day === 29 && !isLeapYear(year)) {
    return new Date(year, monthIndex, 28, 12, 0, 0, 0)
  }
  return new Date(year, monthIndex, day, 12, 0, 0, 0)
}

/**
 * 解析 `YYYY-MM-DD`，非法日期（含 2 月 30 日这类越界值）返回 null。
 */
export const parseYmd = (ymd) => {
  const raw = String(ymd || '').trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const probe = new Date(year, month - 1, day)
  if (Number.isNaN(probe.getTime())) return null
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null
  return { year, month, day }
}

/** 格式化为「x月x日」。 */
export const formatMonthDay = ({ month, day }) => `${month}月${day}日`

/**
 * 计算距离下一个纪念日的天数与周年数。
 *
 * @param {string} ymd 起始日期 `YYYY-MM-DD`。
 * @param {Date} [now] 参考时间，默认当前时间。
 * @returns {{days: number, years: number, month: number, day: number}|null} 日期非法时返回 null。
 */
export const calcNextAnniversary = (ymd, now = new Date()) => {
  const parsed = parseYmd(ymd)
  if (!parsed) return null
  const nowNoon = createSafeDateAtNoon(now.getFullYear(), now.getMonth(), now.getDate())
  const thisYear = nowNoon.getFullYear()
  let nextYear = thisYear
  let occurrence = createSafeDateAtNoon(thisYear, parsed.month - 1, parsed.day)
  if (occurrence.getTime() < nowNoon.getTime()) {
    nextYear = thisYear + 1
    occurrence = createSafeDateAtNoon(nextYear, parsed.month - 1, parsed.day)
  }
  const days = Math.max(0, Math.round((occurrence.getTime() - nowNoon.getTime()) / 86400000))
  const years = Math.max(0, nextYear - parsed.year)
  return {
    days,
    years,
    month: parsed.month,
    day: parsed.day
  }
}

/**
 * 按「下一个纪念日」升序排列；日期非法的条目排到最后，再按标题排序保证稳定。
 */
export const sortAnniversaryItems = (items, now = new Date()) => {
  const list = Array.isArray(items) ? items : []
  return [...list].sort((a, b) => {
    const da = calcNextAnniversary(a.date, now)
    const db = calcNextAnniversary(b.date, now)
    const aDays = da ? da.days : Number.POSITIVE_INFINITY
    const bDays = db ? db.days : Number.POSITIVE_INFINITY
    if (aDays !== bDays) return aDays - bDays
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}

/**
 * 按编辑状态算出提交后的条目列表：选中条目则替换，否则插到最前。
 *
 * @param {Array<object>} items 现有条目。
 * @param {string|null} editingItemId 正在编辑的条目 id，新增时传 null。
 * @param {{id: string, title: string, date: string}} nextItem 新条目内容。
 * @returns {{items: Array<object>, editingItemId: null}} 新列表与重置后的编辑态。
 */
export const buildNextItems = (items, editingItemId, nextItem) => {
  const next = Array.isArray(items) ? [...items] : []
  if (editingItemId) {
    const index = next.findIndex((item) => item.id === editingItemId)
    if (index !== -1) next[index] = { ...next[index], title: nextItem.title, date: nextItem.date }
  } else {
    next.unshift({ id: nextItem.id, title: nextItem.title, date: nextItem.date })
  }
  return { items: next, editingItemId: null }
}
