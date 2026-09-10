import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 模块级冒烟：newtab.js 只在浏览器里运行，测试里没人 import 它，
 * 所以顶层漏定义某个 helper（例如把 getCardById 一起删掉）不会在单测里暴露，
 * 却会让整页在新标签页打开时直接 ReferenceError。
 * 这里用最小的 chrome stub 加载一次模块，覆盖模块作用域。
 */
const createChromeStub = () => ({
  runtime: {
    lastError: null,
    sendMessage: () => {},
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} }
  },
  storage: {
    local: {
      get: (keys, callback) => callback?.({}),
      set: (data, callback) => callback?.()
    },
    onChanged: { addListener: () => {} }
  },
  tabs: {
    query: async () => [],
    create: async () => {},
    update: async () => {}
  }
})

describe('newtab module scope', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', createChromeStub())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads without a DOM and without running the page entry', async () => {
    vi.resetModules()
    const mod = await import('../newtab.js')

    expect(mod).toBeTruthy()
    // node 环境没有 document，main() 不应被执行。
    expect(typeof document).toBe('undefined')
  })
})
