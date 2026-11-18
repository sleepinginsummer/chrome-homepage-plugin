import { describe, expect, it, vi } from 'vitest'
import {
  applyProviderVisibility,
  readSyncForm,
  renderSnapshotList,
  requestProviderPermission,
  writeSyncForm
} from '../sync-form.js'

/**
 * 最小 DOM 桩：只按 `#id` 与 `[data-sync-field="x"]` 选择器返回元素，
 * 与两个页面里 sync-form 实际用到的选择器一致。
 */
const createDocument = () => {
  const fields = new Map()
  const dataFields = new Map()

  const addField = (field) => {
    const wrapper = { hidden: false }
    dataFields.set(field, wrapper)
    return wrapper
  }

  const elements = new Map()
  const doc = {
    querySelector(selector) {
      const dataMatch = selector.match(/^\[data-sync-field="(.+)"\]$/)
      if (dataMatch) return dataFields.get(dataMatch[1]) || null
      return elements.get(selector) || null
    },
    register(id, extra = {}) {
      const el = { id, value: '', checked: false, textContent: '', children: [], ...extra }
      elements.set(`#${id}`, el)
      return el
    },
    addField,
    dataFields,
    elements
  }

  for (const field of ['gitUrl', 'token', 'webdavUrl', 'username', 'autoPush', 'backup']) addField(field)

  doc.provider = doc.register('syncProvider')
  doc.gitUrl = doc.register('syncGitUrl')
  doc.webdavUrl = doc.register('syncWebdavUrl')
  doc.username = doc.register('syncUsername')
  doc.token = doc.register('syncToken')
  doc.autoPush = doc.register('syncAutoPush')
  doc.sectionCards = doc.register('syncSectionCards', { checked: true })
  doc.sectionEngines = doc.register('syncSectionEngines', { checked: true })
  doc.sectionUi = doc.register('syncSectionUi', { checked: true })
  doc.sectionHistory = doc.register('syncSectionHistory', { checked: false })

  doc.createList = () => {
    const list = {
      _text: 'pending',
      children: [],
      ownerDocument: {
        createElement: (tag) => {
          const node = {
            tag,
            className: '',
            textContent: '',
            type: '',
            listeners: new Map(),
            children: [],
            addEventListener: (type, handler) => node.listeners.set(type, handler),
            appendChild: (child) => node.children.push(child)
          }
          return node
        }
      },
      appendChild(child) {
        this.children.push(child)
        this._text += child.textContent
      }
    }
    // 真实 DOM 里 textContent = '' 会清空子节点，桩必须一致否则测试会看到旧节点。
    Object.defineProperty(list, 'textContent', {
      get() { return this._text },
      set(value) {
        this._text = String(value)
        if (!value) this.children.length = 0
      }
    })
    elements.set('#syncSnapshotList', list)
    return list
  }

  return doc
}

const $ = (doc) => (selector) => doc.querySelector(selector)

describe('sync form', () => {
  it('reads provider, credentials and sections from the form', () => {
    const doc = createDocument()
    doc.provider.value = 'gitee_gist'
    doc.gitUrl.value = 'https://gitee.com/u/codes/abc'
    doc.token.value = 't'
    doc.autoPush.checked = true
    doc.sectionHistory.checked = true

    const sync = readSyncForm($(doc))

    expect(sync).toMatchObject({
      provider: 'gitee_gist',
      gistId: 'abc',
      token: 't',
      autoPush: true,
      sections: { cards: true, engines: true, ui: true, history: true }
    })
  })

  it('switches to the gist provider implied by a pasted url', () => {
    const doc = createDocument()
    doc.provider.value = 'github_gist'
    doc.gitUrl.value = 'https://gitee.com/u/codes/abc'

    expect(readSyncForm($(doc))).toMatchObject({ provider: 'gitee_gist', gistId: 'abc' })
  })

  it('keeps an explicit webdav selection even when a stale gist url is still in the form', () => {
    // 从代码片段切到 WebDAV 时，隐藏的地址框里还留着旧地址，不能被它改判服务商。
    const doc = createDocument()
    doc.provider.value = 'webdav'
    doc.gitUrl.value = 'https://gitee.com/u/codes/abc'
    doc.webdavUrl.value = 'https://dav.example.com/x/'
    doc.username.value = 'u'
    doc.token.value = 'p'

    const sync = readSyncForm($(doc))

    expect(sync.provider).toBe('webdav')
    expect(sync.webdavUrl).toBe('https://dav.example.com/x/')
    expect(sync.gistId).toBeUndefined()
  })

  it('writes the form and shows only the fields the provider needs', () => {
    const doc = createDocument()

    writeSyncForm($(doc), { provider: 'webdav', webdavUrl: 'https://dav/x/', username: 'u', token: 'p' })

    expect(doc.provider.value).toBe('webdav')
    expect(doc.webdavUrl.value).toBe('https://dav/x/')
    expect(doc.dataFields.get('gitUrl').hidden).toBe(true)
    expect(doc.dataFields.get('webdavUrl').hidden).toBe(false)
    expect(doc.dataFields.get('username').hidden).toBe(false)
    expect(doc.dataFields.get('token').hidden).toBe(false)
    expect(doc.dataFields.get('backup').hidden).toBe(false)
  })

  it('hides credentials and backups for chrome account sync but keeps auto push usable', () => {
    const doc = createDocument()

    applyProviderVisibility($(doc), 'storage_sync')

    expect(doc.dataFields.get('token').hidden).toBe(true)
    expect(doc.dataFields.get('gitUrl').hidden).toBe(true)
    expect(doc.dataFields.get('backup').hidden).toBe(true)
    // 自动同步在 storage.sync 下仍靠它触发写入，隐藏就再也关不掉了。
    expect(doc.dataFields.get('autoPush').hidden).toBe(false)
  })

  it('renders one row per snapshot and wires the restore button', () => {
    const doc = createDocument()
    const list = doc.createList()
    const onRestore = vi.fn()
    const setText = vi.fn()

    renderSnapshotList({
      $: $(doc),
      lang: 'zh',
      onRestore,
      setText,
      state: {
        supportsSnapshots: true,
        snapshots: [{ at: '2026-01-01T00:00:00.000Z', deviceName: 'macOS', cardCount: 3 }]
      }
    })

    expect(list.children).toHaveLength(1)
    const [row] = list.children
    expect(row.children[0].textContent).toContain('3 个卡片')

    row.children[1].listeners.get('click')()
    expect(onRestore).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z')
  })

  it('explains empty and unsupported states inside the list, not in the status slot', () => {
    // 状态栏留给"推送成功"这类操作结果：推送后的静默刷新不能把它盖掉。
    const doc = createDocument()
    const list = doc.createList()
    const setText = vi.fn()

    renderSnapshotList({ $: $(doc), state: { supportsSnapshots: false, snapshots: [] }, setText })
    expect(setText).not.toHaveBeenCalled()
    expect(list.children[0].textContent).toBe('当前同步源不保存历史版本')

    renderSnapshotList({ $: $(doc), state: { supportsSnapshots: true, snapshots: [] }, setText })
    expect(setText).not.toHaveBeenCalled()
    expect(list.children[0].textContent).toBe('还没有历史版本：每次推送前会把远端旧内容存一份')

    // 读取失败才是真错误，仍然走状态栏。
    renderSnapshotList({ $: $(doc), state: null, setText })
    expect(setText).toHaveBeenLastCalledWith('读取备份失败', 'error')
  })
})

describe('provider permission', () => {
  const createPermissions = ({ contains = true, request = true } = {}) => ({
    contains: vi.fn(async () => contains),
    request: vi.fn(async () => request)
  })

  it('skips the request when the origin is already granted', async () => {
    // Gitee 的域名直接写在 host_permissions 里，对它调 request 会失败。
    const permissions = createPermissions({ contains: true })
    const granted = await requestProviderPermission({ permissions }, { provider: 'gitee_gist' })

    expect(granted).toBe(true)
    expect(permissions.request).not.toHaveBeenCalled()
  })

  it('requests the github origins when they are not granted yet', async () => {
    const permissions = createPermissions({ contains: false, request: true })
    const granted = await requestProviderPermission({ permissions }, { provider: 'github_gist' })

    expect(granted).toBe(true)
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ['https://api.github.com/*', 'https://gist.githubusercontent.com/*']
    })
  })

  it('reports a denied prompt and never asks for providers without an origin', async () => {
    const permissions = createPermissions({ contains: false, request: false })
    expect(await requestProviderPermission({ permissions }, { provider: 'webdav', webdavUrl: 'https://dav/x' }))
      .toBe(false)

    const unused = createPermissions({ contains: false })
    expect(await requestProviderPermission({ permissions: unused }, { provider: 'storage_sync' })).toBe(true)
    expect(unused.contains).not.toHaveBeenCalled()
  })

  it('stays usable when the permissions API is unavailable', async () => {
    expect(await requestProviderPermission({}, { provider: 'github_gist' })).toBe(true)
    expect(await requestProviderPermission(null, { provider: 'gitee_gist' })).toBe(true)
  })
})
