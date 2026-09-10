import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 读取样式文件并断言设置弹窗使用固定定位。
 */
const readStyles = () => readFileSync(new URL('../newtab.css', import.meta.url), 'utf8')

describe('settings overlay styles', () => {
  it('uses fixed positioning to avoid scroll offset', () => {
    const css = readStyles()
    const match = css.match(/\.settings-overlay\s*\{[^}]*\}/)

    expect(match).not.toBeNull()
    expect(match?.[0]).toMatch(/position:\s*fixed/)
  })

  it('offers accessible appearance tabs and theme radios', () => {
    const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')

    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-tab="appearance"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('name="theme" value="cyber-dark"')
    expect(html).not.toContain('amber-neumorphic')
    expect(html).toContain('name="theme" value="neo-brutalism"')
    expect(html).toContain('aria-live="polite"')

    const css = readStyles()
    expect(css).toMatch(/\.theme-options\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s)
    expect(css).toContain("html[data-theme='neo-brutalism']")

    const script = readFileSync(new URL('../newtab.js', import.meta.url), 'utf8')
    // 词典已迁到 i18n.js，主题文案在那边断言。
    const dict = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8')
    expect(dict).toContain("theme_cyber_dark: '赛博深色'")
    expect(dict).not.toContain('theme_amber_neumorphic')
    expect(dict).toContain("theme_neo_brutalism: '新粗野'")
    expect(dict).toContain("theme_neo_brutalism: 'Neo-Brutalism'")
    expect(script).toContain("'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'")
    expect(script).toContain("requestAnimationFrame(() => $('#settingsTabAppearance')?.focus())")
    expect(script).toContain('requestAnimationFrame(() => openBtn.focus())')
    // 四类 data-i18n* 标注都由 i18n.js 处理（原先这条断言的是 newtab.js 里的文本位置）。
    for (const [selector, attribute] of [
      ['[data-i18n]', 'textContent'],
      ['[data-i18n-placeholder]', 'placeholder'],
      ['[data-i18n-aria-label]', 'aria-label'],
      ['[data-i18n-title]', 'title']
    ]) {
      expect(dict).toContain(`writeAll('${selector}', '${attribute}')`)
    }
  })
})
