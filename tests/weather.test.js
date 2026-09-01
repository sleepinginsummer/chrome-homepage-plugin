import { describe, expect, it, vi } from 'vitest'
import { createWeatherClient, getWeatherApiUrl, parseWeatherApiData } from '../weather.js'

const weatherText = `南京实时天气(更新时间14:25)
气温:25.9℃,湿度90%,pm2.5:29,东北风2级,风力8km/h
[1日(今天)]:阴, 气温29/24℃, 风力4-5级转3-4级
[2日(明天)]:小雨, 气温29/24℃, 风力4-5级转3-4级
[3日(后天)]:晴, 气温28/21℃, 风力3-4级
[4日(周五)]:雷阵雨, 气温28/22℃, 风力3-4级
[5日(周六)]:多云, 气温29/21℃, 风力<3级
[6日(周日)]:小雪, 气温7/0℃, 风力3-4级
[7日(周一)]:雾, 气温27/20℃, 风力<3级
!`

const successResponse = () => ({ ok: true, status: 200, json: async () => ({ data: weatherText }) })

describe('weather client', () => {
  it('解析实时天气与七天预报', () => {
    const result = parseWeatherApiData({ data: weatherText })
    expect(result.city).toBe('南京')
    expect(result.updatedAt).toBe('14:25')
    expect(result.current).toEqual({
      temperature: '25.9',
      humidity: '90%',
      pm25: '29',
      wind: '东北风2级',
      windSpeed: '8km/h',
      condition: '阴'
    })
    expect(result.forecasts).toHaveLength(7)
    expect(result.forecasts[1]).toMatchObject({ condition: '小雨', temperature: '29/24' })
  })

  it('拒绝无法识别的接口响应', () => {
    expect(() => parseWeatherApiData({ data: '!' })).toThrow('返回格式错误')
  })

  it('编码城市名称并复用同城请求缓存', async () => {
    const fetchFn = vi.fn().mockResolvedValue(successResponse())
    const client = createWeatherClient({ fetchFn })
    await client.load(' 南京 ')
    await client.load('南京')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toBe(getWeatherApiUrl('南京'))
  })

  it('延时重试临时错误，但不重试 404', async () => {
    const retryFetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(successResponse())
    const delays = []
    const retryClient = createWeatherClient({
      fetchFn: retryFetch,
      retryDelaysMs: [25],
      setTimeoutFn: (callback, milliseconds) => {
        if (milliseconds === 25) delays.push(milliseconds)
        callback()
        return 1
      },
      clearTimeoutFn: vi.fn()
    })
    await expect(retryClient.load('南京')).resolves.toMatchObject({ city: '南京' })
    expect(delays).toEqual([25])

    const failedFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const failedClient = createWeatherClient({ fetchFn: failedFetch, retryDelaysMs: [1] })
    await expect(failedClient.load('南京')).rejects.toThrow('HTTP 404')
    expect(failedFetch).toHaveBeenCalledTimes(1)
  })

  it('强制刷新失败时返回旧天气', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(successResponse()).mockRejectedValueOnce(new TypeError('offline'))
    const client = createWeatherClient({ fetchFn, retryDelaysMs: [] })
    const first = await client.load('南京')
    await expect(client.load('南京', { forceRefresh: true })).resolves.toEqual(first)
  })

  it('使用浏览器存储缓存 30 分钟', async () => {
    const records = new Map()
    const storage = {
      get: vi.fn(async (key) => ({ [key]: records.get(key) })),
      set: vi.fn(async (entries) => Object.entries(entries).forEach(([key, value]) => records.set(key, value))),
      remove: vi.fn(async (key) => records.delete(key))
    }
    let currentTime = 1000
    const firstClient = createWeatherClient({ storage, fetchFn: vi.fn().mockResolvedValue(successResponse()), now: () => currentTime })
    await firstClient.load('南京')

    const fetchFn = vi.fn().mockResolvedValue(successResponse())
    const nextClient = createWeatherClient({ storage, fetchFn, now: () => currentTime })
    currentTime += 29 * 60 * 1000
    await nextClient.load('南京')
    expect(fetchFn).not.toHaveBeenCalled()

    currentTime += 2 * 60 * 1000
    await nextClient.load('南京')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await nextClient.invalidate('南京')
    expect(storage.remove).toHaveBeenCalledWith('chromeHomeWeatherCache:南京')
    expect(records.has('chromeHomeWeatherCache:南京')).toBe(false)
  })
})
