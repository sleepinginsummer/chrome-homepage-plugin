import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsModal } from '../settings-modal.js'

const createEl = (selector) => {
  const listeners = new Map()
  const el = {
    hidden: selector !== '#settingsOverlay',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    classList: { toggle: vi.fn() },
    addEventListener: (type, listener) => listeners.set(type, listener),
    setAttribute: vi.fn(),
    focus: vi.fn(),
    closest: () => ({ classList: { toggle: vi.fn() } }),
    fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), target: el, ...event })
  }
  return el
}

const createDom = () => {
  const elements = new Map()
  const register = (selector) => {
    const el = createEl(selector)
    elements.set(selector, el)
    return el
  }

  const dom = {
    overlay: register('#settingsOverlay'),
    openBtn: register('#openSettingsBtn'),
    closeBtn: register('#settingsCloseBtn'),
    title: register('#settingsTitle'),
    gitUrl: register('#syncGitUrl'),
    token: register('#syncToken'),
    autoPush: register('#syncAutoPush'),
    languageSelect: register('#languageSelect'),
    saveBtn: register('#syncSaveBtn'),
    pushBtn: register('#syncPushBtn'),
    pullBtn: register('#syncPullBtn'),
    testBtn: register('#syncTestBtn'),
    panelAppearance: register('#settingsPanelAppearance'),
    panelSync: register('#settingsPanelSync'),
    panelLanguage: register('#settingsPanelLanguage'),
    panelAbout: register('#settingsPanelAbout'),
    focusTab: register('#settingsTabAppearance')
  }

  const tabs = ['appearance', 'sync', 'language', 'about'].map((tab) => {
    const el = createEl(`.settings-item[${tab}]`)
    el.dataset.tab = tab
    return el
  })

  const rootListeners = new Map()
  return {
    dom,
    tabs,
    root: {
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: (selector) => (selector === '.settings-item' ? tabs : []),
      addEventListener: (type, listener) => rootListeners.set(type, listener),
      fireRoot: (type, event = {}) => rootListeners.get(type)?.({ preventDefault: vi.fn(), ...event })
    }
  }
}

const createHarness = ({ config = { sync: {} }, ...overrides } = {}) => {
  const { dom, tabs, root } = createDom()
  const status = []
  let current = config

  const deps = {
    send: vi.fn(async () => ({ ok: true })),
    saveConfig: vi.fn(async () => {}),
    renderLastSyncAt: vi.fn(async () => {}),
    applyLanguage: vi.fn(),
    onRemoteConfigApplied: vi.fn(),
    onSyncFormChanged: vi.fn(),
    theme: { syncRadios: vi.fn(), setStatus: vi.fn(), applyCurrent: vi.fn() },
    ...overrides
  }

  const modal = createSettingsModal({
    getConfig: () => current,
    applyConfig: (next) => {
      current = next
    },
    saveConfig: deps.saveConfig,
    send: deps.send,
    setStatus: (text, kind = 'info') => status.push([text, kind]),
    renderLastSyncAt: deps.renderLastSyncAt,
    applyLanguage: deps.applyLanguage,
    theme: deps.theme,
    onRemoteConfigApplied: deps.onRemoteConfigApplied,
    onSyncFormChanged: deps.onSyncFormChanged,
    getLang: () => current?.ui?.language === 'en' ? 'en' : 'zh',
    root
  })
  modal.init()

  return { modal, dom, tabs, status, deps, root, getConfig: () => current }
}

describe('settings modal tabs', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens on the appearance tab and prefills the sync form', () => {
    const { modal, dom, deps, status } = createHarness({
      config: { sync: { gitUrl: 'https://gitee.com/a/codes/b', token: 't', autoPush: true }, ui: { language: 'zh' } }
    })

    modal.open()

    expect(dom.overlay.hidden).toBe(false)
    expect(dom.gitUrl.value).toBe('https://gitee.com/a/codes/b')
    expect(dom.token.value).toBe('t')
    expect(dom.autoPush.checked).toBe(true)
    expect(dom.languageSelect.value).toBe('zh')
    expect(dom.panelAppearance.hidden).toBe(false)
    expect(dom.panelSync.hidden).toBe(true)
    expect(deps.theme.syncRadios).toHaveBeenCalledOnce()
    expect(status.at(-1)).toEqual(['', 'info'])
  })

  it('switches tab state, panel and title', () => {
    const { modal, dom, tabs } = createHarness()

    modal.selectTab('sync')

    expect(tabs[1].classList.toggle).toHaveBeenCalledWith('active', true)
    expect(tabs[1].setAttribute).toHaveBeenCalledWith('aria-selected', 'true')
    expect(tabs[1].tabIndex).toBe(0)
    expect(tabs[0].tabIndex).toBe(-1)
    expect(dom.panelSync.hidden).toBe(false)
    expect(dom.panelAppearance.hidden).toBe(true)
    expect(dom.title.textContent).toBe('同步设置')
  })

  it('moves tabs with arrows, Home and End', () => {
    const { tabs } = createHarness()

    tabs[0].fire('keydown', { key: 'ArrowLeft' })
    expect(tabs[3].focus).toHaveBeenCalled()

    tabs[0].fire('keydown', { key: 'End' })
    expect(tabs[3].focus).toHaveBeenCalledTimes(2)

    tabs[2].fire('keydown', { key: 'Home' })
    expect(tabs[0].focus).toHaveBeenCalledOnce()

    // 非导航键不拦截
    const preventDefault = vi.fn()
    tabs[0].fire('keydown', { key: 'a', preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('closes from the overlay, the close button and Escape', () => {
    const { modal, dom, root } = createHarness()

    modal.open()
    dom.overlay.fire('click', { target: dom.overlay })
    expect(dom.overlay.hidden).toBe(true)

    modal.open()
    dom.overlay.fire('click', { target: dom.token })
    expect(dom.overlay.hidden).toBe(false)

    dom.closeBtn.fire('click')
    expect(dom.overlay.hidden).toBe(true)

    modal.open()
    root.fireRoot('keydown', { key: 'Escape' })
    expect(dom.overlay.hidden).toBe(true)
  })
})

describe('settings modal sync actions', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves the form and reports success', async () => {
    const { dom, deps, status } = createHarness()
    deps.send.mockResolvedValueOnce({ ok: true, data: { sync: { gitUrl: 'https://gitee.com/a/codes/b' } } })
    dom.gitUrl.value = 'https://gitee.com/a/codes/b'
    dom.token.value = 't'

    await dom.saveBtn.fire('click')

    expect(deps.send).toHaveBeenCalledWith({
      type: 'setConfig',
      data: { sync: { gitUrl: 'https://gitee.com/a/codes/b', provider: 'gitee_gist', gistId: 'b', token: 't', autoPush: false, path: 'chrome-home-plugin/config.json' } }
    })
    expect(status).toEqual([['保存中...', 'info'], ['已保存', 'ok']])
    expect(dom.saveBtn.disabled).toBe(false)
  })

  it('reports a save failure and re-enables the buttons', async () => {
    const { dom, deps, status } = createHarness()
    deps.send.mockResolvedValueOnce({ ok: false, error: '存储不可用' })

    await dom.saveBtn.fire('click')

    expect(status.at(-1)).toEqual(['存储不可用', 'error'])
    expect(dom.saveBtn.disabled).toBe(false)
  })

  it('writes the form before pushing and refreshes the sync time', async () => {
    const { dom, deps, status } = createHarness()
    deps.send
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, lastSyncAt: 'later' })

    await dom.pushBtn.fire('click')

    expect(deps.send.mock.calls.map(([message]) => message.type)).toEqual(['setConfig', 'pushRemote'])
    expect(status.at(-1)).toEqual(['推送成功', 'ok'])
    expect(deps.renderLastSyncAt).toHaveBeenCalledWith('later')
  })

  it('refreshes the page after a successful pull', async () => {
    const pulledConfig = { sync: { gitUrl: 'https://gitee.com/a/codes/c', token: 't' }, cards: [] }
    const { dom, deps, status } = createHarness()
    deps.send
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, data: pulledConfig, lastSyncAt: 'now' })

    await dom.pullBtn.fire('click')

    expect(deps.onRemoteConfigApplied).toHaveBeenCalledWith(pulledConfig)
    expect(dom.gitUrl.value).toBe('https://gitee.com/a/codes/c')
    expect(status.at(-1)).toEqual(['拉取成功，已写入本地配置', 'ok'])
    expect(deps.renderLastSyncAt).toHaveBeenCalledWith('now')
  })

  it('reports a failed pull without touching the form', async () => {
    const { dom, deps, status } = createHarness()
    dom.gitUrl.value = 'https://gitee.com/a/codes/b'
    deps.send
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: '无权限' })

    await dom.pullBtn.fire('click')

    expect(status.at(-1)).toEqual(['无权限', 'error'])
    expect(deps.onRemoteConfigApplied).not.toHaveBeenCalled()
    expect(dom.gitUrl.value).toBe('https://gitee.com/a/codes/b')
  })

  it('tests the connection', async () => {
    const { dom, deps, status } = createHarness()
    deps.send
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })

    await dom.testBtn.fire('click')

    expect(deps.send.mock.calls.map(([message]) => message.type)).toEqual(['setConfig', 'testRemote'])
    expect(status.at(-1)).toEqual(['连接正常', 'ok'])
  })

  it('saves the sync form when auto push toggles and schedules a push', async () => {
    const { dom, deps } = createHarness()
    deps.send.mockResolvedValueOnce({ ok: true, data: { sync: { autoPush: true } } })
    dom.autoPush.checked = true

    await dom.autoPush.fire('change')

    expect(deps.send.mock.calls[0][0].type).toBe('setConfig')
    expect(deps.onSyncFormChanged).toHaveBeenCalledOnce()
  })

  it('switches the language through config and the page renderer', async () => {
    const { dom, deps, getConfig } = createHarness({ config: { sync: {}, ui: { language: 'zh' } } })
    dom.languageSelect.value = 'en'

    await dom.languageSelect.fire('change')

    expect(getConfig().ui).toEqual({ language: 'en' })
    expect(deps.saveConfig).toHaveBeenCalledWith({ ui: { language: 'en' } })
    expect(deps.applyLanguage).toHaveBeenCalledOnce()
  })
})
