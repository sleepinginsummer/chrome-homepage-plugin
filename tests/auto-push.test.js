import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canAutoPush, createAutoPush } from '../auto-push.js'

const normalizeSync = (sync) => ({
  gitUrl: sync?.gitUrl || '',
  token: sync?.token || '',
  autoPush: Boolean(sync?.autoPush)
})

const createHarness = ({ sync = {}, pushed = { ok: true, lastSyncAt: 'now' }, debounceMs = 10 } = {}) => {
  let current = { sync }
  const status = []
  const pushRemote = vi.fn(async () => {
    if (pushed instanceof Error) throw pushed
    return pushed
  })

  const scheduler = createAutoPush({
    getConfig: () => current,
    normalizeSync,
    pushRemote,
    setStatus: (text, kind = 'info') => status.push([text, kind]),
    afterPush: vi.fn(async () => {}),
    debounceMs
  })

  return {
    scheduler,
    pushRemote,
    status,
    setSync: (next) => {
      current = { sync: next }
    }
  }
}

const READY_SYNC = { autoPush: true, gitUrl: 'https://gitee.com/a/codes/b', token: 't' }

describe('canAutoPush', () => {
  it.each([
    [{}, false],
    [{ autoPush: true }, false],
    [{ autoPush: true, gitUrl: 'u' }, false],
    [{ autoPush: true, token: 't' }, false],
    [READY_SYNC, true]
  ])('canAutoPush(%o) === %s', (sync, expected) => {
    expect(canAutoPush(sync, normalizeSync)).toBe(expected)
  })
})

describe('auto push scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces rapid changes into a single push', async () => {
    const { scheduler, pushRemote } = createHarness({ sync: READY_SYNC })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(5)
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(20)

    expect(pushRemote).toHaveBeenCalledTimes(1)
    expect(pushRemote).toHaveBeenCalledWith({ type: 'pushRemote' })
  })

  it('reports success and hands the sync time to the page', async () => {
    const { scheduler, status } = createHarness({ sync: READY_SYNC })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(20)

    expect(status).toEqual([['自动同步中...', 'info'], ['已自动同步', 'ok']])
  })

  it('reports the push error', async () => {
    const { scheduler, status } = createHarness({ sync: READY_SYNC, pushed: { ok: false, error: '远端拒绝' } })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(20)

    expect(status.at(-1)).toEqual(['远端拒绝', 'error'])
  })

  it('warns once when auto push is on but the config is incomplete', async () => {
    const { scheduler, pushRemote, status } = createHarness({ sync: { autoPush: true, gitUrl: 'u' } })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(20)

    expect(pushRemote).not.toHaveBeenCalled()
    expect(status).toEqual([['自动同步已开启，但同步配置不完整（需 gitUrl/token）', 'error']])
  })

  it('stays quiet when auto push is off', async () => {
    const { scheduler, pushRemote, status } = createHarness({ sync: { gitUrl: 'u', token: 't' } })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(20)

    expect(pushRemote).not.toHaveBeenCalled()
    expect(status).toEqual([])
  })

  it('queues one extra push when changes arrive while pushing', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const pushRemote = vi.fn(async () => {
      await gate
      return { ok: true, lastSyncAt: 'now' }
    })
    const scheduler = createAutoPush({
      getConfig: () => ({ sync: READY_SYNC }),
      normalizeSync,
      pushRemote,
      setStatus: vi.fn(),
      debounceMs: 10
    })

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(15)
    expect(pushRemote).toHaveBeenCalledTimes(1)
    expect(scheduler.isPushing()).toBe(true)

    // 推送还在跑时又发生变更
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(15)
    expect(pushRemote).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(20)

    expect(pushRemote).toHaveBeenCalledTimes(2)
    expect(scheduler.isPushing()).toBe(false)
  })
})
