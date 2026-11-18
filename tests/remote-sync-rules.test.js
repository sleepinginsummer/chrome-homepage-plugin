import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYNC_PATH,
  isSyncConfigured,
  normalizeSyncConfig,
  normalizeSyncDraft,
  parseGitRemote,
  tryParseGitRemote,
  validateSyncConfig
} from '../remote-sync.js'
import { DEFAULT_SNAPSHOT_KEEP, DEFAULT_SYNC_SECTIONS } from '../sync-remote-doc.js'

const GITEE_URL = 'https://gitee.com/example/codes/abc123'
const GITHUB_URL = 'https://gist.github.com/example/0123456789abcdef'

describe('sync remote rules', () => {
  it('parses gitee codes and github gist urls, rejects repo urls', () => {
    expect(parseGitRemote(GITEE_URL)).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })
    expect(parseGitRemote(`${GITEE_URL}?x=1`)).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })

    expect(parseGitRemote(GITHUB_URL)).toEqual({ provider: 'github_gist', gistId: '0123456789abcdef' })
    expect(parseGitRemote('https://gist.github.com/0123456789abcdef')).toEqual({
      provider: 'github_gist',
      gistId: '0123456789abcdef'
    })
    expect(parseGitRemote('https://github.com/example/gists/0123456789abcdef')).toEqual({
      provider: 'github_gist',
      gistId: '0123456789abcdef'
    })

    // 普通仓库地址不是代码片段，必须拒绝而不是猜一个 gistId 出来。
    expect(() => parseGitRemote('https://github.com/example/repo')).toThrow()
    expect(() => parseGitRemote('')).toThrow()
  })

  it('tryParseGitRemote returns null instead of throwing', () => {
    expect(tryParseGitRemote(GITEE_URL)).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })
    expect(tryParseGitRemote('https://github.com/example/repo')).toBeNull()
    expect(tryParseGitRemote('')).toBeNull()
    expect(tryParseGitRemote(null)).toBeNull()
  })

  it('draft normalization shares the same field table as the throwing one', () => {
    const input = { gitUrl: GITEE_URL, token: 't', autoPush: true }

    expect(normalizeSyncDraft(input)).toEqual(normalizeSyncConfig(input))
    expect(normalizeSyncDraft(input)).toMatchObject({
      provider: 'gitee_gist',
      gistId: 'abc123',
      branch: 'main',
      path: DEFAULT_SYNC_PATH,
      token: 't',
      autoPush: true
    })
  })

  it('draft normalization tolerates a broken url while the strict one throws', () => {
    const broken = { gitUrl: 'https://github.com/example/repo', token: 't' }

    expect(() => normalizeSyncConfig(broken)).toThrow()
    expect(normalizeSyncDraft(broken)).toMatchObject({ gitUrl: broken.gitUrl, gistId: '', branch: 'main' })
  })

  it('prefers the gistId derived from the url over a stored one', () => {
    // 存量配置可能同时留着旧 gistId 和新改的地址：必须按地址走，否则会同步到旧代码片段。
    const draft = normalizeSyncDraft({ gitUrl: GITEE_URL, gistId: 'stored', branch: 'dev', path: 'custom/config.json' })

    expect(draft).toMatchObject({ gistId: 'abc123', branch: 'dev', path: 'custom/config.json' })
    expect(normalizeSyncConfig({ gitUrl: GITEE_URL, gistId: 'stored' }).gistId).toBe('abc123')
  })

  it('falls back to the stored gistId when there is no usable url', () => {
    // 迁移数据：地址为空或指向非 gist 来源时，只能沿用存量 gistId。
    expect(normalizeSyncDraft({ gitUrl: '', gistId: 'stored' }).gistId).toBe('stored')
    expect(normalizeSyncDraft({ gitUrl: 'https://github.com/a/b', gistId: 'stored' }).gistId).toBe('stored')
  })

  it('infers the provider from the url for legacy configs without a provider field', () => {
    // 0.4 及更早版本只存 gitUrl/token，升级后必须还能继续用同一个代码片段。
    expect(normalizeSyncDraft({ gitUrl: GITEE_URL, token: 't' }).provider).toBe('gitee_gist')
    expect(normalizeSyncDraft({ gitUrl: GITHUB_URL, token: 't' }).provider).toBe('github_gist')
    expect(normalizeSyncDraft({ webdavUrl: 'https://dav.example.com/x/', token: 't' }).provider).toBe('webdav')
  })

  it('keeps an explicitly selected provider even when the url looks like another', () => {
    expect(normalizeSyncDraft({ provider: 'webdav', gitUrl: GITEE_URL }).provider).toBe('webdav')
    // 非代码片段源不需要 gistId，留着旧值会让人误以为还在同步那个片段。
    expect(normalizeSyncDraft({ provider: 'storage_sync', gitUrl: GITEE_URL }).gistId).toBe('')
  })

  it('fills defaults for an empty config', () => {
    expect(normalizeSyncDraft(null)).toEqual({
      provider: 'github_gist',
      gitUrl: '',
      gistId: '',
      webdavUrl: '',
      username: '',
      branch: 'main',
      path: DEFAULT_SYNC_PATH,
      token: '',
      autoPush: false,
      sections: DEFAULT_SYNC_SECTIONS,
      snapshotKeep: DEFAULT_SNAPSHOT_KEEP
    })
  })

  it('validates the fields each provider actually needs', () => {
    expect(() => validateSyncConfig({ gitUrl: GITHUB_URL })).toThrow('token')
    expect(validateSyncConfig({ gitUrl: GITHUB_URL, token: 't' }).provider).toBe('github_gist')

    // WebDAV 要地址+账号+密码，缺一个都要给出具体字段名。
    expect(() => validateSyncConfig({ provider: 'webdav', token: 'p' })).toThrow('WebDAV 地址')
    expect(() => validateSyncConfig({ provider: 'webdav', webdavUrl: 'https://d/x', token: 'p' })).toThrow('用户名')
    expect(validateSyncConfig({ provider: 'webdav', webdavUrl: 'https://d/x', username: 'u', token: 'p' }).provider)
      .toBe('webdav')

    // chrome.storage.sync 零配置：什么都不填也算就绪。
    expect(validateSyncConfig({ provider: 'storage_sync' }).provider).toBe('storage_sync')
    expect(isSyncConfigured({ provider: 'storage_sync' })).toBe(true)
  })

  it('reports readiness without throwing for every provider', () => {
    expect(isSyncConfigured({ gitUrl: GITHUB_URL, token: 't' })).toBe(true)
    expect(isSyncConfigured({ gitUrl: GITHUB_URL })).toBe(false)
    expect(isSyncConfigured({ gitUrl: 'https://github.com/a/b', token: 't' })).toBe(false)
    expect(isSyncConfigured({ provider: 'webdav', webdavUrl: 'https://d/x', username: 'u', token: 'p' })).toBe(true)
    expect(isSyncConfigured({ provider: 'webdav', webdavUrl: 'https://d/x', username: 'u' })).toBe(false)
    expect(isSyncConfigured({})).toBe(false)
  })
})
