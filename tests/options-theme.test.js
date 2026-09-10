import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../options.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../options.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../options.css', import.meta.url), 'utf8')

describe('options theme controls', () => {
  it('offers the same two persisted theme choices', () => {
    expect(html).toContain('name="theme" value="cyber-dark"')
    expect(html).not.toContain('amber-neumorphic')
    expect(html).toContain('name="theme" value="neo-brutalism"')
    expect(html).toContain('Neo-Brutalism')
    expect(html).toContain('id="themeStatus"')
    expect(script).toContain('persistThemeSelection')
    expect(script).toContain('subscribeToThemeChanges')
    expect(css).not.toContain("html[data-theme='amber-neumorphic']")
    expect(css).toContain("html[data-theme='neo-brutalism']")
    expect(css).toMatch(/\.theme-options\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s)
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
})
