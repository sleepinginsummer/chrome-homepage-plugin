import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { DEFAULT_THEME, normalizeThemeId } from '../config-store.js'
import { LIGHT_THEME_IDS, THEME_MIRROR_KEY, applyTheme, bindThemeRadioNavigation, persistThemeSelection, readThemeMirror, subscribeToThemeChanges } from '../theme.js'

const createMirror = (initial = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value))
  }
}

describe('theme runtime', () => {
  it('normalizes unknown theme ids to the cyber default', () => {
    expect(normalizeThemeId('amber-neumorphic')).toBe('amber-neumorphic')
    expect(normalizeThemeId('neo-brutalism')).toBe('neo-brutalism')
    expect(normalizeThemeId('unknown-theme')).toBe(DEFAULT_THEME)
  })

  it('applies the neo-brutalism theme to the root and mirrors it for first paint', () => {
    const mirrorStorage = createMirror()
    const documentRef = { documentElement: { dataset: {}, style: {} } }

    expect(applyTheme('neo-brutalism', { documentRef, mirrorStorage })).toBe('neo-brutalism')
    expect(documentRef.documentElement.dataset.theme).toBe('neo-brutalism')
    expect(documentRef.documentElement.style.colorScheme).toBe('light')
    expect(mirrorStorage.setItem).toHaveBeenCalledWith(THEME_MIRROR_KEY, 'neo-brutalism')
    expect(readThemeMirror(mirrorStorage)).toBe('neo-brutalism')
    expect(LIGHT_THEME_IDS).toEqual(new Set(['amber-neumorphic', 'neo-brutalism']))
  })

  it('bootstraps the mirrored theme before page modules run', () => {
    const bootstrap = readFileSync(new URL('../theme-bootstrap.js', import.meta.url), 'utf8')
    const documentRef = { documentElement: { dataset: {}, style: {} } }
    const localStorageRef = { getItem: vi.fn(() => 'neo-brutalism') }

    runInNewContext(bootstrap, { document: documentRef, localStorage: localStorageRef, Set })

    expect(documentRef.documentElement.dataset.theme).toBe('neo-brutalism')
    expect(documentRef.documentElement.style.colorScheme).toBe('light')
  })

  it('applies and persists a valid optimistic selection', async () => {
    const apply = vi.fn()
    const saveTheme = vi.fn().mockResolvedValue(undefined)

    const result = await persistThemeSelection({
      currentTheme: 'cyber-dark',
      nextTheme: 'amber-neumorphic',
      saveTheme,
      apply
    })

    expect(result).toEqual({ ok: true, theme: 'amber-neumorphic' })
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('amber-neumorphic')
    expect(saveTheme).toHaveBeenCalledWith('amber-neumorphic')
  })

  it('subscribes only to local config theme changes', () => {
    let listener
    const chromeApi = {
      storage: {
        onChanged: {
          addListener: vi.fn((next) => { listener = next }),
          removeListener: vi.fn()
        }
      }
    }
    const onThemeChange = vi.fn()
    const unsubscribe = subscribeToThemeChanges(chromeApi, onThemeChange)

    listener({ chromeHomeConfig: { newValue: { ui: { theme: 'amber-neumorphic' } } } }, 'sync')
    expect(onThemeChange).not.toHaveBeenCalled()

    listener({ chromeHomeConfig: { newValue: { ui: { theme: 'amber-neumorphic' } } } }, 'local')
    expect(onThemeChange).toHaveBeenCalledWith('amber-neumorphic', { ui: { theme: 'amber-neumorphic' } })

    unsubscribe()
    expect(chromeApi.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })

  it('rolls back an optimistic theme when persistence fails', async () => {
    const apply = vi.fn()
    const result = await persistThemeSelection({
      currentTheme: 'cyber-dark',
      nextTheme: 'amber-neumorphic',
      saveTheme: vi.fn().mockRejectedValue(new Error('storage failed')),
      apply
    })

    expect(result.ok).toBe(false)
    expect(result.theme).toBe('cyber-dark')
    expect(apply.mock.calls.map(([theme]) => theme)).toEqual(['amber-neumorphic', 'cyber-dark'])
  })

  it('moves native theme radios with arrow keys and wraps at the ends', () => {
    const handlers = new Map()
    const inputs = ['cyber-dark', 'amber-neumorphic', 'neo-brutalism'].map((value) => ({
      value,
      checked: value === 'cyber-dark',
      addEventListener: vi.fn((_type, handler) => handlers.set(value, handler)),
      removeEventListener: vi.fn(),
      click: vi.fn(function () {
        inputs.forEach((input) => { input.checked = input === this })
      }),
      focus: vi.fn()
    }))
    const root = { querySelectorAll: vi.fn(() => inputs) }
    const cleanup = bindThemeRadioNavigation(root)
    const preventDefault = vi.fn()

    handlers.get('cyber-dark')({ key: 'ArrowLeft', currentTarget: inputs[0], preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(inputs[2].click).toHaveBeenCalledOnce()
    expect(inputs[2].focus).toHaveBeenCalledOnce()
    expect(inputs[2].checked).toBe(true)

    cleanup()
    inputs.forEach((input) => expect(input.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function)))
  })
})
