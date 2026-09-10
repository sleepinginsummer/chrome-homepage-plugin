import { DEFAULT_THEME, STORAGE_KEY, normalizeThemeId } from './config-store.js'

export const THEME_MIRROR_KEY = 'chromeHomeTheme'
export const LIGHT_THEME_IDS = new Set(['neo-brutalism'])

const getDocument = () => (typeof document === 'undefined' ? null : document)
const getMirrorStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

export const readThemeMirror = (storage = getMirrorStorage()) => {
  try {
    return normalizeThemeId(storage?.getItem(THEME_MIRROR_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

export const writeThemeMirror = (theme, storage = getMirrorStorage()) => {
  const normalized = normalizeThemeId(theme)
  try {
    storage?.setItem(THEME_MIRROR_KEY, normalized)
  } catch {
    // The config remains the source of truth when localStorage is unavailable.
  }
  return normalized
}

export const applyTheme = (theme, { documentRef = getDocument(), mirrorStorage = getMirrorStorage() } = {}) => {
  const normalized = writeThemeMirror(theme, mirrorStorage)
  const root = documentRef?.documentElement
  if (root) {
    root.dataset.theme = normalized
    root.style.colorScheme = LIGHT_THEME_IDS.has(normalized) ? 'light' : 'dark'
  }
  return normalized
}

export const getConfigTheme = (config) => normalizeThemeId(config?.ui?.theme)

export const bindThemeRadioNavigation = (root = getDocument()) => {
  const inputs = [...(root?.querySelectorAll?.('input[name="theme"]') || [])]
  const keyOffsets = {
    ArrowDown: 1,
    ArrowRight: 1,
    ArrowUp: -1,
    ArrowLeft: -1
  }

  const handleKeydown = (event) => {
    const currentIndex = inputs.indexOf(event.currentTarget)
    if (currentIndex < 0 || !(event.key in keyOffsets)) return

    event.preventDefault()
    const nextIndex = (currentIndex + keyOffsets[event.key] + inputs.length) % inputs.length
    const nextInput = inputs[nextIndex]
    if (!nextInput.checked) nextInput.click()
    nextInput.focus()
  }

  inputs.forEach((input) => input.addEventListener('keydown', handleKeydown))
  return () => inputs.forEach((input) => input.removeEventListener('keydown', handleKeydown))
}

export const subscribeToThemeChanges = (chromeApi, onThemeChange) => {
  const changes = chromeApi?.storage?.onChanged
  if (!changes?.addListener || typeof onThemeChange !== 'function') return () => {}

  const listener = (changeSet, areaName) => {
    if (areaName !== 'local') return
    const nextConfig = changeSet?.[STORAGE_KEY]?.newValue
    if (!nextConfig) return
    onThemeChange(getConfigTheme(nextConfig), nextConfig)
  }

  changes.addListener(listener)
  return () => changes.removeListener?.(listener)
}

export const persistThemeSelection = async ({ currentTheme, nextTheme, saveTheme, apply = applyTheme }) => {
  const previous = normalizeThemeId(currentTheme)
  const selected = normalizeThemeId(nextTheme)
  apply(selected)

  try {
    await saveTheme(selected)
    return { ok: true, theme: selected }
  } catch (error) {
    apply(previous)
    return { ok: false, theme: previous, error }
  }
}
