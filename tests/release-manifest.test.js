import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

/** 运行时入口：扩展实际加载的脚本。 */
const ENTRY_MODULES = ['newtab.js', 'options.js', 'background.js']

/**
 * 读取 scripts/package.mjs 里的运行时清单（不 import，避免触发打包）。
 */
const readRuntimeEntries = () => {
  const source = read('scripts/package.mjs')
  const start = source.indexOf('const runtimeEntries = [')
  expect(start).toBeGreaterThan(-1)
  const block = source.slice(start, source.indexOf(']', start))
  return new Set([...block.matchAll(/'([^']+)'/g)].map(([, name]) => name))
}

/**
 * 从入口出发按 import 关系收集所有本地模块。
 */
const collectLocalModules = () => {
  const seen = new Set()
  const queue = [...ENTRY_MODULES]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const [, spec] of read(file).matchAll(/from '\.\/([\w.-]+\.js)'/g)) {
      if (!seen.has(spec)) queue.push(spec)
    }
  }
  return seen
}

/**
 * 收集 HTML 里引用的本地资源（css/js/图标目录等）。
 */
const collectHtmlAssets = () => {
  const assets = new Set()
  for (const page of ['newtab.html', 'options.html']) {
    for (const [, url] of read(page).matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)) {
      assets.add(url)
    }
  }
  return assets
}

describe('release manifest', () => {
  it('ships every module reachable from the runtime entries', () => {
    const entries = readRuntimeEntries()
    const missing = [...collectLocalModules()].filter((file) => !entries.has(file)).sort()

    // 漏加模块不会在开发时暴露，但打包后的扩展会在启动时直接报找不到模块。
    expect(missing).toEqual([])
  })

  it('ships every asset referenced by the pages', () => {
    const entries = readRuntimeEntries()
    const missing = [...collectHtmlAssets()]
      .filter((asset) => !asset.includes('/') || asset.startsWith('icons/') || asset.startsWith('assets/'))
      .filter((asset) => !asset.includes('/') ? !entries.has(asset) : ![...entries].some((entry) => asset.startsWith(`${entry}/`)))
      .sort()

    expect(missing).toEqual([])
  })

  it('keeps listed files present on disk', () => {
    const missing = [...readRuntimeEntries()].filter((entry) => !existsSync(new URL(entry, root)))

    expect(missing).toEqual([])
  })
})
