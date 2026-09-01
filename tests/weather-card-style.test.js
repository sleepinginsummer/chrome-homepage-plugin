import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../newtab.css', import.meta.url), 'utf8')
const weatherCss = readFileSync(new URL('../weather-card.css', import.meta.url), 'utf8')
const weatherScript = readFileSync(new URL('../weather-card.js', import.meta.url), 'utf8')

describe('weather card styles', () => {
  it('从全局样式中拆分并由新标签页加载', () => {
    expect(html).toContain('href="weather-card.css"')
    expect(globalCss).not.toContain('.card.card-weather')
  })

  it.each(['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog'])('为 %s 天气提供大卡和预报条配色', (kind) => {
    expect(weatherCss).toContain(`[data-weather-kind="${kind}"]`)
    expect(weatherCss).toContain(`.weather-day-${kind}`)
  })

  it('删除手写粒子动画并使用静态资源支持减少动态效果', () => {
    expect(weatherCss).not.toContain('@keyframes')
    expect(weatherCss).not.toContain('.weather-effect')
    expect(weatherCss).not.toContain('.weather-day-effect')
    expect(weatherScript).toContain('prefers-reduced-motion: reduce')
    expect(weatherScript).toContain('assets/meteocons/static/')
  })

  it('包含精选 Meteocons 资源及可复现说明', () => {
    for (const variant of ['animated', 'static']) {
      for (const icon of ['clear-day', 'cloudy', 'rain', 'thunderstorms', 'snow', 'fog']) {
        expect(existsSync(new URL(`../assets/meteocons/${variant}/${icon}.svg`, import.meta.url))).toBe(true)
      }
    }
    const notice = readFileSync(new URL('../assets/meteocons/README.md', import.meta.url), 'utf8')
    expect(notice).toContain('@meteocons/svg@0.1.0')
    expect(notice).toContain('@meteocons/svg-static@0.1.0')
    expect(existsSync(new URL('../assets/meteocons/LICENSE', import.meta.url))).toBe(true)
  })
})
