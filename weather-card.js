const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

export const getWeatherKind = (condition) => {
  const text = String(condition || '')
  if (/雷|电/.test(text)) return 'storm'
  if (/雪|冰雹/.test(text)) return 'snow'
  if (/雨/.test(text)) return 'rain'
  if (/雾|霾|沙|尘/.test(text)) return 'fog'
  if (/晴/.test(text)) return 'clear'
  return 'cloudy'
}

const WEATHER_ICON_FILES = {
  clear: 'clear-day',
  cloudy: 'cloudy',
  rain: 'rain',
  snow: 'snow',
  storm: 'thunderstorms',
  fog: 'fog'
}

export const renderWeatherIcon = (condition, className = 'weather-icon') => {
  const kind = getWeatherKind(condition)
  const iconName = WEATHER_ICON_FILES[kind]
  const staticSource = `assets/meteocons/static/${iconName}.svg`
  // 晴天太阳保持静止，避免持续旋转分散对温度信息的注意力。
  const animatedSource = kind === 'clear' ? staticSource : `assets/meteocons/animated/${iconName}.svg`
  return `
    <picture class="${className}">
      <source media="(prefers-reduced-motion: reduce)" srcset="${staticSource}">
      <img class="weather-icon-asset" src="${animatedSource}" alt="" aria-hidden="true" decoding="async" draggable="false">
    </picture>
  `
}

const getForecastLabel = (date) => {
  const text = String(date || '')
  return text.match(/\((.+?)\)/)?.[1] || text
}

export const renderWeatherCardHtml = (card, text) => `
  <div class="weather-card">
    <button class="weather-refresh" type="button" aria-label="${escapeHtml(text.refresh)}" data-weather-action="refresh">
      <svg class="weather-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 0 1-15.3 6.4"></path><path d="M3 12a9 9 0 0 1 15.3-6.4"></path>
        <polyline points="3 16 5.7 18.4 6.6 15"></polyline><polyline points="21 8 18.3 5.6 17.4 9"></polyline>
      </svg>
    </button>
    <div class="card-head-row">
      <div class="card-head-title">${escapeHtml(card?.title || text.title)}</div>
      <div class="card-head-time" data-weather-updated-at></div>
    </div>
    <div class="weather-content" data-weather-content>
      <div class="weather-empty">${escapeHtml(text.loading)}</div>
    </div>
  </div>
`

export const updateWeatherCardDom = ({ cardEl, renderToken, data, errorText, text }) => {
  if (!cardEl || cardEl.dataset.weatherRenderToken !== renderToken) return
  const contentEl = cardEl.querySelector('[data-weather-content]')
  const updatedAtEl = cardEl.querySelector('[data-weather-updated-at]')
  if (!contentEl) return

  if (errorText || !data) {
    if (updatedAtEl) updatedAtEl.textContent = ''
    contentEl.innerHTML = `<div class="weather-empty">${escapeHtml(errorText || text.error)}</div>`
    return
  }

  const current = data.current || {}
  const currentKind = getWeatherKind(current.condition)
  cardEl.dataset.weatherKind = currentKind
  if (updatedAtEl) updatedAtEl.textContent = `${text.updatedAt} ${data.updatedAt || '--'}`

  const forecastHtml = (data.forecasts || []).slice(0, 7).map((item) => {
    const kind = getWeatherKind(item.condition)
    return `
      <div class="weather-day weather-day-${kind}" title="${escapeHtml(`${item.condition} · ${item.wind}`)}">
        <div class="weather-day-label">${escapeHtml(getForecastLabel(item.date))}</div>
        ${renderWeatherIcon(item.condition, 'weather-day-icon')}
        <div class="weather-day-condition">${escapeHtml(item.condition)}</div>
        <div class="weather-day-temp">${escapeHtml(item.temperature || '--')}°</div>
      </div>
    `
  }).join('')

  contentEl.innerHTML = `
    <div class="weather-current">
      <div class="weather-current-icon">${renderWeatherIcon(current.condition, 'weather-main-icon')}</div>
      <div class="weather-temperature">${escapeHtml(current.temperature || '--')}<span>°</span></div>
      <div class="weather-current-copy">
        <div class="weather-condition">${escapeHtml(current.condition || text.empty)}</div>
        <div class="weather-wind">${escapeHtml(current.wind || '--')} · ${escapeHtml(current.windSpeed || '--')}</div>
      </div>
      <div class="weather-metrics">
        <div><span>${escapeHtml(text.humidity)}</span><strong>${escapeHtml(current.humidity || '--')}</strong></div>
        <div><span>PM2.5</span><strong>${escapeHtml(current.pm25 || '--')}</strong></div>
      </div>
    </div>
    <div class="weather-forecast">${forecastHtml}</div>
  `
}
