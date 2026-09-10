import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_PATH, normalizeSyncConfig, normalizeSyncDraft, parseGitRemote, tryParseGitRemote } from '../remote-sync.js'

const GITEE_URL = 'https://gitee.com/example/codes/abc123'

describe('sync remote rules', () => {
  it('parses gitee codes urls and rejects others', () => {
    expect(parseGitRemote(GITEE_URL)).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })
    expect(parseGitRemote('https://gitee.com/example/codes/abc123?x=1')).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })

    expect(() => parseGitRemote('https://github.com/example/repo')).toThrow()
    expect(() => parseGitRemote('')).toThrow()
  })

  it('tryParseGitRemote returns null instead of throwing', () => {
    // 表单与本地判断用它，地址写错不能中断交互。
    expect(tryParseGitRemote(GITEE_URL)).toEqual({ provider: 'gitee_gist', gistId: 'abc123' })
    expect(tryParseGitRemote('https://github.com/example/repo')).toBeNull()
    expect(tryParseGitRemote('')).toBeNull()
    expect(tryParseGitRemote(null)).toBeNull()
  })

  it('draft normalization shares the same field table as the throwing one', () => {
    const input = { gitUrl: GITEE_URL, token: 't', autoPush: true }

    // 同一份字段表：两条路径对合法地址必须产出完全一致的结果，避免表单与远端请求漂移。
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

  it('fills defaults for an empty config', () => {
    expect(normalizeSyncDraft(null)).toEqual({
      provider: 'gitee_gist',
      owner: '',
      repo: '',
      gistId: '',
      branch: 'main',
      path: DEFAULT_SYNC_PATH,
      token: '',
      gitUrl: '',
      autoPush: false
    })
  })
})
