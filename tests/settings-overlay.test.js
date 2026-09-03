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
    expect(html).toContain('name="theme" value="amber-neumorphic"')
    expect(html).toContain('name="theme" value="neo-brutalism"')
    expect(html).toContain('aria-live="polite"')

    const css = readStyles()
    expect(css).toMatch(/\.theme-options\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s)
    expect(css).toContain("html[data-theme='neo-brutalism']")

    const script = readFileSync(new URL('../newtab.js', import.meta.url), 'utf8')
    expect(script).toContain("theme_cyber_dark: '赛博深色'")
    expect(script).toContain("theme_amber_neumorphic: 'Soft Neumorphic'")
    expect(script).toContain("theme_neo_brutalism: '新粗野'")
    expect(script).toContain("theme_neo_brutalism: 'Neo-Brutalism'")
    expect(script).toContain("'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'")
    expect(script).toContain("requestAnimationFrame(() => $('#settingsTabAppearance')?.focus())")
    expect(script).toContain('requestAnimationFrame(() => openBtn.focus())')
    expect(script.match(/querySelectorAll\('\[data-i18n-aria-label\]'\)/)?.index).toBeLessThan(script.indexOf('const canAutoPush'))
  })
})
