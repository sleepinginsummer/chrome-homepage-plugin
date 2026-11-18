import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYNC_SECTIONS,
  applyRemotePayload,
  buildRemoteDoc,
  buildRemotePayload,
  clampSnapshotKeep,
  findSnapshotPayload,
  normalizeSyncSections,
  parseRemoteDoc,
  serializeRemoteDoc,
  summarizeSnapshots
} from '../sync-remote-doc.js'

const CARD = (title) => ({ id: title, title, url: 'https://example.com' })

describe('sync sections', () => {
  it('keeps search history local by default and picks only enabled sections', () => {
    const config = {
      cards: [CARD('a')],
      engines: [{ name: 'GOOGLE', baseUrl: 'https://g/' }],
      selectedEngines: ['GOOGLE'],
      rememberSelections: true,
      ui: { theme: 'cyber-dark', language: 'zh' },
      searchHistory: ['secret query'],
      popupTipDismissed: true,
      sync: { token: 'should-never-leave-the-device' }
    }

    const payload = buildRemotePayload(config, DEFAULT_SYNC_SECTIONS)

    expect(payload).toEqual({
      cards: config.cards,
      engines: config.engines,
      selectedEngines: config.selectedEngines,
      rememberSelections: true,
      ui: config.ui
    })
    // 关键断言：历史、本机提示状态和同步 token 都不该出现在远端文档里。
    expect(JSON.stringify(payload)).not.toContain('should-never-leave-the-device')
    expect(payload.searchHistory).toBeUndefined()
    expect(payload.sync).toBeUndefined()
    expect(payload.popupTipDismissed).toBeUndefined()
  })

  it('includes history only when the section is enabled', () => {
    const payload = buildRemotePayload({ searchHistory: ['q'] }, { history: true })
    expect(payload.searchHistory).toEqual(['q'])
  })

  it('applies remote payload per section and never overwrites local sync settings', () => {
    const current = {
      cards: [CARD('local')],
      engines: [{ name: 'LOCAL' }],
      searchHistory: ['local-history'],
      sync: { provider: 'github_gist', token: 'local-token' }
    }
    const remote = {
      cards: [CARD('remote')],
      engines: [{ name: 'REMOTE' }],
      searchHistory: ['remote-history']
    }

    const next = applyRemotePayload(current, remote, DEFAULT_SYNC_SECTIONS)

    expect(next.cards).toEqual(remote.cards)
    expect(next.engines).toEqual(remote.engines)
    expect(next.searchHistory).toEqual(['local-history'])
    expect(next.sync).toEqual(current.sync)
  })

  it('normalizes unknown section shapes to the defaults', () => {
    expect(normalizeSyncSections(null)).toEqual(DEFAULT_SYNC_SECTIONS)
    expect(normalizeSyncSections({ cards: false, typo: true })).toEqual({
      cards: false,
      engines: true,
      ui: true,
      history: false
    })
  })
})

describe('remote document format', () => {
  it('reads a legacy bare config as schemaVersion 0 payload', () => {
    const doc = parseRemoteDoc(JSON.stringify({ cards: [CARD('legacy')], ui: { theme: 'cyber-dark' } }))

    expect(doc.schemaVersion).toBe(0)
    expect(doc.payload.cards).toHaveLength(1)
    expect(doc.snapshots).toEqual([])
  })

  it('returns null for empty content and throws on broken json', () => {
    expect(parseRemoteDoc('')).toBeNull()
    expect(parseRemoteDoc('   ')).toBeNull()
    expect(() => parseRemoteDoc('{oops')).toThrow('JSON')
    expect(() => parseRemoteDoc('[1,2]')).toThrow('JSON 对象')
  })

  it('round-trips an envelope', () => {
    const doc = buildRemoteDoc({
      previous: null,
      payload: { cards: [CARD('a')] },
      device: { id: 'dev-1', name: 'macOS' },
      now: '2026-01-02T00:00:00.000Z'
    })

    const parsed = parseRemoteDoc(serializeRemoteDoc(doc))

    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(parsed.device).toEqual({ id: 'dev-1', name: 'macOS' })
    expect(parsed.payload).toEqual({ cards: [CARD('a')] })
  })

  it('stores the previous remote payload as a snapshot before overwriting', () => {
    const first = buildRemoteDoc({
      previous: null,
      payload: { cards: [CARD('v1')] },
      device: { id: 'dev', name: 'macOS' },
      now: '2026-01-01T00:00:00.000Z'
    })
    const second = buildRemoteDoc({
      previous: first,
      payload: { cards: [CARD('v2')] },
      device: { id: 'dev', name: 'macOS' },
      now: '2026-01-02T00:00:00.000Z'
    })

    expect(second.payload).toEqual({ cards: [CARD('v2')] })
    expect(second.snapshots).toHaveLength(1)
    expect(second.snapshots[0]).toMatchObject({
      at: '2026-01-01T00:00:00.000Z',
      payload: { cards: [CARD('v1')] }
    })
  })

  it('does not add a duplicate snapshot when the payload is unchanged', () => {
    const doc = buildRemoteDoc({ previous: null, payload: { cards: [CARD('same')] }, now: '2026-01-01T00:00:00.000Z' })
    const again = buildRemoteDoc({ previous: doc, payload: { cards: [CARD('same')] }, now: '2026-01-02T00:00:00.000Z' })

    expect(again.snapshots).toEqual([])
  })

  it('bounds the snapshot ring and clamps the keep value', () => {
    let doc = null
    for (let index = 0; index < 8; index += 1) {
      doc = buildRemoteDoc({
        previous: doc,
        payload: { cards: [CARD(`v${index}`)] },
        keep: 3,
        now: `2026-01-0${index + 1}T00:00:00.000Z`
      })
    }

    expect(doc.snapshots).toHaveLength(3)
    // 最新的一条快照是上一次推送的内容（v6），更老的在环满后被挤掉。
    expect(doc.snapshots[0].payload.cards[0].title).toBe('v6')

    expect(clampSnapshotKeep(0)).toBe(1)
    expect(clampSnapshotKeep(999)).toBe(20)
    expect(clampSnapshotKeep('x')).toBe(5)
  })

  it('keeps snapshot timestamps unique so each version stays restorable', () => {
    // 存量裸 config 没有 updatedAt，第一条快照会落到"本次写入时间"上；
    // 下一次写入若不纠偏就会生成同毫秒的第二条，而 at 是回滚用的键。
    const legacy = { schemaVersion: 0, updatedAt: '', device: { id: '', name: '' }, payload: { cards: [CARD('legacy')] }, snapshots: [] }
    const first = buildRemoteDoc({ previous: legacy, payload: { cards: [CARD('v1')] }, now: '2026-01-01T00:00:00.000Z' })
    const second = buildRemoteDoc({ previous: first, payload: { cards: [CARD('v2')] }, now: '2026-01-01T00:00:00.000Z' })

    const ats = second.snapshots.map((item) => item.at)
    expect(ats).toHaveLength(2)
    expect(new Set(ats).size).toBe(2)
    // 每一条都能精确取回自己的内容。
    expect(findSnapshotPayload(second, ats[0]).cards[0].title).toBe('v1')
    expect(findSnapshotPayload(second, ats[1]).cards[0].title).toBe('legacy')
  })

  it('summarizes and looks up snapshots', () => {
    const first = buildRemoteDoc({ previous: null, payload: { cards: [CARD('a'), CARD('b')] }, now: '2026-01-01T00:00:00.000Z' })
    const second = buildRemoteDoc({
      previous: first,
      payload: { cards: [CARD('c')] },
      device: { id: 'd', name: 'Linux' },
      now: '2026-01-02T00:00:00.000Z'
    })

    const summary = summarizeSnapshots(second)
    expect(summary).toEqual([
      { at: '2026-01-01T00:00:00.000Z', deviceName: '', cardCount: 2, historyCount: 0 }
    ])

    expect(findSnapshotPayload(second, '2026-01-01T00:00:00.000Z').cards).toHaveLength(2)
    expect(() => findSnapshotPayload(second, 'nope')).toThrow('找不到该备份版本')
  })
})
