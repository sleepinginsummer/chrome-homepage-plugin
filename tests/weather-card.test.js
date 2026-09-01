import { describe, expect, it } from 'vitest'
import { getWeatherKind, renderWeatherCardHtml, renderWeatherIcon, updateWeatherCardDom } from '../weather-card.js'

describe('weather card', () => {
  it('识别不同天气视觉类型', () => {
    expect(getWeatherKind('晴')).toBe('clear')
    expect(getWeatherKind('多云')).toBe('cloudy')
    expect(getWeatherKind('雷阵雨')).toBe('storm')
    expect(getWeatherKind('小雨')).toBe('rain')
    expect(getWeatherKind('大雪')).toBe('snow')
    expect(getWeatherKind('雾')).toBe('fog')
  })

  it.each([
    ['晴', 'clear-day'],
    ['多云', 'cloudy'],
    ['小雨', 'rain'],
    ['雷阵雨', 'thunderstorms'],
    ['大雪', 'snow'],
    ['雾', 'fog']
  ])('为 %s 渲染本地 Meteocons 动画和静态降级', (condition, iconName) => {
    const html = renderWeatherIcon(condition, 'test-icon')
    expect(html).toContain(`assets/meteocons/animated/${iconName}.svg`)
    expect(html).toContain(`assets/meteocons/static/${iconName}.svg`)
    expect(html).toContain('media="(prefers-reduced-motion: reduce)"')
  })

  it('转义天气卡片标题且不创建手写粒子层', () => {
    const html = renderWeatherCardHtml({ title: '<南京天气>' }, { title: '天气', refresh: '刷新', loading: '加载中' })
    expect(html).toContain('&lt;南京天气&gt;')
    expect(html).not.toContain('<南京天气>')
    expect(html).not.toContain('weather-effect')
    expect(html).not.toContain('<i>')
  })

  it('渲染实时天气和七天预报', () => {
    const content = { innerHTML: '' }
    const updatedAt = { textContent: '' }
    const cardEl = {
      dataset: { weatherRenderToken: 'token' },
      querySelector: (selector) => selector === '[data-weather-content]' ? content : updatedAt
    }
    const forecasts = Array.from({ length: 7 }, (_, index) => ({
      date: `${index + 1}日(周${index + 1})`, condition: index === 1 ? '小雨' : '晴', temperature: '29/24', wind: '3级'
    }))

    updateWeatherCardDom({
      cardEl,
      renderToken: 'token',
      data: {
        updatedAt: '14:25',
        current: { temperature: '25.9', humidity: '90%', pm25: '29', wind: '东北风2级', windSpeed: '8km/h', condition: '晴' },
        forecasts
      },
      text: { updatedAt: '更新于', humidity: '湿度', empty: '暂无数据', error: '失败' }
    })

    expect(cardEl.dataset.weatherKind).toBe('clear')
    expect(updatedAt.textContent).toBe('更新于 14:25')
    expect(content.innerHTML.match(/class="weather-day /g)).toHaveLength(7)
    expect(content.innerHTML.match(/<picture /g)).toHaveLength(8)
    expect(content.innerHTML).not.toContain('weather-day-effect')
    expect(content.innerHTML).toContain('25.9')
  })
})
