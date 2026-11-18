import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProvider,
  isProviderConfigured,
  resolveFilename
} from '../sync-providers.js'
import { createChromeStub } from './helpers/chrome-stub.js'

const SYNC = {
  provider: 'github_gist',
  gistId: '0123456789abcdef',
  token: 'token-value',
  path: 'config.json'
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
})

describe('sync providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the remote filename from path, ignoring directories', () => {
    expect(resolveFilename({})).toBe('config.json')
    expect(resolveFilename({ path: 'a/b/state.json' })).toBe('state.json')
    expect(resolveFilename({ path: '..' })).toBe('config.json')
  })

  it('checks readiness against each provider field list', () => {
    expect(isProviderConfigured('github_gist', { gitUrl: 'u', token: 't' })).toBe(true)
    expect(isProviderConfigured('github_gist', { gitUrl: 'u' })).toBe(false)
    expect(isProviderConfigured('webdav', { webdavUrl: 'u', username: 'n', token: 'p' })).toBe(true)
    expect(isProviderConfigured('storage_sync', {})).toBe(true)
    expect(() => getProvider('nope')).toThrow('未知的同步服务商')
  })

  describe('github gist', () => {
    it('reads the file with bearer auth', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ files: { 'config.json': { content: '{"a":1}' } } }))
      vi.stubGlobal('fetch', fetchMock)

      const text = await getProvider('github_gist').read(SYNC, {})

      expect(text).toBe('{"a":1}')
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.github.com/gists/0123456789abcdef')
      expect(init.headers.Authorization).toBe('Bearer token-value')
    })

    it('falls back to raw_url when the API truncates the file', async () => {
      const fetchMock = vi.fn(async (url) => {
        if (String(url).includes('raw')) return { ok: true, status: 200, text: async () => '{"full":true}' }
        return jsonResponse({
          files: { 'config.json': { content: '{"tru', truncated: true, raw_url: 'https://gist.example/raw' } }
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      expect(await getProvider('github_gist').read(SYNC, {})).toBe('{"full":true}')
    })

    it('treats 404 as "no remote file yet" and reports auth failures', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 404)))
      expect(await getProvider('github_gist').read(SYNC, {})).toBeNull()

      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 401)))
      await expect(getProvider('github_gist').read(SYNC, {})).rejects.toThrow('token 无效')
    })

    it('writes with PATCH and the resolved filename', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}))
      vi.stubGlobal('fetch', fetchMock)

      await getProvider('github_gist').write(SYNC, {}, '{"x":2}')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.github.com/gists/0123456789abcdef')
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body).files['config.json']).toEqual({ content: '{"x":2}' })
    })
  })

  describe('gitee gist', () => {
    const GITEE = { provider: 'gitee_gist', gistId: 'abc123', token: 'gitee-token', path: 'config.json' }

    it('reads with the token in the query string, not a header', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ files: { 'config.json': { content: '{"g":1}' } } }))
      vi.stubGlobal('fetch', fetchMock)

      expect(await getProvider('gitee_gist').read(GITEE, {})).toBe('{"g":1}')

      const [url, init] = fetchMock.mock.calls[0]
      // Gitee 只认 query 上的 access_token；顺手守住"不要加 Authorization 头"。
      expect(url).toBe('https://gitee.com/api/v5/gists/abc123?access_token=gitee-token')
      expect(init?.headers?.Authorization).toBeUndefined()
    })

    it('treats 404 as "no file yet" and explains 401/403', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 404)))
      expect(await getProvider('gitee_gist').read(GITEE, {})).toBeNull()

      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 401)))
      await expect(getProvider('gitee_gist').read(GITEE, {})).rejects.toThrow('检查 token')

      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 403)))
      await expect(getProvider('gitee_gist').write(GITEE, {}, 'x')).rejects.toThrow('拒绝写入')
    })

    it('writes with PATCH and the same body shape as before the refactor', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}))
      vi.stubGlobal('fetch', fetchMock)

      await getProvider('gitee_gist').write(GITEE, {}, '{"y":2}')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://gitee.com/api/v5/gists/abc123?access_token=gitee-token')
      expect(init.method).toBe('PATCH')
      const body = JSON.parse(init.body)
      expect(body.files['config.json']).toEqual({ content: '{"y":2}' })
      expect(typeof body.description).toBe('string')
    })
  })

  describe('webdav', () => {
    const WEBDAV = {
      provider: 'webdav',
      webdavUrl: 'https://dav.example.com/chrome-home/',
      username: 'user',
      token: 'app-password',
      path: 'config.json'
    }

    it('joins the folder url and sends basic auth', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"v":1}' }))
      vi.stubGlobal('fetch', fetchMock)

      expect(await getProvider('webdav').read(WEBDAV, {})).toBe('{"v":1}')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://dav.example.com/chrome-home/config.json')
      expect(init.headers.Authorization).toBe(`Basic ${btoa('user:app-password')}`)
    })

    it('treats 404 as "no file yet" and explains 409 on write', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
      expect(await getProvider('webdav').read(WEBDAV, {})).toBeNull()

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409 })))
      await expect(getProvider('webdav').write(WEBDAV, {}, 'x')).rejects.toThrow('目录不存在')

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
      await expect(getProvider('webdav').read(WEBDAV, {})).rejects.toThrow('用户名与密码')
    })

    it('supports HTTP WebDAV and refuses to overwrite a changed ETag', async () => {
      const provider = getProvider('webdav')
      const sync = { ...WEBDAV, webdavUrl: 'http://nas.lan:8080/dav/' }
      const ctx = {}
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('{}', { headers: { ETag: '"revision-1"' } }))
        .mockResolvedValueOnce(new Response(null, { status: 412 }))
      vi.stubGlobal('fetch', fetchMock)
      expect(await provider.read(sync, ctx)).toBe('{}')
      await expect(provider.write(sync, ctx, '{"cards":[]}')).rejects.toThrow('取消覆盖')
      expect(fetchMock.mock.calls[1][0]).toBe('http://nas.lan:8080/dav/config.json')
      expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe('"revision-1"')
    })
  })

  describe('chrome.storage.sync', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', {})
    })

    it('chunks large documents and drops stale chunks on the next write', async () => {
      const chromeApi = createChromeStub()
      vi.stubGlobal('chrome', chromeApi)
      const provider = getProvider('storage_sync')
      const sync = { provider: 'storage_sync' }

      const big = 'x'.repeat(17000)
      await provider.write(sync, { chromeApi }, big)
      expect(chromeApi.__stores.syncStore.get('chromeHomeSyncDoc').count).toBe(3)
      expect(await provider.read(sync, { chromeApi })).toBe(big)

      await provider.write(sync, { chromeApi }, 'small')
      expect(chromeApi.__stores.syncStore.get('chromeHomeSyncDoc').count).toBe(1)
      expect(chromeApi.__stores.syncStore.has('chromeHomeSyncDoc:2')).toBe(false)
      expect(await provider.read(sync, { chromeApi })).toBe('small')
    })

    it('measures escaped UTF-8 bytes and rejects overflow before writing', async () => {
      const chromeApi = createChromeStub()
      const provider = getProvider('storage_sync')
      const ctx = { chromeApi }
      const text = '中😀"\\'.repeat(3500)
      await provider.write({}, ctx, text)
      expect(await provider.read({}, ctx)).toBe(text)
      for (const [key, value] of chromeApi.__stores.syncStore) {
        expect(new TextEncoder().encode(key + JSON.stringify(value)).length).toBeLessThanOrEqual(8192)
      }
      const previous = new Map(chromeApi.__stores.syncStore)
      await expect(provider.write({}, ctx, '中'.repeat(40000))).rejects.toThrow('容量')
      expect(chromeApi.__stores.syncStore).toEqual(previous)
    })
    it('returns null before the first write', async () => {
      const chromeApi = createChromeStub()
      vi.stubGlobal('chrome', chromeApi)
      expect(await getProvider('storage_sync').read({}, { chromeApi })).toBeNull()
    })
  })
})
