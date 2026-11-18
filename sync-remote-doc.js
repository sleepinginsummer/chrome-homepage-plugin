/**
 * @fileoverview
 * 远端同步文档的格式与纯函数：信封、快照环、分区挑选。
 *
 * 设计目标：
 * - 远端只存一个 JSON 文档，四个 provider（Gitee/GitHub 代码片段、WebDAV、
 *   chrome.storage.sync）共用同一份格式，避免每接一个源就复制一套读写逻辑。
 * - 快照环内嵌在文档里，而不是"每个版本一个文件"：provider 接口因此只需
 *   read/write/test 三个方法，WebDAV 也不需要列目录。
 * - 分区开关决定哪些配置字段会离开本机，同步 token 永远不进 payload。
 *
 * 文档格式（schemaVersion 1）：
 * {
 *   schemaVersion: 1,
 *   updatedAt: '2026-10-04T12:00:00.000Z',
 *   device: { id, name },
 *   payload: { cards, engines, ... },          // 只含启用分区的字段
 *   snapshots: [{ at, device, payload }, ...]  // 新→旧，长度受限
 * }
 *
 * 兼容：
 * - 存量远端是裸 config（没有 schemaVersion/payload），按 schemaVersion 0 读取。
 * - 读取永远不抛"格式不认识"，只在 payload 不是对象时才拒。
 *
 * 注意：
 * - 本文件全部是纯函数，不碰 storage / fetch，便于直接单测。
 */

export const SYNC_SCHEMA_VERSION = 1
export const DEFAULT_SNAPSHOT_KEEP = 5
export const MIN_SNAPSHOT_KEEP = 1
export const MAX_SNAPSHOT_KEEP = 20

/**
 * 分区到配置字段的映射。
 *
 * 说明：`popupTipDismissed` 与 `sync` 故意不属于任何分区。
 * 前者是纯本机的提示状态，后者含 token，两者都不该离开本机。
 */
export const SYNC_SECTIONS = {
  cards: ['cards'],
  engines: ['engines', 'selectedEngines', 'rememberSelections'],
  ui: ['ui'],
  history: ['searchHistory']
}

/**
 * 默认分区：卡片/引擎/外观跟随同步，搜索历史留在本机（历史属于单台设备的使用痕迹）。
 */
export const DEFAULT_SYNC_SECTIONS = {
  cards: true,
  engines: true,
  ui: true,
  history: false
}

/**
 * 规范化分区开关：未知分区忽略，缺省取默认值。
 *
 * @param {object} sections 用户配置。
 * @returns {{cards: boolean, engines: boolean, ui: boolean, history: boolean}}
 */
export const normalizeSyncSections = (sections) => {
  const raw = sections && typeof sections === 'object' ? sections : {}
  const out = {}
  for (const key of Object.keys(SYNC_SECTIONS)) {
    out[key] = key in raw ? Boolean(raw[key]) : DEFAULT_SYNC_SECTIONS[key]
  }
  return out
}

/**
 * 从完整配置挑出要上远端的字段。
 *
 * @param {object} config 完整本地配置。
 * @param {object} sections 分区开关。
 * @returns {object} 只含启用分区字段的对象。
 */
export const buildRemotePayload = (config, sections) => {
  const enabled = normalizeSyncSections(sections)
  const source = config && typeof config === 'object' ? config : {}
  const payload = {}
  for (const [section, keys] of Object.entries(SYNC_SECTIONS)) {
    if (!enabled[section]) continue
    for (const key of keys) {
      if (key in source) payload[key] = source[key]
    }
  }
  return payload
}

/**
 * 把远端 payload 按分区合进本地配置。
 *
 * 注意：`sync` 字段永不被远端覆盖——远端文档里根本不含 token，
 * 若整体替换会让本机 token 与同步地址被清空。
 *
 * @param {object} current 当前本地配置。
 * @param {object} payload 远端 payload。
 * @param {object} sections 分区开关。
 * @returns {object} 合并后的新配置（不修改入参）。
 */
export const applyRemotePayload = (current, payload, sections) => {
  const enabled = normalizeSyncSections(sections)
  const base = current && typeof current === 'object' ? current : {}
  const incoming = payload && typeof payload === 'object' ? payload : {}
  const next = { ...base }
  for (const [section, keys] of Object.entries(SYNC_SECTIONS)) {
    if (!enabled[section]) continue
    for (const key of keys) {
      if (key in incoming) next[key] = incoming[key]
    }
  }
  return next
}

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const hashString = async (text) => {
  const raw = String(text ?? '')
  if (globalThis.crypto?.subtle && typeof TextEncoder === 'function') {
    const bytes = new TextEncoder().encode(raw)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  if (typeof Buffer !== 'undefined') {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(raw, 'utf8').digest('hex')
  }
  throw new Error('当前环境不支持配置 hash 计算')
}

/**
 * 计算配置内容 hash。排序对象 key，避免 JSON 字段顺序变化导致误判。
 *
 * @param {object} config 配置对象。
 * @returns {Promise<string>} sha256 十六进制串。
 */
export const computeConfigHash = async (config) => hashString(stableStringify(config || {}))

/**
 * 把 keep 数量夹到允许区间。
 *
 * @param {number} keep 期望保留的快照数。
 * @returns {number} 合法数量。
 */
export const clampSnapshotKeep = (keep) => {
  const value = Number(keep)
  if (!Number.isFinite(value)) return DEFAULT_SNAPSHOT_KEEP
  return Math.min(MAX_SNAPSHOT_KEEP, Math.max(MIN_SNAPSHOT_KEEP, Math.trunc(value)))
}

/**
 * 构造设备标识，写进文档用于展示"这版是谁推的"。
 *
 * @param {{id: string, name?: string}} device 设备信息。
 * @returns {{id: string, name: string}}
 */
export const normalizeDevice = (device) => ({
  id: typeof device?.id === 'string' ? device.id : '',
  name: typeof device?.name === 'string' ? device.name : ''
})

/**
 * 保证快照时间戳在环内唯一。
 *
 * 为什么需要：
 * - 存量裸 config 没有 `updatedAt`，第一条快照会回落到"本次写入时间"，
 *   于是它和下一次写入产生的快照同毫秒，而 `at` 正是回滚用的键——撞了就只能
 *   恢复到其中一个，界面上两行点了效果还一样。
 * - 撞车时把后来的那条往后挪 1ms 即可，时间只用于展示与定位。
 *
 * @param {Array<{at: string}>} list 快照列表。
 * @returns {Array<object>} 时间戳唯一的新列表。
 */
const uniqueSnapshotAts = (list) => {
  const used = new Set()
  return list.map((item) => {
    const raw = typeof item.at === 'string' ? item.at.trim() : ''
    if (!raw) return item
    let candidate = raw
    let bump = 0
    while (used.has(candidate)) {
      bump += 1
      const parsed = Date.parse(raw)
      candidate = Number.isNaN(parsed) ? `${raw}#${bump}` : new Date(parsed + bump).toISOString()
    }
    used.add(candidate)
    return { ...item, at: candidate }
  })
}

/**
 * 构造要写入远端的新文档。
 *
 * 关键逻辑：本次推送前的远端 payload 作为一条快照入环，
 * 这样"某次推送把卡片搞没了"可以直接回滚到上一个版本。
 *
 * @param {object} options
 * @param {object|null} options.previous 读取到的远端旧文档（可为 null）。
 * @param {object} options.payload 本次要写的 payload。
 * @param {{id: string, name?: string}} options.device 当前设备。
 * @param {number} [options.keep] 保留的快照数量。
 * @param {string} [options.now] 写入时间（ISO），便于测试固定。
 * @returns {object} 符合 SYNC_SCHEMA_VERSION 的文档。
 */
export const buildRemoteDoc = ({ previous, payload, device, keep, now }) => {
  const updatedAt = typeof now === 'string' && now ? now : new Date().toISOString()
  const currentDevice = normalizeDevice(device)
  const previousPayload = previous?.payload && typeof previous.payload === 'object' ? previous.payload : null

  // 只在远端旧内容与本次不同时才留快照，避免反复推送同一份配置把环刷满重复项。
  const sameAsPrevious = previousPayload
    ? stableStringify(previousPayload) === stableStringify(payload)
    : true

  const carried = Array.isArray(previous?.snapshots) ? previous.snapshots : []
  const fresh = previousPayload && !sameAsPrevious
    ? [{
        at: typeof previous?.updatedAt === 'string' && previous.updatedAt ? previous.updatedAt : updatedAt,
        device: normalizeDevice(previous?.device),
        payload: previousPayload
      }]
    : []

  // 去重键用 at + 内容，两个设备同一毫秒写同样的内容只留一条。
  const seen = new Set()
  const snapshots = []
  for (const item of [...fresh, ...carried]) {
    if (!item?.payload || typeof item.payload !== 'object') continue
    const key = `${item.at}|${stableStringify(item.payload)}`
    if (seen.has(key)) continue
    seen.add(key)
    snapshots.push({
      at: typeof item.at === 'string' ? item.at : '',
      device: normalizeDevice(item.device),
      payload: item.payload
    })
    if (snapshots.length >= clampSnapshotKeep(keep)) break
  }

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt,
    device: currentDevice,
    payload: payload && typeof payload === 'object' ? payload : {},
    snapshots: uniqueSnapshotAts(snapshots)
  }
}

/**
 * 解析远端文本为文档对象。
 *
 * @param {string} text 远端文件内容。
 * @returns {object|null} 文档；空内容返回 null。
 */
export const parseRemoteDoc = (text) => {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('远端内容不是合法 JSON，可能已被其他工具改写')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('远端内容不是 JSON 对象')
  }

  // 重要逻辑：存量远端是裸配置，没有 payload 包裹，整体当成 payload。
  if (parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)) {
    return {
      schemaVersion: Number(parsed.schemaVersion) || SYNC_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      device: normalizeDevice(parsed.device),
      payload: parsed.payload,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : []
    }
  }

  return {
    schemaVersion: 0,
    updatedAt: '',
    device: { id: '', name: '' },
    payload: parsed,
    snapshots: []
  }
}

/**
 * 序列化文档，统一两空格缩进方便用户直接看远端文件。
 *
 * @param {object} doc 文档对象。
 * @returns {string} JSON 文本。
 */
export const serializeRemoteDoc = (doc) => JSON.stringify(doc, null, 2)

/**
 * 提取快照摘要，供设置页展示（不返回 payload 全文，避免消息体过大）。
 *
 * @param {object|null} doc 远端文档。
 * @returns {Array<{at: string, deviceName: string, cardCount: number, historyCount: number}>}
 */
export const summarizeSnapshots = (doc) => {
  const list = Array.isArray(doc?.snapshots) ? doc.snapshots : []
  return list.map((item) => ({
    at: typeof item.at === 'string' ? item.at : '',
    deviceName: typeof item.device?.name === 'string' ? item.device.name : '',
    cardCount: Array.isArray(item.payload?.cards) ? item.payload.cards.length : 0,
    historyCount: Array.isArray(item.payload?.searchHistory) ? item.payload.searchHistory.length : 0
  }))
}

/**
 * 在文档里按时间找快照 payload。
 *
 * @param {object|null} doc 远端文档。
 * @param {string} at 快照时间戳。
 * @returns {object} 快照 payload。
 */
export const findSnapshotPayload = (doc, at) => {
  const list = Array.isArray(doc?.snapshots) ? doc.snapshots : []
  const hit = list.find((item) => item?.at === at)
  if (!hit?.payload) throw new Error('找不到该备份版本，可能已被新的同步覆盖')
  return hit.payload
}
