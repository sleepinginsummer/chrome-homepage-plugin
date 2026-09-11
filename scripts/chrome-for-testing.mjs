/**
 * @fileoverview
 * Chrome for Testing 的下载位置与可执行文件解析，供安装脚本与冒烟测试共用。
 *
 * 说明：stable 版 Chrome 已禁止命令行 --load-extension，
 * 冒烟测试必须用 Chrome for Testing / Chromium 这类构建。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 浏览器缓存放在用户缓存目录，不放进仓库：
 * 一是仓库可能在 macfuse/NTFS 这类同步挂载上，写 190MB 会慢到不可用；
 * 二是没必要把几百 MB 的二进制放进项目目录。
 */
const cacheRoot = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Caches', 'chrome-home-plugin')
  : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'chrome-home-plugin')

export const cacheDir = join(cacheRoot, 'chrome-for-testing')

/**
 * 当前平台对应的 Chrome for Testing 平台标识。
 */
export const detectPlatform = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  // linux-arm64 也要区分：Apple Silicon 容器与 ARM runner 上跑 linux64 会直接报 loader 缺失。
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux64'
  return null
}

/**
 * 解压后的可执行文件路径（未下载时也会返回，由调用方判断存在性）。
 */
export const binaryPath = (platform) => {
  if (!platform) return null
  const base = join(cacheDir, `chrome-${platform}`)
  if (platform === 'mac-arm64' || platform === 'mac-x64') {
    return join(base, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
  }
  return join(base, 'chrome')
}

/**
 * 解析本次要用的浏览器：优先我们自己的 Chrome for Testing 缓存，其次 CHROME_BIN。
 *
 * 顺序说明：缓存里的浏览器一定能用命令行加载未打包扩展，而环境里的 CHROME_BIN
 * 可能指向 stable 版 Chrome（从 137 起禁止 --load-extension，CI 镜像就自带一个），
 * 所以先用自己的缓存；没装过 CFT 时才回退到 CHROME_BIN。
 *
 * @returns {{path: string, source: string}|null} 找不到时返回 null。
 */
export const resolveBrowser = () => {
  const cached = binaryPath(detectPlatform())
  if (cached && existsSync(cached)) return { path: cached, source: cacheDir }

  const fromEnv = process.env.CHROME_BIN
  if (fromEnv && existsSync(fromEnv)) return { path: fromEnv, source: 'CHROME_BIN' }

  return null
}
