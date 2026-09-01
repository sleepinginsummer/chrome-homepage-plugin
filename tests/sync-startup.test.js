import { describe, expect, it } from 'vitest'
import { isAutoSyncReady, runStartupSync } from '../sync-startup.js'

/**
 * 构造可追踪调用顺序的 send 桩函数。
 */
const createSendStub = (responses) => {
  let index = 0
  const calls = []
  const send = async (payload) => {
    calls.push(payload)
    const response = responses[index] || { ok: true }
    index += 1
    return response
  }
  return { calls, send }
}

describe('sync startup', () => {
  it('does nothing when auto sync is disabled', async () => {
    const sync = { autoPush: false, gitUrl: 'https://gitee.com/a/codes/1', token: 't' }
    const { send, calls } = createSendStub([])

    await runStartupSync({
      sync,
      send,
      setStatus: () => {},
      renderLastSyncAt: async () => {}
    })

    expect(isAutoSyncReady(sync)).toBe(false)
    expect(calls).toEqual([])
  })

  it('pulls then pushes when auto sync is enabled', async () => {
    const sync = { autoPush: true, gitUrl: 'https://gitee.com/a/codes/1', token: 't' }
    const { send, calls } = createSendStub([{ ok: true }, { ok: true, lastSyncAt: '2024-01-01T00:00:00Z' }])
    const statuses = []
    const setStatus = (text, kind) => statuses.push({ text, kind })
    let lastSyncAt = null

    await runStartupSync({
      sync,
      send,
      setStatus,
      renderLastSyncAt: async (value) => {
        lastSyncAt = value
      }
    })

    expect(isAutoSyncReady(sync)).toBe(true)
    expect(calls).toEqual([{ type: 'pullRemote' }, { type: 'pushRemote' }])
    expect(statuses[0].text).toContain('启动同步')
    expect(lastSyncAt).toBe('2024-01-01T00:00:00Z')
  })
})
