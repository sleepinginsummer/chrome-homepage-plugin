import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCardIconCandidates, getCardInitial, loadCardIcon } from '../card-icon.js'

const globalCss = readFileSync(new URL('../newtab.css', import.meta.url), 'utf8')

afterEach(() => vi.useRealTimers())

describe('card icon', () => {
  it('透明图标使用有色底座且加载成功后隐藏首字母', () => {
    const imageRule = globalCss.match(/\.card-icon-image\s*\{[^}]+\}/)?.[0]
    expect(imageRule).toContain('background: transparent')
    expect(imageRule).not.toContain('255, 255, 255')
    expect(globalCss).toMatch(/\.card-icon\.has-image \.card-icon-fallback\s*\{[^}]*opacity:\s*0/)
  })

  it('生成英文大写或中文首字母', () => {
    expect(getCardInitial(' fast-note')).toBe('F')
    expect(getCardInitial('节点管理')).toBe('节')
    expect(getCardInitial('')).toBe('?')
  })

  it('优先自定义和高分辨率图标且不使用 Google 默认地球图', () => {
    const candidates = createCardIconCandidates({
      pageUrl: 'https://example.com/path',
      customIcon: 'https://cdn.example.com/icon.png',
      runtimeGetURL: (path) => `chrome-extension://extension-id${path}`
    })

    expect(candidates[0]).toBe('https://cdn.example.com/icon.png')
    expect(candidates[1]).toBe('https://example.com/apple-touch-icon.png')
    expect(candidates[2]).toContain('favicon.im')
    expect(candidates[3]).toContain('chrome-extension://extension-id/_favicon/')
    expect(candidates[3]).toContain('pageUrl=https%3A%2F%2Fexample.com%2Fpath')
    expect(candidates[3]).toContain('size=128')
    expect(candidates.at(-1)).toBe('https://example.com/favicon.ico')
    expect(candidates.every((url) => !url.includes('google.com/s2'))).toBe(true)
  })

  it('SMB 地址不生成 HTTP 网站图标候选', () => {
    expect(createCardIconCandidates({
      pageUrl: 'smb://10.0.0.3:445/share',
      customIcon: '',
      runtimeGetURL: (path) => `chrome-extension://extension-id${path}`
    })).toEqual([])
  })

  it('图片报错后尝试下一候选并在成功后显示', () => {
    const image = { naturalWidth: 64, naturalHeight: 64, removeAttribute: vi.fn() }
    const onLoaded = vi.fn()
    loadCardIcon(image, ['https://bad.example/icon.png', 'https://ok.example/icon.png'], { onLoaded })

    expect(image.src).toBe('https://bad.example/icon.png')
    image.onerror()
    expect(image.src).toBe('https://ok.example/icon.png')
    image.onload()
    expect(onLoaded).toHaveBeenCalledWith('https://ok.example/icon.png', { width: 64, height: 64 })
  })

  it('全部候选超时后降级为首字母层', () => {
    vi.useFakeTimers()
    const image = { naturalWidth: 0, naturalHeight: 0, removeAttribute: vi.fn() }
    const onFallback = vi.fn()
    loadCardIcon(image, ['https://bad.example/icon.png'], { timeoutMs: 100, onFallback })

    vi.advanceTimersByTime(100)
    expect(onFallback).toHaveBeenCalledOnce()
    expect(image.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('取消加载后不再触发超时降级', () => {
    vi.useFakeTimers()
    const image = { naturalWidth: 0, naturalHeight: 0, removeAttribute: vi.fn() }
    const onFallback = vi.fn()
    const cancel = loadCardIcon(image, ['https://slow.example/icon.png'], { timeoutMs: 100, onFallback })

    cancel()
    vi.advanceTimersByTime(100)
    expect(onFallback).not.toHaveBeenCalled()
    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
  })

  it('拒绝尺寸过小的伪图标', () => {
    const image = { naturalWidth: 1, naturalHeight: 1, removeAttribute: vi.fn() }
    const onFallback = vi.fn()
    loadCardIcon(image, ['https://bad.example/pixel.gif'], { onFallback })

    image.onload()
    expect(onFallback).toHaveBeenCalledOnce()
  })
})
