import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (file) => JSON.parse(readFileSync(join(rootDir, file), 'utf8'))
const manifest = readJson('manifest.json')
const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const version = manifest.version

if (packageJson.version !== version || packageLock.version !== version) {
  throw new Error(`版本不一致: manifest=${version} package=${packageJson.version} lock=${packageLock.version}`)
}

const releaseTag = process.env.RELEASE_TAG || ''
if (releaseTag && releaseTag !== `v${version}`) {
  throw new Error(`标签与 manifest 版本不一致: tag=${releaseTag} manifest=v${version}`)
}

// 扩展运行时文件清单只在这里维护，本地打包与 GitHub Release 共用。
const runtimeEntries = [
  'manifest.json',
  'background.js', 'config-store.js', 'tabs-ops.js', 'remote-sync.js', 'extension-api.js',
  'options.html', 'options.css', 'options.js',
  'newtab.html', 'newtab.css', 'newtab.js',
  'sync-startup.js', 'hot-news.js', 'request-cache.js',
  'weather.js', 'weather-card.js', 'weather-card.css',
  'card-drag.js', 'card-icon.js',
  'icon.svg', 'icons', 'assets/meteocons', 'LICENSE'
]

for (const entry of runtimeEntries) {
  if (!existsSync(join(rootDir, entry))) throw new Error(`缺少打包文件: ${entry}`)
}

mkdirSync(join(rootDir, 'dist'), { recursive: true })
const relativeOutput = `dist/chrome-home-plugin-v${version}.zip`
const output = join(rootDir, relativeOutput)
rmSync(output, { force: true })

const zipResult = spawnSync('zip', ['-q', '-r', relativeOutput, ...runtimeEntries], {
  cwd: rootDir,
  encoding: 'utf8'
})
if (zipResult.status !== 0) {
  throw new Error(`ZIP 生成失败: ${zipResult.stderr || zipResult.stdout}`)
}

const unzipResult = spawnSync('unzip', ['-p', relativeOutput, 'manifest.json'], {
  cwd: rootDir,
  encoding: 'utf8'
})
if (unzipResult.status !== 0) throw new Error(`ZIP 校验失败: ${unzipResult.stderr}`)
const packagedManifest = JSON.parse(unzipResult.stdout)
if (packagedManifest.version !== version) throw new Error('ZIP 内 manifest 版本不正确')

const checksum = createHash('sha256').update(readFileSync(output)).digest('hex')
console.log(`${checksum}  ${relativeOutput}`)
console.log(`已生成 ${relativeOutput}`)
