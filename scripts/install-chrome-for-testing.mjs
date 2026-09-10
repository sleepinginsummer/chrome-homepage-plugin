/**
 * @fileoverview
 * 下载 Chrome for Testing 到 .tmp/chrome-for-testing/，供 npm run smoke 加载未打包扩展。
 *
 * 为什么需要它：stable 版 Chrome 已禁止命令行 --load-extension
 * （日志里会提示 "--disable-extensions-except is not allowed in Google Chrome"），
 * 只有 Chrome for Testing / Chromium 这类构建能用命令行加载未打包扩展。
 *
 * 用法：npm run smoke:install
 */

import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'

import { binaryPath, cacheDir, detectPlatform } from './chrome-for-testing.mjs'

const versionUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'

const main = async () => {
  const platform = detectPlatform()
  if (!platform) throw new Error(`暂不支持在 ${process.platform} 上自动下载，请用 CHROME_BIN 指定浏览器`)

  const binary = binaryPath(platform)
  if (existsSync(binary)) {
    console.log(`已存在，跳过下载：${binary}`)
    return
  }

  console.log('读取 Chrome for Testing 最新稳定版信息…')
  const meta = await (await fetch(versionUrl)).json()
  const stable = meta?.channels?.Stable
  const asset = stable?.downloads?.chrome?.find((item) => item.platform === platform)
  if (!asset?.url) throw new Error(`未找到平台 ${platform} 的下载地址`)

  console.log(`下载 ${stable.version}（约 190MB）…`)
  const res = await fetch(asset.url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  if (!res.body) throw new Error('下载响应为空')

  mkdirSync(cacheDir, { recursive: true })
  const zipPath = join(cacheDir, `chrome-${platform}-${stable.version}.zip`)
  const totalMb = Number(res.headers.get('content-length') || 0) / 1024 / 1024
  let downloadedMb = 0
  let lastLogged = 0
  const progress = new TransformStream({
    transform(chunk, controller) {
      downloadedMb += chunk.length / 1024 / 1024
      if (downloadedMb - lastLogged >= 25) {
        lastLogged = downloadedMb
        console.log(`  已下载 ${downloadedMb.toFixed(0)}MB${totalMb ? ` / ${totalMb.toFixed(0)}MB` : ''}`)
      }
      controller.enqueue(chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body.pipeThrough(progress)), createWriteStream(zipPath))
  console.log(`  下载完成：${zipPath}（${downloadedMb.toFixed(0)}MB）`)

  console.log('解压…')
  rmSync(join(cacheDir, `chrome-${platform}`), { recursive: true, force: true })
  const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', cacheDir], { encoding: 'utf8' })
  if (unzip.status !== 0) throw new Error(`解压失败（需要 unzip 命令）：${unzip.stderr || unzip.stdout}`)
  rmSync(zipPath, { force: true })

  if (!existsSync(binary)) throw new Error(`解压后未找到可执行文件：${binary}`)
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout?.trim()
  console.log(`完成：${binary}`)
  console.log(`版本：${version || stable.version}`)
  console.log(`缓存目录（可随时删除）：${cacheDir}`)
}

try {
  await main()
} catch (error) {
  console.error(`安装失败：${error.message}`)
  process.exit(1)
}
