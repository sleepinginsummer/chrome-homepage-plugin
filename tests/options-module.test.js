import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 选项页的模块级回归：options.js 只在浏览器里跑，单测此前从不执行它，
 * 于是「同步规则收敛」时误删 `let currentConfig` 这种错误在 main() 里抛了 ReferenceError
 * 却一路合进了 main（主题与同步表单全废，浏览器冒烟才抓到）。
 * 这里用最小 chrome + DOM 桩把它跑一遍，断言能读出配置且无错误提示。
 */

const BUTTON_IDS = ['saveBtn', 'pushBtn', 'pullBtn', 'testBtn', 'exportBtn', 'importFile']

const createFakeElement = (selector) => {
  const listeners = new Map()
  const el = {
    selector,
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    hidden: false,
    classList: { toggle: vi.fn() },
    addEventListener: (type, listener) => listeners.set(type, listener),
    setAttribute: vi.fn(),
    closest: () => ({ classList: { toggle: vi.fn() } }),
    files: []
  }
  return el
}

/**
 * 构造 options.html 里被 options.js 直接引用的元素桩。
 */
const createDocumentStub = () => {
  const elements = new Map()
  const radios = [
    Object.assign(createFakeElement('input[name="theme"]'), { value: 'cyber-dark' }),
    Object.assign(createFakeElement('input[name="theme"]'), { value: 'neo-brutalism' })
  ]

  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, createFakeElement(selector))
    return elements.get(selector)
  }

  for (const id of [
    '#status', '#themeStatus', '#gitUrl', '#token', '#autoPush',
    ...BUTTON_IDS.map((id) => `#${id}`)
  ]) get(id)

  return {
    documentElement: { dataset: {}, style: {}, lang: '' },
    querySelector: (selector) => (selector === 'input[name="theme"]:checked'
      ? radios.find((radio) => radio.checked) || null
      : get(selector)),
    querySelectorAll: (selector) => (selector === 'input[name="theme"]' ? radios : []),
    addEventListener: vi.fn(),
    radios,
    get,
    status: () => get('#status')
  }
}

const createChromeStub = () => {
  const chromeApi = {
    runtime: {
      // 每次 sendMessage 都返回「无接收端」，触发 apiClient 的本地兜底路径（正好覆盖选项页的离线逻辑）。
      // 注意顺序：必须在回调执行前设置 lastError、回调返回后再清空，否则客户端读不到。
      lastError: null,
      id: 'test-extension',
      sendMessage: (payload, callback) => {
        chromeApi.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
        callback?.(undefined)
        chromeApi.runtime.lastError = null
      },
      getURL: (path) => `chrome-extension://test-extension${path}`,
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() }
    },
    storage: {
      local: {
        get: (keys, callback) => callback?.({}),
        set: (data, callback) => callback?.()
      },
      sync: {
        get: (keys, callback) => callback?.({}),
        set: (data, callback) => callback?.()
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    tabs: { query: async () => [], create: async () => {}, update: async () => {} }
  }
  return chromeApi
}

describe('options module boot', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', createChromeStub())
    vi.stubGlobal('document', createDocumentStub())
    vi.stubGlobal('navigator', { locks: { request: (_name, callback) => callback() } })
    vi.stubGlobal('requestAnimationFrame', (task) => task?.())
    vi.stubGlobal('requestIdleCallback', (task) => task?.())
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads the config and reflects the theme without any error status', async () => {
    await import('../options.js')
    // main() 是异步的：先等本地兜底（含一次 50ms 重试）跑完
    await new Promise((resolve) => setTimeout(resolve, 300))

    const status = globalThis.document.status()
    expect(status.textContent).toBe('已加载当前配置')
    expect(status.dataset.kind).toBe('info')

    // 主题单选按配置勾选（配置默认 cyber-dark）
    const checked = globalThis.document.radios.filter((radio) => radio.checked).map((radio) => radio.value)
    expect(checked).toEqual(['cyber-dark'])

    // 同步表单按配置预填，且按钮没有被永久禁用
    expect(globalThis.document.get('#gitUrl').value).toBe('')
    expect(globalThis.document.get('#saveBtn').disabled).toBe(false)
  })
})
