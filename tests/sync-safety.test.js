import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfig, updateConfig } from '../config-store.js'
import { handleSyncMessage } from '../sync-actions.js'
import { createChromeStub, createLockManager } from './helpers/chrome-stub.js'

const SYNC = { provider: 'gitee_gist', gitUrl: 'https://gitee.com/example/codes/test', token: 'test', autoPush: true }
const card = (name) => ({ id: 'docs', title: '文档', url: `https://${name}.example` })
const writeCard = (api, name) => updateConfig(api, { cards: [card(name)] })
const action = (api, type, data) => handleSyncMessage(api, { type, ...data })

let remote
let corruptWrite
let writes
const device = async (sync = SYNC) => {
  const api = createChromeStub()
  await updateConfig(api, { sync })
  return api
}

beforeEach(() => {
  remote = null
  corruptWrite = false
  writes = 0
  vi.stubGlobal('navigator', { locks: createLockManager() })
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'PATCH') {
      writes++
      remote = JSON.parse(JSON.parse(init.body).files['config.json'].content)
      if (corruptWrite) remote.payload.cards[0].url = card('wrong').url
    }
    return { ok: true, status: 200, json: async () => ({ files: remote ? { 'config.json': { content: JSON.stringify(remote) } } : {} }) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('持久化同步', () => {
  it('页面关闭后，新的执行上下文仍会上传尚未推送的修改', async () => {
    const api = await device()
    await writeCard(api, 'old')
    await action(api, 'pushRemote')
    await writeCard(api, 'new')
    // 不调用页面推送定时器；模拟页面和后台都重启，仅保留 Chrome 存储。
    vi.stubGlobal('navigator', { locks: createLockManager() })
    expect(await action(api, 'autoSync')).toMatchObject({ ok: true })
    expect(remote.payload.cards).toEqual([card('new')])
    expect((await readConfig(api)).cards).toEqual([card('new')])
    expect(await action(api, 'autoSync')).toMatchObject({ ok: true, skipped: true })
    expect(writes).toBe(2)
  })

  it('两台设备交错修改时保留两份，远端再更新后旧确认也不会覆盖', async () => {
    const a = await device()
    const b = await device()
    await writeCard(a, 'base')
    await action(a, 'pushRemote')
    await action(b, 'autoSync')
    await writeCard(b, 'offline')
    await writeCard(a, 'online')
    await action(a, 'autoSync')
    expect(await action(b, 'autoSync')).toMatchObject({ ok: false, code: 'SYNC_CONFLICT' })
    expect((await readConfig(b)).cards).toEqual([card('offline')])
    expect(remote.payload.cards).toEqual([card('online')])
    const confirmation = await action(b, 'pushRemote')
    expect(confirmation).toMatchObject({ code: 'SYNC_CONFLICT' })
    await writeCard(a, 'newer')
    await action(a, 'autoSync')
    expect(await action(b, 'pushRemote', { confirmedVersion: confirmation.remoteVersion })).toMatchObject({ code: 'SYNC_CONFLICT' })
    expect(remote.payload.cards).toEqual([card('newer')])
    const freshConfirmation = await action(b, 'pushRemote')
    expect(await action(b, 'pushRemote', { confirmedVersion: freshConfirmation.remoteVersion })).toMatchObject({ ok: true })
    expect(remote.payload.cards).toEqual([card('offline')])
  })

  it('同名卡片链接读回不一致时，不会把待上传改动标为成功', async () => {
    const api = await device()
    await writeCard(api, 'right')
    corruptWrite = true
    await expect(action(api, 'autoSync')).rejects.toThrow('远端写入校验失败')
    expect((await readConfig(api)).cards).toEqual([card('right')])
    expect(await action(api, 'autoSync')).toMatchObject({ code: 'SYNC_CONFLICT' })
  })

  it('关闭历史同步后不上传新历史，并能只清除远端配置和快照中的旧历史', async () => {
    const api = await device({ ...SYNC, sections: { history: true } })
    await updateConfig(api, { cards: [card('docs')], searchHistory: ['远端旧历史'] })
    await action(api, 'pushRemote')
    await updateConfig(api, { searchHistory: ['第二版历史'] })
    await action(api, 'autoSync')
    await expect(action(api, 'clearRemoteHistory', { sync: SYNC })).rejects.toThrow('请先关闭')
    await updateConfig(api, { sync: { sections: { history: false } }, searchHistory: ['仅本机'] })
    await action(api, 'autoSync')
    expect(JSON.stringify(remote)).not.toContain('仅本机')
    const oldSnapshots = remote.snapshots.map(({ at, payload }) => ({ at, cards: payload.cards }))
    expect(await action(api, 'clearRemoteHistory', { sync: SYNC })).toMatchObject({ ok: true })
    expect(remote.payload).not.toHaveProperty('searchHistory')
    expect(remote.payload.cards).toEqual([card('docs')])
    expect(remote.snapshots.every(({ payload }) => !Object.hasOwn(payload, 'searchHistory'))).toBe(true)
    expect(remote.snapshots.map(({ at, payload }) => ({ at, cards: payload.cards }))).toEqual(oldSnapshots)
    expect((await readConfig(api)).searchHistory).toEqual(['仅本机'])
  })
})
