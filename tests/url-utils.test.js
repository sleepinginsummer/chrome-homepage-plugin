import { describe, expect, it } from 'vitest'
import { normalizeCardUrl } from '../url-utils.js'

describe('normalizeCardUrl', () => {
  it('keeps HTTP and HTTPS addresses unchanged', () => {
    expect(normalizeCardUrl('http://example.com/path')).toBe('http://example.com/path')
    expect(normalizeCardUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('defaults addresses without a scheme to HTTPS', () => {
    expect(normalizeCardUrl('example.com/path')).toBe('https://example.com/path')
  })

  it('keeps a standard SMB address unchanged', () => {
    expect(normalizeCardUrl('smb://10.0.0.3:445/share')).toBe('smb://10.0.0.3:445/share')
  })

  it('repairs an SMB address with a missing colon', () => {
    expect(normalizeCardUrl('smb//10.0.0.3:445/share')).toBe('smb://10.0.0.3:445/share')
  })
})
