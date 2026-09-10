/**
 * @fileoverview
 * 主题选择控制器：把主题单选 UI、键盘导航、持久化与跨页面同步收敛到一处。
 *
 * 设计目标：
 * - newtab 与 options 都有一份主题选择面板，逻辑只保留一份，避免两边行为漂移。
 * - 纯逻辑（应用/回退/订阅）留在 theme.js，这里只负责把 UI 与配置读写接起来。
 * - 配置读写方式由页面注入（页面走 send，出错由页面决定），控制器不直接碰 storage。
 */

import { applyTheme, getConfigTheme, persistThemeSelection, subscribeToThemeChanges } from './theme.js'

const THEME_RADIO_SELECTOR = 'input[name="theme"]'
const THEME_STATUS_SELECTOR = '#themeStatus'

const THEME_KEY_OFFSETS = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1
}

/**
 * 单选组的键盘导航：方向键在选项间循环移动并即时切换（Home/End 不在本组支持范围内）。
 */
const bindRadioKeyNavigation = (inputs) => {
  const handleKeydown = (event) => {
    const currentIndex = inputs.indexOf(event.currentTarget)
    if (currentIndex < 0 || !(event.key in THEME_KEY_OFFSETS)) return

    event.preventDefault()
    const nextIndex = (currentIndex + THEME_KEY_OFFSETS[event.key] + inputs.length) % inputs.length
    const nextInput = inputs[nextIndex]
    if (!nextInput.checked) nextInput.click()
    nextInput.focus()
  }

  inputs.forEach((input) => input.addEventListener('keydown', handleKeydown))
  return () => inputs.forEach((input) => input.removeEventListener('keydown', handleKeydown))
}

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 初始化主题控制器。
 *
 * @param {object} options
 * @param {typeof chrome} options.chromeApi Chrome 扩展 API（用于订阅 storage 变更）。
 * @param {object} [options.root=document] 承载主题 UI 的根节点。
 * @param {function(): object} options.getConfig 读取当前页面持有的配置。
 * @param {function(string): Promise<object>} options.saveTheme 持久化主题，失败时抛错。
 * @param {function(string, object)} [options.onConfigChange] 其他页面改动配置后的回调，负责合并本页状态。
 * @param {function(): string} [options.getSaveErrorText] 保存失败时的提示文案（页面负责 i18n）。
 * @param {function(string): string} [options.apply=applyTheme] 应用主题的实现，便于测试替换。
 * @returns {{ applyCurrent: function(): string, syncRadios: function(string=): string, setStatus: function(string=, string=): void, destroy: function(): void }}
 */
export const initThemeController = ({
  chromeApi,
  root = getDocument(),
  getConfig,
  saveTheme,
  onConfigChange,
  getSaveErrorText,
  apply = applyTheme
} = {}) => {
  const inputs = [...(root?.querySelectorAll?.(THEME_RADIO_SELECTOR) || [])]
  const statusEl = root?.querySelector?.(THEME_STATUS_SELECTOR)

  const setStatus = (text, kind = 'info') => {
    if (!statusEl) return
    statusEl.textContent = text || ''
    statusEl.dataset.kind = kind
  }

  /**
   * 把单选状态对齐到指定主题，未传时取当前配置里的主题。
   */
  const syncRadios = (theme = getConfigTheme(getConfig?.())) => {
    for (const input of inputs) {
      input.checked = input.value === theme
      input.closest('.theme-option')?.classList.toggle('active', input.checked)
    }
    return theme
  }

  /**
   * 用当前配置重新应用主题并对齐单选，用于配置被外部覆盖后（如远端拉取）刷新界面。
   */
  const applyCurrent = () => {
    const theme = getConfigTheme(getConfig?.())
    apply(theme)
    syncRadios(theme)
    return theme
  }

  const handleChange = async (input) => {
    if (!input.checked) return
    setStatus('')
    const result = await persistThemeSelection({
      currentTheme: getConfigTheme(getConfig?.()),
      nextTheme: input.value,
      saveTheme,
      apply
    })
    syncRadios(result.theme)
    // 重要逻辑：保存失败时已回退主题，这里只需要给出提示。
    if (!result.ok) setStatus(getSaveErrorText?.() || '主题保存失败，已恢复原主题', 'error')
  }

  const changeBindings = inputs.map((input) => {
    // 返回 Promise 便于测试直接 await；DOM 监听器会忽略返回值。
    const listener = () => handleChange(input)
    input.addEventListener('change', listener)
    return { input, listener }
  })

  const unbindKeyboard = bindRadioKeyNavigation(inputs)
  const unsubscribe = subscribeToThemeChanges(chromeApi, (theme, nextConfig) => {
    apply(theme)
    syncRadios(theme)
    onConfigChange?.(theme, nextConfig)
  })

  const destroy = () => {
    for (const { input, listener } of changeBindings) input.removeEventListener('change', listener)
    unbindKeyboard()
    unsubscribe()
  }

  return { applyCurrent, syncRadios, setStatus, destroy }
}
