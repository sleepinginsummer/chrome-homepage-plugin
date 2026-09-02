/**
 * 规范化网址卡片地址。
 * 普通域名默认使用 HTTPS；SMB 同时兼容遗漏冒号的常见写法。
 */
export const normalizeCardUrl = (raw) => {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (/^smb\/\//i.test(value)) return value.replace(/^smb\/\//i, 'smb://')
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value
  return `https://${value}`
}
