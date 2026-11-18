/**
 * @fileoverview
 * 用 Chrome Web Store API v2 上传并发布当前版本。
 *
 * 用法：
 *   npm run package              # 先生成 dist/chrome-home-plugin-v<version>.zip
 *   npm run publish:webstore     # 上传 + 提交审核
 *
 * 需要的环境变量（都从环境读，不落仓库、不写进脚本）：
 *   CWS_CLIENT_ID        OAuth 客户端 ID（Google Cloud 里创建的 Web 应用）
 *   CWS_CLIENT_SECRET    OAuth 客户端密钥
 *   CWS_REFRESH_TOKEN    带 chromewebstore 作用域的刷新令牌
 *   CWS_PUBLISHER_ID     开发者后台 Publisher > Settings 里的发布者 ID
 *   CWS_ITEM_ID          扩展 ID（32 位，与商店条目 ID 相同）
 *
 * 可选：
 *   CWS_UPLOAD_ONLY=1    只上传不发布（先看后台的状态再手动提交）
 *
 * 说明：
 * - 流程来自 https://developer.chrome.com/docs/webstore/using-api ：
 *   刷新 access token → upload → 轮询 fetchStatus（异步校验）→ publish → 查审核状态。
 * - publish 只影响"提交给审核"，不会改动商店里已有的可见性设置；
 *   若最近在后台手动改过可见性，需要先在后台发布一次，API 才能继续用。
 * - manifest 版本号必须先升，否则 upload 会被拒绝。
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf8'))
const version = manifest.version

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://chromewebstore.googleapis.com'
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 20

/**
 * 读取必需的环境变量，缺失时直接失败（发布不能靠猜默认值）。
 *
 * @param {string} name 变量名。
 * @returns {string} 变量值。
 */
const requireEnv = (name) => {
  const value = (process.env[name] || '').trim()
  if (!value) throw new Error(`缺少环境变量：${name}`)
  return value
}

const uploadOnly = process.env.CWS_UPLOAD_ONLY === '1'
const clientId = requireEnv('CWS_CLIENT_ID')
const clientSecret = requireEnv('CWS_CLIENT_SECRET')
const refreshToken = requireEnv('CWS_REFRESH_TOKEN')
const publisherId = requireEnv('CWS_PUBLISHER_ID')
const itemId = requireEnv('CWS_ITEM_ID')

const zipPath = join(rootDir, 'dist', `chrome-home-plugin-v${version}.zip`)
if (!existsSync(zipPath)) {
  throw new Error(`找不到 ${zipPath}，请先执行 npm run package`)
}

const itemUrl = `${API_BASE}/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`
const uploadUrl = `${API_BASE}/upload/v2/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}:upload`

/**
 * 刷新 access token。刷新令牌长期有效，access token 只有一小时。
 *
 * @returns {Promise<string>} access token。
 */
const fetchAccessToken = async () => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`刷新 access token 失败：HTTP ${res.status} ${text.slice(0, 300)}`)
  const data = JSON.parse(text)
  if (!data.access_token) throw new Error('刷新 access token 失败：响应里没有 access_token')
  return data.access_token
}

/**
 * 统一的 JSON 请求封装，非 2xx 时把服务端原话带进错误里。
 *
 * @param {string} url 请求地址。
 * @param {string} token access token。
 * @param {object} [init] fetch 参数。
 * @returns {Promise<object|string>} 响应体。
 */
const callApi = async (url, token, init = {}) => {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 500)}`)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * 上传 zip。上传是异步校验，uploadState 可能先返回 IN_PROGRESS。
 *
 * @param {string} token access token。
 * @returns {Promise<void>}
 */
const uploadPackage = async (token) => {
  const zip = readFileSync(zipPath)
  console.log(`上传 ${zipPath}（${(zip.length / 1024).toFixed(1)} KB，版本 ${version}）`)
  const result = await callApi(uploadUrl, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zip
  })
  console.log('upload 响应：', JSON.stringify(result))

  let state = result?.uploadState
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const status = await callApi(`${itemUrl}:fetchStatus`, token)
    state = status?.lastAsyncUploadState || status?.lastUploadState || state
    console.log(`校验中（第 ${attempt + 1} 次）：${state}`)
  }

  if (state && !/SUCCEEDED|SUCCESS/.test(state)) {
    throw new Error(`上传未通过：${state}`)
  }
}

/**
 * 提交审核。已通过审核的版本才会真正对所有用户生效。
 *
 * @param {string} token access token。
 * @returns {Promise<void>}
 */
const publishItem = async (token) => {
  const result = await callApi(`${itemUrl}:publish`, token, { method: 'POST' })
  console.log('publish 响应：', JSON.stringify(result))
  const status = Array.isArray(result?.status) ? result.status : []
  if (status.length && !status.includes('OK')) throw new Error(`发布失败：${status.join(', ')}`)
}

const printReviewStatus = async (token) => {
  const status = await callApi(`${itemUrl}:fetchStatus`, token)
  console.log('当前状态：', JSON.stringify(status, null, 2))
}

const main = async () => {
  const token = await fetchAccessToken()
  await uploadPackage(token)
  if (uploadOnly) {
    await printReviewStatus(token)
    console.log(`已上传 v${version}，未提交审核（CWS_UPLOAD_ONLY=1）`)
    return
  }
  await publishItem(token)
  await printReviewStatus(token)
  console.log(`已提交 v${version} 审核`)
}

main().catch((error) => {
  console.error(`发布失败：${error.message}`)
  process.exit(1)
})
