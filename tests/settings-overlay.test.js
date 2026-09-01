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
})
