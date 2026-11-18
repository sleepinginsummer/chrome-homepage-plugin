/**
 * @fileoverview
 * 同步设置表单的共享实现：选项页与新标签页设置面板共用。
 *
 * 设计目标：
 * - 两处页面的同步面板字段完全一致，读写逻辑只写一份，避免"选项页能改、设置面板改不了"。
 * - 输入框按服务商显示/隐藏：代码片段要地址、WebDAV 要目录与账号、storage.sync 零配置。
 *
 * 注意：
 * - 表单只做数据搬运与显隐，不做网络请求，也不写配置；落盘由调用方决定。
 * - 备份列表用 DOM API 逐个创建，远端返回的文案一律走 textContent，不拼 innerHTML。
 */

import { DEFAULT_SYNC_PATH, normalizeSyncDraft, tryParseGitRemote } from './remote-sync.js'
import { SYNC_PROVIDER_LIST, getProviderOrigin } from './sync-providers.js'

/** 先保存已确认的目标和分区，再要求后台核对清除目标。 */
export const clearRemoteSearchHistory = async (send, sync) => {
  const saved = await send({ type: 'setConfig', data: { sync } })
  if (!saved?.ok) return saved
  return send({ type: 'clearRemoteHistory', sync })
}

/** 确认只对当前冲突版本有效，二次请求若发现新版本，继续保留双方改动。 */
export const sendManualSync = async (send, type, confirmOverwrite) => {
  const result = await send({ type })
  if (result?.code !== 'SYNC_CONFLICT' || !confirmOverwrite()) return result
  return send({ type, confirmedVersion: result.remoteVersion })
}

/**
 * 各字段在哪些服务商下需要填写。
 * 与 sync-providers.js 的 fields 表保持同构：代码片段=gitUrl+token，WebDAV=目录+账号+密码。
 */
const FIELD_PROVIDERS = {
  gitUrl: ['github_gist', 'gitee_gist'],
  token: ['github_gist', 'gitee_gist', 'webdav'],
  webdavUrl: ['webdav'],
  username: ['webdav']
}

/**
 * 分区开关的 DOM 后缀与配置 key 的对应关系。
 */
const SECTION_FIELDS = [
  { key: 'cards', id: 'syncSectionCards' },
  { key: 'engines', id: 'syncSectionEngines' },
  { key: 'ui', id: 'syncSectionUi' },
  { key: 'history', id: 'syncSectionHistory' }
]

const providerIds = () => SYNC_PROVIDER_LIST.map((provider) => provider.id)

/**
 * 按服务商切换字段可见性与占位提示。
 *
 * @param {function(string): Element|null} $ 查询函数。
 * @param {string} provider 服务商 id。
 * @returns {void}
 */
export const applyProviderVisibility = ($, provider) => {
  const active = provider || providerIds()[0]
  for (const [field, providers] of Object.entries(FIELD_PROVIDERS)) {
    const wrapper = $(`[data-sync-field="${field}"]`)
    if (wrapper) wrapper.hidden = !providers.includes(active)
  }

  // 自动同步对 storage.sync 同样有意义（配置仍以 storage.local 为准，靠它推到账号），
  // 只有备份版本列表在这些没有版本历史的源上必须隐藏。
  const backupRow = $('[data-sync-field="backup"]')
  if (backupRow) backupRow.hidden = active === 'storage_sync'
}

/**
 * 读取表单，产出可直接写进配置的 sync 对象。
 *
 * @param {function(string): Element|null} $ 查询函数。
 * @returns {object} sync 配置。
 */
export const readSyncForm = ($) => {
  const selected = $('#syncProvider')?.value || providerIds()[0]
  const gitUrl = $('#syncGitUrl')?.value.trim() || ''
  const parsed = tryParseGitRemote(gitUrl)
  // 重要逻辑：只在"选中的就是代码片段"时用地址纠偏（避免改了地址忘改下拉，
  // 拿 Gitee 的 gistId 去请求 GitHub）。选了 WebDAV/storage.sync 时，
  // 隐藏的地址输入框里可能还留着上一个服务商的旧地址，不能拿它改判服务商。
  const isGistProvider = selected === 'github_gist' || selected === 'gitee_gist'
  const provider = isGistProvider && parsed ? parsed.provider : selected
  const sections = {}
  for (const { key, id } of SECTION_FIELDS) {
    const input = $(`#${id}`)
    if (input) sections[key] = Boolean(input.checked)
  }

  return {
    provider,
    gitUrl,
    ...(parsed && parsed.provider === provider ? { gistId: parsed.gistId } : {}),
    webdavUrl: $('#syncWebdavUrl')?.value.trim() || '',
    username: $('#syncUsername')?.value.trim() || '',
    token: $('#syncToken')?.value.trim() || '',
    autoPush: Boolean($('#syncAutoPush')?.checked),
    sections,
    path: DEFAULT_SYNC_PATH
  }
}

/**
 * 把配置回填到表单。
 *
 * @param {function(string): Element|null} $ 查询函数。
 * @param {object} sync 同步配置。
 * @returns {void}
 */
export const writeSyncForm = ($, sync) => {
  const normalized = normalizeSyncDraft(sync)
  const setValue = (selector, value) => {
    const el = $(selector)
    if (el) el.value = value ?? ''
  }
  const setChecked = (selector, value) => {
    const el = $(selector)
    if (el) el.checked = Boolean(value)
  }

  setValue('#syncProvider', normalized.provider)
  setValue('#syncGitUrl', normalized.gitUrl)
  setValue('#syncWebdavUrl', normalized.webdavUrl)
  setValue('#syncUsername', normalized.username)
  setValue('#syncToken', normalized.token)
  setChecked('#syncAutoPush', normalized.autoPush)
  for (const { key, id } of SECTION_FIELDS) setChecked(`#${id}`, normalized.sections?.[key])
  applyProviderVisibility($, normalized.provider)
}

/**
 * 拼接一条备份版本的说明文案。
 *
 * @param {object} item 快照摘要。
 * @param {string} lang 语言（zh/en）。
 * @returns {string} 说明文案。
 */
const formatSnapshotMeta = (item, lang) => {
  const at = item.at ? new Date(item.at) : null
  const time = at && !Number.isNaN(at.getTime()) ? at.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN') : '—'
  const device = item.deviceName ? ` · ${item.deviceName}` : ''
  return lang === 'en' ? `${time}${device} · ${item.cardCount} cards` : `${time}${device} · ${item.cardCount} 个卡片`
}

/**
 * 渲染备份版本列表。
 *
 * @param {object} options
 * @param {function(string): Element|null} options.$ 查询函数。
 * @param {object} options.state readRemoteState 的返回结果。
 * @param {string} [options.lang] 语言。
 * @param {function(string): void} options.onRestore 点击恢复的回调（参数为快照时间）。
 * @param {function(string, string=): void} [options.setText] 文案写入函数。
 * @returns {void}
 */
export const renderSnapshotList = ({ $, state, lang = 'zh', onRestore, setText }) => {
  const list = $('#syncSnapshotList')
  if (!list) return
  list.textContent = ''
  // 用列表所属文档创建节点，页面与测试桩都不依赖全局 document。
  const doc = list.ownerDocument || (typeof document === 'undefined' ? null : document)
  if (!doc) return

  const tips = {
    zh: {
      unsupported: '当前同步源不保存历史版本',
      empty: '还没有历史版本：每次推送前会把远端旧内容存一份',
      restore: '恢复',
      failed: '读取备份失败'
    },
    en: {
      unsupported: 'This provider keeps no version history',
      empty: 'No versions yet: each push saves the previous remote content',
      restore: 'Restore',
      failed: 'Failed to read backups'
    }
  }[lang === 'en' ? 'en' : 'zh']

  // 说明性文案写在列表里，不占状态栏：状态栏留给"推送成功/失败"这类操作结果，
  // 否则推送成功后紧接着的静默刷新会把结果盖掉，用户看不到自己刚做的事成没成。
  const renderHint = (text) => {
    const row = doc.createElement('li')
    row.className = 'snapshot-empty'
    row.textContent = text
    list.appendChild(row)
  }

  if (!state) {
    setText?.(tips.failed, 'error')
    return
  }
  if (!state.supportsSnapshots) {
    renderHint(tips.unsupported)
    return
  }

  const snapshots = Array.isArray(state.snapshots) ? state.snapshots : []
  if (!snapshots.length) {
    renderHint(tips.empty)
    return
  }

  for (const item of snapshots) {
    const row = doc.createElement('li')
    row.className = 'snapshot-row'

    const label = doc.createElement('span')
    label.className = 'snapshot-meta'
    label.textContent = formatSnapshotMeta(item, lang)

    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'ghost-button snapshot-restore'
    button.textContent = tips.restore
    button.addEventListener('click', () => onRestore?.(item.at))

    row.appendChild(label)
    row.appendChild(button)
    list.appendChild(row)
  }
}

/**
 * 按需申请同步域名的主机权限。
 *
 * manifest 里把这些域名放在 optional_host_permissions：普通用户装扩展时不会被要求
 * 一次性授权一堆陌生域名，只有真正启用某个同步源时才弹窗。
 *
 * 注意：
 * - chrome.permissions.request 需要用户手势，调用方必须在点击处理器里、其它 await 之前调用。
 * - 必须先 contains 判断：对已经在 host_permissions 里的域名（Gitee）直接调 request 会失败，
 *   把老用户挡在门外；对已授权的域名 request 也可能因为缺少手势而报错。
 *
 * @param {object} chromeApi Chrome API。
 * @param {object} sync 同步配置。
 * @returns {Promise<boolean>} 是否拿到权限。
 */
export const requestProviderPermission = async (chromeApi, sync) => {
  const provider = sync?.provider || providerIds()[0]
  const origin = getProviderOrigin(provider, sync)
  if (!origin) return true
  if (!chromeApi?.permissions) return true

  const origins = provider === 'github_gist'
    ? ['https://api.github.com/*', 'https://gist.githubusercontent.com/*']
    : [origin]

  // 已授权（含 manifest 里直接声明的域名）就不用弹窗，也不用冒缺手势的风险。
  try {
    if (chromeApi.permissions.contains && (await chromeApi.permissions.contains({ origins }))) return true
  } catch {
    // contains 不可用时继续走 request
  }

  if (!chromeApi.permissions.request) return true
  try {
    return Boolean(await chromeApi.permissions.request({ origins }))
  } catch {
    return false
  }
}
