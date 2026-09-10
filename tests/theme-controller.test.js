import { describe, expect, it, vi } from 'vitest'
import { initThemeController } from '../theme-controller.js'
import { STORAGE_KEY } from '../config-store.js'

/**
 * 构造最小可用的主题面板 DOM 桩（仓库不引入 jsdom，沿用 theme.test.js 的手写桩风格）。
 */
const createThemePanel = ({ theme = 'cyber-dark' } = {}) => {
  const status = { textContent: '', dataset: {} }
  const inputs = ['cyber-dark', 'neo-brutalism'].map((value) => {
    const listeners = new Map()
    const label = { active: null }
    return {
      value,
      checked: value === theme,
      label,
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type) => listeners.delete(type)),
      closest: vi.fn(() => ({
        classList: { toggle: (_name, on) => { label.active = on } }
      })),
      click: vi.fn(),
      focus: vi.fn(),
      fire: (type, event = {}) => listeners.get(type)?.({ preventDefault: vi.fn(), currentTarget: null, ...event })
    }
  })

  return {
    inputs,
    status,
    root: {
      querySelectorAll: vi.fn(() => inputs),
      querySelector: vi.fn((selector) => (selector === '#themeStatus' ? status : null))
    }
  }
}

const createChromeStub = () => {
  let listener = null
  return {
    api: {
      storage: {
        onChanged: {
          addListener: vi.fn((next) => { listener = next }),
          removeListener: vi.fn()
        }
      }
    },
    emitChange: (nextConfig, areaName = 'local') => listener?.({ [STORAGE_KEY]: { newValue: nextConfig } }, areaName)
  }
}

const createController = ({
  panel,
  chrome,
  config = { ui: { theme: 'cyber-dark' } },
  saveTheme = vi.fn().mockResolvedValue({}),
  apply = vi.fn(),
  getSaveErrorText
} = {}) => {
  const onConfigChange = vi.fn()
  const controller = initThemeController({
    chromeApi: chrome.api,
    root: panel.root,
    getConfig: () => config,
    saveTheme,
    onConfigChange,
    getSaveErrorText,
    apply
  })
  return { controller, config, saveTheme, apply, onConfigChange }
}

describe('theme controller', () => {
  it('applies the configured theme to the radios on demand', () => {
    const panel = createThemePanel()
    const { controller, apply } = createController({
      panel,
      chrome: createChromeStub(),
      config: { ui: { theme: 'neo-brutalism' } }
    })

    expect(controller.applyCurrent()).toBe('neo-brutalism')

    expect(apply).toHaveBeenCalledWith('neo-brutalism')
    expect(panel.inputs.map((input) => input.checked)).toEqual([false, true])
    expect(panel.inputs[1].label.active).toBe(true)
    expect(panel.inputs[0].label.active).toBe(false)
  })

  it('persists the selected theme and clears the status text', async () => {
    const panel = createThemePanel()
    const saveTheme = vi.fn().mockResolvedValue({})
    createController({ panel, chrome: createChromeStub(), saveTheme })

    panel.inputs[1].checked = true
    await panel.inputs[1].fire('change')

    expect(saveTheme).toHaveBeenCalledWith('neo-brutalism')
    expect(panel.status.textContent).toBe('')
    expect(panel.status.dataset.kind).toBe('info')
  })

  it('rolls back the theme and reports a localized failure message', async () => {
    const panel = createThemePanel()
    const apply = vi.fn()
    createController({
      panel,
      chrome: createChromeStub(),
      apply,
      saveTheme: vi.fn().mockRejectedValue(new Error('storage failed')),
      getSaveErrorText: () => '保存失败文案'
    })

    panel.inputs[1].checked = true
    await panel.inputs[1].fire('change')

    // 乐观应用新主题，失败后回退到原主题。
    expect(apply.mock.calls.map(([theme]) => theme)).toEqual(['neo-brutalism', 'cyber-dark'])
    expect(panel.inputs[1].checked).toBe(false)
    expect(panel.inputs[0].checked).toBe(true)
    expect(panel.status.textContent).toBe('保存失败文案')
    expect(panel.status.dataset.kind).toBe('error')
  })

  it('moves native theme radios with arrow keys and wraps at the ends', () => {
    const panel = createThemePanel()
    const { controller } = createController({ panel, chrome: createChromeStub() })
    const preventDefault = vi.fn()

    panel.inputs[0].fire('keydown', { key: 'ArrowLeft', currentTarget: panel.inputs[0], preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(panel.inputs[1].click).toHaveBeenCalledOnce()
    expect(panel.inputs[1].focus).toHaveBeenCalledOnce()

    // 非方向键不拦截。
    panel.inputs[0].fire('keydown', { key: 'Tab', currentTarget: panel.inputs[0], preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()

    expect(controller.destroy).toBeTypeOf('function')
  })

  it('follows theme changes written by other pages and ignores the sync area', () => {
    const panel = createThemePanel()
    const chrome = createChromeStub()
    const apply = vi.fn()
    const { onConfigChange } = createController({ panel, chrome, apply })

    chrome.emitChange({ ui: { theme: 'neo-brutalism' } }, 'sync')
    expect(apply).not.toHaveBeenCalled()

    chrome.emitChange({ ui: { theme: 'neo-brutalism' } })
    expect(apply).toHaveBeenCalledWith('neo-brutalism')
    expect(panel.inputs[1].checked).toBe(true)
    expect(onConfigChange).toHaveBeenCalledWith('neo-brutalism', { ui: { theme: 'neo-brutalism' } })
  })

  it('unbinds listeners on destroy', () => {
    const panel = createThemePanel()
    const chrome = createChromeStub()
    const { controller } = createController({ panel, chrome })

    controller.destroy()

    for (const input of panel.inputs) {
      expect(input.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
      expect(input.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    }
    expect(chrome.api.storage.onChanged.removeListener).toHaveBeenCalledOnce()
  })
})
