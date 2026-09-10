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
    expect(normalizeThemeId('amber-neumorphic')).toBe(DEFAULT_THEME)
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
    expect(LIGHT_THEME_IDS).toEqual(new Set(['neo-brutalism']))
  })

  it.each([
    ['neo-brutalism', 'neo-brutalism', 'light'],
    ['amber-neumorphic', 'cyber-dark', 'dark']
  ])('bootstraps cached %s as %s before page modules run', (cached, expected, colorScheme) => {
    const bootstrap = readFileSync(new URL('../theme-bootstrap.js', import.meta.url), 'utf8')
    const documentRef = { documentElement: { dataset: {}, style: {} } }
    const localStorageRef = { getItem: vi.fn(() => cached) }

    runInNewContext(bootstrap, { document: documentRef, localStorage: localStorageRef, Set })

    expect(documentRef.documentElement.dataset.theme).toBe(expected)
    expect(documentRef.documentElement.style.colorScheme).toBe(colorScheme)
  })

  it('applies and persists a valid optimistic selection', async () => {
    const apply = vi.fn()
    const saveTheme = vi.fn().mockResolvedValue(undefined)

    const result = await persistThemeSelection({
      currentTheme: 'cyber-dark',
      nextTheme: 'neo-brutalism',
      saveTheme,
      apply
    })

    expect(result).toEqual({ ok: true, theme: 'neo-brutalism' })
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('neo-brutalism')
    expect(saveTheme).toHaveBeenCalledWith('neo-brutalism')
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

    listener({ chromeHomeConfig: { newValue: { ui: { theme: 'neo-brutalism' } } } }, 'sync')
    expect(onThemeChange).not.toHaveBeenCalled()

    listener({ chromeHomeConfig: { newValue: { ui: { theme: 'neo-brutalism' } } } }, 'local')
    expect(onThemeChange).toHaveBeenCalledWith('neo-brutalism', { ui: { theme: 'neo-brutalism' } })

    unsubscribe()
    expect(chromeApi.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })

  it('rolls back an optimistic theme when persistence fails', async () => {
    const apply = vi.fn()
    const result = await persistThemeSelection({
      currentTheme: 'cyber-dark',
      nextTheme: 'neo-brutalism',
      saveTheme: vi.fn().mockRejectedValue(new Error('storage failed')),
      apply
    })

    expect(result.ok).toBe(false)
    expect(result.theme).toBe('cyber-dark')
    expect(apply.mock.calls.map(([theme]) => theme)).toEqual(['neo-brutalism', 'cyber-dark'])
  })

  it('moves native theme radios with arrow keys and wraps at the ends', () => {
    const handlers = new Map()
    const inputs = ['cyber-dark', 'neo-brutalism'].map((value) => ({
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
    expect(inputs[1].click).toHaveBeenCalledOnce()
    expect(inputs[1].focus).toHaveBeenCalledOnce()
    expect(inputs[1].checked).toBe(true)

    cleanup()
    inputs.forEach((input) => expect(input.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function)))
  })
})
