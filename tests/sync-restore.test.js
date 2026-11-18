import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pullRemoteConfig, pushRemoteConfig, pullRemoteState, restoreRemoteSnapshot } from '../remote-sync.js'
import { parseRemoteDoc } from '../sync-remote-doc.js'

/**
 * 用一个内存中的假 GitHub 代码片段跑通"推送 → 生成备份 → 回滚"，
 * 重点守住两条容易回归的性质：
 * 1) 同步 token 永远不出现在远端文档里；
 * 2) 每次推送写入前的远端内容会进快照环，回滚可逆。
 */

const SYNC = {
  provider: 'github_gist',
  gitUrl: 'https://gist.github.com/example/0123456789abcdef',
  token: 'secret-token',
  snapshotKeep: 5
}

const CARD = (title) => ({ id: title, title, url: 'https://example.com' })

let gistFile = null

beforeEach(() => {
  gistFile = null
  vi.stubGlobal('fetch', vi.fn(async (_url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase()
    if (method === 'GET') {
      if (!gistFile) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ files: { 'config.json': { content: gistFile } } }) }
    }
    const body = JSON.parse(init.body)
    gistFile = body.files['config.json'].content
    return { ok: true, status: 200, json: async () => ({}) }
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const push = (config, now) =>
  pushRemoteConfig(SYNC, config, { now, device: { id: 'dev-1', name: 'macOS' } })

describe('remote push and restore', () => {
  it('never writes the sync token to the remote document', async () => {
    await push({ cards: [CARD('a')], sync: { provider: 'github_gist', token: 'secret-token' } }, '2026-01-01T00:00:00.000Z')

    expect(gistFile).not.toContain('secret-token')
    const doc = parseRemoteDoc(gistFile)
    expect(doc.payload.sync).toBeUndefined()
    expect(doc.payload.cards).toHaveLength(1)
    expect(doc.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps the previous version as a restorable snapshot', async () => {
    await push({ cards: [CARD('v1')] }, '2026-01-01T00:00:00.000Z')
    await push({ cards: [CARD('v2')] }, '2026-01-02T00:00:00.000Z')

    const state = await pullRemoteState(SYNC)
    expect(state.supportsSnapshots).toBe(true)
    expect(state.snapshots).toEqual([
      { at: '2026-01-01T00:00:00.000Z', deviceName: 'macOS', cardCount: 1, historyCount: 0 }
    ])

    const restored = await restoreRemoteSnapshot(SYNC, '2026-01-01T00:00:00.000Z', {
      now: '2026-01-03T00:00:00.000Z',
      device: { id: 'dev-1', name: 'macOS' }
    })

    expect(restored.cards).toEqual([CARD('v1')])
    expect((await pullRemoteConfig(SYNC)).cards).toEqual([CARD('v1')])

    // 回滚本身也是一次写入：回滚前的 v2 进了环，所以回滚操作是可逆的。
    const afterRestore = await pullRemoteState(SYNC)
    expect(afterRestore.snapshots.map((item) => item.at)).toContain('2026-01-02T00:00:00.000Z')
  })

  it('reports a clear error when the remote has no config yet', async () => {
    await expect(pullRemoteConfig(SYNC)).rejects.toThrow('远端还没有配置文件')
  })

  it('rejects restoring an unknown snapshot', async () => {
    await push({ cards: [CARD('v1')] }, '2026-01-01T00:00:00.000Z')
    await expect(restoreRemoteSnapshot(SYNC, 'nope')).rejects.toThrow('找不到该备份版本')
  })

  it('skips the snapshot ring for providers without history support', async () => {
    const { createChromeStub } = await import('./helpers/chrome-stub.js')
    const chromeApi = createChromeStub()
    const storageSync = { provider: 'storage_sync' }

    await pushRemoteConfig(storageSync, { cards: [CARD('a')] }, { chromeApi, now: '2026-01-01T00:00:00.000Z' })
    await pushRemoteConfig(storageSync, { cards: [CARD('b')] }, { chromeApi, now: '2026-01-02T00:00:00.000Z' })

    const state = await pullRemoteState(storageSync, { chromeApi })
    expect(state.supportsSnapshots).toBe(false)
    expect(state.snapshots).toEqual([])
    expect(state.config.cards).toEqual([CARD('b')])

    await expect(restoreRemoteSnapshot(storageSync, 'x', { chromeApi })).rejects.toThrow('不支持备份回滚')
  })
})
