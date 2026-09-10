import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSearchController } from '../search-controller.js'
import { handleMessageLocally } from '../extension-api.js'
import { DEFAULT_CONFIG, STORAGE_KEY, deepMerge } from '../config-store.js'
import { runStartupSync } from '../sync-startup.js'
import { createChromeStub, createLockManager } from './helpers/chrome-stub.js'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// 同一套持久化/并发回归覆盖正常后台与本地兜底，网络只连接内存中的 Gitee 桩。
describe.each(['background', 'local'])('search history via %s', (mode) => {
  let chromeApi
  let send
  let remote
  let fetchStarted
  let fetchRelease

  beforeEach(async () => {
    chromeApi = createChromeStub()
    vi.stubGlobal('chrome', chromeApi)
    vi.stubGlobal('navigator', { locks: createLockManager() })
    remote = deepMerge(DEFAULT_CONFIG, {
      searchHistory: ['远端旧历史'],
      ui: { theme: 'neo-brutalism' },
      sync: { autoPush: true, gitUrl: 'https://gitee.com/example/codes/history-test', token: 'test-token' }
    })
    chromeApi.__stores.localStore.set(STORAGE_KEY, deepMerge(remote, {
      searchHistory: ['本机历史'], ui: { theme: 'cyber-dark' }
    }))
    fetchStarted = deferred()
    fetchRelease = null
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      fetchStarted.resolve()
      if (fetchRelease) await fetchRelease.promise
      if (options?.method === 'PATCH') remote = JSON.parse(JSON.parse(options.body).files['config.json'].content)
      return { ok: true, status: 200, json: async () => ({ files: { 'config.json': { content: JSON.stringify(remote) } } }) }
    }))
    if (mode === 'background') {
      vi.resetModules()
      await import('../background.js')
      send = (message) => new Promise((resolve) => chromeApi.__onMessage(message, { tab: { id: 123 } }, resolve))
    } else {
      send = (message) => handleMessageLocally(chromeApi, message)
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  const readHistory = async (send) => (await send({ type: 'getConfig' })).data.searchHistory

  it('persists concurrent additions and unrelated settings without losing records', async () => {
    await Promise.all([
      send({ type: 'addSearchHistory', keyword: '页面 A' }),
      handleMessageLocally(chromeApi, { type: 'addSearchHistory', keyword: '页面 B' }),
      send({ type: 'setConfig', data: { ui: { language: 'en' } } })
    ])
    expect(await readHistory(send)).toEqual(['页面 B', '页面 A', '本机历史'])
    expect((await send({ type: 'getConfig' })).data.ui.language).toBe('en')
  })

  it('trims and deduplicates terms, retaining only the newest 20', async () => {
    for (let index = 0; index < 22; index += 1) await send({ type: 'addSearchHistory', keyword: `词${index}` })
    await send({ type: 'addSearchHistory', keyword: '  词5  ' })
    const history = await readHistory(send)
    expect(history).toHaveLength(20)
    expect(history.slice(0, 3)).toEqual(['词5', '词21', '词20'])
    expect(history.filter((term) => term === '词5')).toHaveLength(1)
    expect(history).not.toContain('词1')
  })

  it('accepts legacy null history and explicit JSON imports', async () => {
    await send({ type: 'setConfig', data: { searchHistory: null } })
    await send({ type: 'addSearchHistory', keyword: '第一条' })
    expect(await readHistory(send)).toEqual(['第一条'])
    await send({ type: 'setConfig', data: { searchHistory: ['导入的备份历史'] } })
    expect(await readHistory(send)).toEqual(['导入的备份历史'])
  })

  it('keeps history added while a remote pull is waiting', async () => {
    fetchRelease = deferred()
    const pull = send({ type: 'pullRemote' })
    await fetchStarted.promise
    await send({ type: 'addSearchHistory', keyword: '拉取期间新增' })
    fetchRelease.resolve()
    const result = await pull
    expect(result.ok).toBe(true)
    expect(await readHistory(send)).toEqual(['拉取期间新增', '本机历史'])
    expect(result.data.ui.theme).toBe('neo-brutalism')
  })

  it('does not restore remote history after a local clear during pull', async () => {
    fetchRelease = deferred()
    const pull = send({ type: 'pullRemote' })
    await fetchStarted.promise
    await send({ type: 'setConfig', data: { searchHistory: [] } })
    fetchRelease.resolve()
    expect((await pull).ok).toBe(true)
    expect(await readHistory(send)).toEqual([])
  })

  it('startup pull and push preserve local history even when remote omits it', async () => {
    delete remote.searchHistory
    const result = await runStartupSync({ sync: remote.sync, send })
    expect(result.ok).toBe(true)
    expect(await readHistory(send)).toEqual(['本机历史'])
  })

  it('does not overwrite changes made while a push is waiting', async () => {
    fetchRelease = deferred()
    const push = send({ type: 'pushRemote' })
    await fetchStarted.promise
    await send({ type: 'addSearchHistory', keyword: '推送期间新增' })
    await send({ type: 'setConfig', data: { ui: { language: 'en' } } })
    fetchRelease.resolve()
    expect((await push).ok).toBe(true)
    expect(await readHistory(send)).toEqual(['推送期间新增', '本机历史'])
    expect((await send({ type: 'getConfig' })).data.ui.language).toBe('en')
  })

  it('releases the storage lock after a save failure so the next search can succeed', async () => {
    const originalSet = chromeApi.storage.local.set
    chromeApi.storage.local.set = () => { throw new Error('storage unavailable') }
    await expect(send({ type: 'addSearchHistory', keyword: '未保存' }).then((res) => {
      if (!res.ok) throw new Error(res.error)
    })).rejects.toThrow('storage unavailable')
    chromeApi.storage.local.set = originalSet
    await send({ type: 'addSearchHistory', keyword: '重试成功' })
    expect(await readHistory(send)).toEqual(['重试成功', '本机历史'])
  })
})

// 直接构造搜索控制器：原先靠切 newtab.js 源码文本再 vm 执行，改动页面就会崩。
const createSearchPage = ({ historySaved = Promise.resolve(), openResult = { ok: true }, keyword = '测试', selectedEngines = ['GOOGLE'] } = {}) => {
  const errors = []
  const engines = [{ name: 'GOOGLE', baseUrl: 'https://example.com/search?q=' }]
  let config = { engines, selectedEngines, searchHistory: [] }
  const send = vi.fn(async (message) => {
    if (message.type === 'addSearchHistory') {
      await historySaved
      return { ok: true, data: config }
    }
    return openResult
  })

  const controller = createSearchController({
    getConfig: () => config,
    applyConfig: (next) => {
      config = next
    },
    saveConfig: vi.fn(async () => {}),
    send,
    setError: (message) => errors.push(message),
    afterConfigChange: vi.fn(),
    root: {
      querySelector: (selector) => (selector === '#keywordInput' ? { value: keyword } : null),
      querySelectorAll: () => []
    }
  })

  return { trigger: (options) => controller.triggerSearch(options), send, errors, controller }
}

describe('newtab search lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('waits for persistence before navigating, including first use', async () => {
    const saved = deferred()
    const page = createSearchPage({ historySaved: saved.promise })
    const search = page.trigger({ shouldAddToHistory: true })
    expect(page.send.mock.calls.map(([message]) => message.type)).toEqual(['addSearchHistory'])
    // 快速重复提交不能触发第二次导航。
    await page.trigger({ shouldAddToHistory: true })
    saved.resolve()
    await search
    expect(page.send.mock.calls.map(([message]) => message.type)).toEqual(['addSearchHistory', 'openTabs'])
    expect(page.controller.isSearching()).toBe(false)
  })

  it('stays on the page and reports a persistence failure', async () => {
    const page = createSearchPage({ historySaved: Promise.reject(new Error('保存失败')) })
    await page.trigger({ shouldAddToHistory: true })
    expect(page.errors.at(-1)).toBe('保存失败')
    expect(page.send).toHaveBeenCalledTimes(1)
    expect(page.controller.isSearching()).toBe(false)
  })

  it('reports actual tab API errors without asking for popup permission', async () => {
    const page = createSearchPage({ openResult: { ok: false, error: 'Invalid URL' } })
    await page.trigger({ shouldAddToHistory: true })
    expect(page.errors.at(-1)).toBe('Invalid URL')
  })

  it('opens existing history directly without adding it again', async () => {
    const page = createSearchPage()
    await page.trigger({ shouldAddToHistory: false })
    expect(page.send.mock.calls.map(([message]) => message.type)).toEqual(['openTabs'])
  })

  it.each([{ keyword: '  ' }, { selectedEngines: [] }])('rejects an invalid search: %j', async (options) => {
    const page = createSearchPage(options)
    await page.trigger({ shouldAddToHistory: true })
    expect(page.send).not.toHaveBeenCalled()
    expect(page.errors.at(-1)).toBeTruthy()
  })
})
