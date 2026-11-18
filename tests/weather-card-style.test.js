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

  it.each(['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog'])('为 %s 天气提供主卡背景和预报条配色', (kind) => {
    expect(weatherCss).toContain(`[data-weather-kind="${kind}"]`)
    expect(weatherCss).toContain(`assets/weather-backgrounds/${kind}-tile.svg`)
    expect(weatherCss).toContain(`.weather-day-${kind}`)
  })

  it('使用背景定位实现漂移并支持减少动态效果', () => {
    expect(weatherCss).not.toContain('.weather-effect')
    expect(weatherCss).not.toContain('.weather-day-effect')
    expect(weatherCss).toContain('@keyframes weather-backdrop-drift')
    expect(weatherCss).toMatch(/@keyframes weather-backdrop-drift\s*\{[^}]*background-position/s)
    expect(weatherCss).toContain('background-size: 2000px auto')
    expect(weatherCss).toContain('background-repeat: repeat-x')
    expect(weatherCss).toContain('from { background-position: 0px 50%; }')
    expect(weatherCss).toContain('to { background-position: -2000px 50%; }')
    // 漂移一圈后停：background-position 动画每帧都要重绘整张卡，不能无限跑。
    expect(weatherCss).toContain('animation: weather-backdrop-drift calc(var(--weather-drift-duration, 8s) * 25) linear 1;')
    expect(weatherCss).not.toContain('var(--weather-drift-duration, 8s) * 25) linear infinite')
    expect(weatherCss).not.toContain('infinite alternate')
    expect(weatherCss).not.toContain('translate3d(')
    expect(weatherCss).toContain('.card.card-weather::before { animation: none; }')
    expect(weatherScript).toContain('prefers-reduced-motion: reduce')
    expect(weatherScript).toContain('assets/meteocons/static/')
  })

  it.each(['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog'])('为 %s 内嵌原图并镜像拼接平铺边缘', (kind) => {
    const tile = readFileSync(new URL(`../assets/weather-backgrounds/${kind}-tile.svg`, import.meta.url), 'utf8')
    const photo = readFileSync(new URL(`../assets/weather-backgrounds/${kind}.jpg`, import.meta.url)).toString('base64')
    expect(tile).toContain('viewBox="0 0 3200 400"')
    expect(tile).toContain(`data:image/jpeg;base64,${photo}`)
    expect(tile).toContain('transform="translate(3200 0) scale(-1 1)"')
    expect(tile.match(/<use /g)).toHaveLength(2)
  })

  it('包含六张天气摄影背景及可复现说明', () => {
    for (const condition of ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog']) {
      expect(existsSync(new URL(`../assets/weather-backgrounds/${condition}.jpg`, import.meta.url))).toBe(true)
    }
    const notice = readFileSync(new URL('../assets/weather-backgrounds/README.md', import.meta.url), 'utf8')
    expect(notice).toContain('gpt-image-2')
    expect(notice).toContain('1600x400')
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
