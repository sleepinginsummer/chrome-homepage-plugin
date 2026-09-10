import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255)
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ))
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
}

const contrastRatio = (foreground, background) => {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('shared theme styles', () => {
  it('loads one shared token source before page-specific styles', () => {
    const newtabHtml = read('newtab.html')
    const optionsHtml = read('options.html')
    const packageScript = read('scripts/package.mjs')

    expect(newtabHtml.indexOf('theme-tokens.css')).toBeLessThan(newtabHtml.indexOf('newtab.css'))
    expect(optionsHtml.indexOf('theme-tokens.css')).toBeLessThan(optionsHtml.indexOf('options.css'))
    expect(packageScript).toContain("'theme-tokens.css'")
  })

})

describe('concrete blue-red neo-brutalism palette', () => {
  it('defines the agreed palette and zero-blur hard-shadow vocabulary', () => {
    const tokens = read('theme-tokens.css')

    expect(tokens).toContain("html[data-theme='neo-brutalism']")
    expect(tokens).toContain('--brutal-background: #e4e7e3')
    expect(tokens).toContain('--brutal-surface: #f5f6f3')
    expect(tokens).toContain('--brutal-surface-muted: #cdd3ce')
    expect(tokens).toContain('--brutal-ink: #171717')
    expect(tokens).toContain('--brutal-primary: #315efb')
    expect(tokens).toContain('--brutal-primary-hover: #2449cc')
    expect(tokens).toContain('--brutal-primary-active: #1939a6')
    expect(tokens).toContain('--brutal-accent: #ff6b5e')
    expect(tokens).toContain('--brutal-shadow-panel: 6px 6px 0 var(--brutal-ink)')
    expect(tokens).toContain('--brutal-shadow-control: 3px 3px 0 var(--brutal-ink)')
  })

  it('removes decorative patterns, gradients, blur, and glass inside the new theme scope', () => {
    const newtabCss = read('newtab.css')
    const optionsCss = read('options.css')
    const weatherCss = read('weather-card.css')
    // 只取「选择器里带新粗野主题」的规则体，避免用首现位置切片把后面的基础样式也算进来。
    const scopedRules = (css) => [...css.matchAll(/html\[data-theme='neo-brutalism'\][^{]*\{([^}]*)\}/gs)]
      .map((match) => match[1])
      .join('\n')
    const scopedCss = [newtabCss, optionsCss, weatherCss].map(scopedRules).join('\n')

    expect(newtabCss).toMatch(/html\[data-theme='neo-brutalism'\]\s+\.grid-bg\s*\{[^}]*background-image:\s*none/s)
    expect(optionsCss).toMatch(/html\[data-theme='neo-brutalism'\]\s+body\s*\{[^}]*background-image:\s*none/s)
    expect(scopedCss).not.toMatch(/(?:linear|radial|conic)-gradient\(/)
    expect(scopedCss).not.toMatch(/backdrop-filter:\s*blur/)
    expect(scopedCss).not.toMatch(/filter:\s*blur/)
    expect(newtabCss).toMatch(/html\[data-theme='neo-brutalism'\]\s+\.hero-block\s*\{[^}]*border:\s*3px solid var\(--brutal-ink\)[^}]*box-shadow:\s*var\(--brutal-shadow-panel\)/s)
    expect(weatherCss).toMatch(/html\[data-theme='neo-brutalism'\]\s+\.card\.card-weather\s*\{[^}]*border:\s*3px solid var\(--brutal-ink\)/s)
  })

  it('keeps planned new theme text pairings above WCAG AA', () => {
    const pairs = [
      ['#171717', '#e4e7e3'],
      ['#3f4641', '#e4e7e3'],
      ['#171717', '#f5f6f3'],
      ['#3f4641', '#f5f6f3'],
      ['#ffffff', '#315efb'],
      ['#ffffff', '#2449cc'],
      ['#ffffff', '#1939a6'],
      ['#171717', '#ff6b5e'],
      ['#126a3a', '#f5f6f3'],
      ['#a9271e', '#f5f6f3']
    ]

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('centers the primary canvas without colliding with the fixed history lane', () => {
    const newtabCss = read('newtab.css')

    expect(newtabCss).toMatch(/html\[data-theme='neo-brutalism'\]\s+\.content-container\s*\{[^}]*max-width:\s*min\(1240px, calc\(100% - 520px\)\)[^}]*margin-right:\s*0/s)
    expect(newtabCss).toMatch(/@media \(max-width:\s*1319px\)[\s\S]*?\.content-container\s*\{[^}]*max-width:\s*1240px[^}]*padding-top:\s*76px/s)
  })

  it('keeps the history sidebar visibility independent of the theme', () => {
    const newtabCss = read('newtab.css')

    // 主题只改外观：不管哪个主题，隐藏历史侧栏的规则都必须落在同一个 640px 断点里。
    const hideRules = [...newtabCss.matchAll(/\.history-sidebar\s*\{[^}]*?display:\s*none[^}]*?\}/gs)]
    expect(hideRules.length).toBeGreaterThan(0)

    for (const rule of hideRules) {
      const mediaStart = newtabCss.lastIndexOf('@media', rule.index)
      expect(newtabCss.slice(mediaStart, rule.index)).toMatch(/@media \(max-width:\s*640px\)/)
    }
  })
})
