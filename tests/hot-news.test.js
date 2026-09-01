import { describe, expect, it, vi } from 'vitest'
import { createHotNewsClient, getHotApiUrl, parseHotApiData } from '../hot-news.js'

const successResponse = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ data })
})

describe('hot news client', () => {
  it('解析并过滤无效热搜项', () => {
    expect(parseHotApiData({ data: [{ title: ' 新闻 ', link: ' https://example.com ' }, { title: '', link: 'x' }] })).toEqual([
      { title: '新闻', link: 'https://example.com' }
    ])
    expect(getHotApiUrl('微博热搜')).toContain(encodeURIComponent('微博热搜'))
  })

  it('复用同源并发请求并缓存结果', async () => {
    let resolveFetch
    const fetchFn = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    const client = createHotNewsClient({ fetchFn })

    const first = client.load('知乎')
    const second = client.load('知乎')
    expect(fetchFn).toHaveBeenCalledTimes(1)

    resolveFetch(successResponse([{ title: 'A', link: 'https://a.example' }]))
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ title: 'A', link: 'https://a.example' }],
      [{ title: 'A', link: 'https://a.example' }]
    ])

    await client.load('知乎')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('按配置延时重试临时网络错误', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(successResponse([{ title: 'A', link: 'https://a.example' }]))
    const delays = []
    const client = createHotNewsClient({
      fetchFn,
      retryDelaysMs: [25],
      setTimeoutFn: (callback, milliseconds) => {
        if (milliseconds === 25) delays.push(milliseconds)
        callback()
        return 1
      },
      clearTimeoutFn: vi.fn()
    })

    await expect(client.load('知乎')).resolves.toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([25])
  })

  it('不重试不可恢复的 4xx 响应', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    const client = createHotNewsClient({ fetchFn, retryDelaysMs: [1, 2] })

    await expect(client.load('知乎')).rejects.toThrow('HTTP 404')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('强制刷新失败后返回旧缓存', async () => {
    const oldItems = [{ title: '旧数据', link: 'https://old.example' }]
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(successResponse(oldItems))
      .mockRejectedValueOnce(new TypeError('offline'))
    const client = createHotNewsClient({ fetchFn, retryDelaysMs: [] })

    await client.load('知乎')
    await expect(client.load('知乎', { forceRefresh: true })).resolves.toEqual(oldItems)
  })

  it('失效缓存时不破坏正在进行的请求复用', async () => {
    let resolveFetch
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve }))
      .mockResolvedValue(successResponse([{ title: 'B', link: 'https://b.example' }]))
    const client = createHotNewsClient({ fetchFn })

    const first = client.load('知乎')
    client.invalidate('知乎')
    const second = client.load('知乎', { forceRefresh: true })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    resolveFetch(successResponse([{ title: 'A', link: 'https://a.example' }]))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    await expect(client.load('知乎')).resolves.toEqual([{ title: 'B', link: 'https://b.example' }])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
