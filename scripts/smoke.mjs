/**
 * @fileoverview
 * 真机冒烟：用 Chrome for Testing 加载未打包的扩展目录，通过 CDP 断言
 * 「页面能起来、六类卡片能渲染、四类行情卡片数据链路跑通、搜索历史能落盘、
 * 主题与语言能切换、service worker 无异常」。
 *
 * 用法：
 *   npm run smoke:install   # 首次：下载 Chrome for Testing 到 .tmp/（约 190MB）
 *   npm run smoke           # 跑冒烟
 *
 * 可用环境变量：
 *   CHROME_BIN  指定浏览器（需支持 --load-extension，即 Chrome for Testing / Chromium）
 *
 * 说明：
 * - 用临时 profile，不碰本机 Chrome 的数据；结束时清理 profile 与冒烟写入的配置。
 * - 冒烟只覆盖“能不能跑起来 + 主链路”，不替代单测：网络接口不可用时行情卡片算通过（链路跑通）。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveBrowser, rootDir } from './chrome-for-testing.mjs'

const EXT_DIR = realpathSync(rootDir)
const PORT = Number(process.env.SMOKE_PORT || 9333)
const HEARTBEAT_MS = 20000

/**
 * Linux（含 CI 容器）上需要额外参数：容器内没有用户命名空间，且 /dev/shm 常常很小。
 */
const PLATFORM_FLAGS = process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []

const browser = resolveBrowser()
if (!browser) {
  console.error('未找到可用于冒烟的浏览器。请先执行：npm run smoke:install')
  console.error('（stable 版 Chrome 不支持命令行加载未打包扩展，所以用 Chrome for Testing）')
  process.exit(1)
}
console.log(`浏览器：${browser.path}（来自 ${browser.source}）`)

const profile = mkdtempSync(join(tmpdir(), 'chrome-smoke-'))
const chrome = spawn(browser.path, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--load-extension=${EXT_DIR}`,
  `--disable-extensions-except=${EXT_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
  ...PLATFORM_FLAGS,
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] })

let chromeStderr = ''
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk.toString() })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForEndpoint = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      // 还没起来
    }
    await sleep(250)
  }
  throw new Error(`调试端口未就绪。Chrome stderr:\n${chromeStderr.slice(0, 2000)}`)
}

/** 极简 CDP 客户端（Node 自带 WebSocket，不引第三方依赖）。 */
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.seq = 0
    this.pending = new Map()
    this.events = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')))
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter) {
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? '')})`))
        else waiter.resolve(message.result)
        return
      }
      this.events.push(message)
    })
  }

  send(method, params = {}) {
    this.seq += 1
    const id = this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时：${method}`))
        }
      }, HEARTBEAT_MS)
    })
  }

  /** 页面/worker 侧记录到的异常与 console.error */
  errors() {
    return this.events
      .filter((event) => event.method === 'Runtime.exceptionThrown' ||
        (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'))
      .map((event) => event.params?.exceptionDetails?.exception?.description || event.params?.entry?.text)
  }

  close() {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 未打包扩展的 ID = sha256(realpath) 前 32 位十六进制逐位映射到 a-p。
 * 注意：macOS 上 /tmp 是 /private/tmp 的软链，必须先 realpath 才能对上。
 */
const extensionIdOf = (dir) => createHash('sha256')
  .update(dir)
  .digest('hex')
  .slice(0, 32)
  .replace(/./g, (char) => 'abcdefghijklmnop'[parseInt(char, 16)])

const extensionId = extensionIdOf(EXT_DIR)
const listTargets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()

const runChecks = async () => {
  const version = await waitForEndpoint()
  console.log(`Chrome：${version.Browser}`)
  await sleep(1500) // 等扩展装载

  const pageUrl = `chrome-extension://${extensionId}/newtab.html`
  const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
  const page = new Cdp(created.webSocketDebuggerUrl)
  await page.ready
  await page.send('Runtime.enable')
  await page.send('Log.enable')
  await page.send('Page.enable')
  await sleep(1200)

  const evaluate = async (expression) => {
    const res = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) {
      throw new Error(`页面求值异常：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
    }
    return res.result.value
  }

  // 1) 页面是否真的起来了
  check('页面命中扩展新标签页', (await evaluate('location.href')).includes(`${extensionId}/newtab.html`))
  check('页面确认是 Chrome Home Plugin', (await evaluate('chrome.runtime.getManifest().name')) === 'Chrome Home Plugin')
  check('搜索表单与输入框已渲染', await evaluate(`Boolean(document.querySelector('#keywordInput') && document.querySelector('#searchForm'))`))
  check('默认主题为 cyber-dark', (await evaluate('document.documentElement.dataset.theme')) === 'cyber-dark')

  const engines = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('#engineSelection .engine-checkbox input')]
    return { total: inputs.length, checked: inputs.filter((input) => input.checked).map((input) => input.value) }
  })()`)
  check('引擎选择器渲染出全部引擎', engines.total === 5, JSON.stringify(engines))
  check('默认勾选 GOOGLE/BING/BAIDU', JSON.stringify(engines.checked) === JSON.stringify(['GOOGLE', 'BING', 'BAIDU']), JSON.stringify(engines.checked))
  check('首屏无 JS 异常', page.errors().length === 0, JSON.stringify(page.errors()).slice(0, 300))

  // 2) 六类卡片渲染
  const seeded = await evaluate(`(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'setConfig', data: { cards: [
      { id: 'smoke-link', title: '冒烟链接', url: 'https://example.com' },
      { id: 'smoke-weather', type: 'weather', city: '南京', title: '南京天气' },
      { id: 'smoke-hot', type: 'hot', title: '知乎', sourceTitle: '知乎' },
      { id: 'smoke-stock', type: 'stock', title: '自选股', symbols: ['600000'] },
      { id: 'smoke-metals', type: 'metals', title: '黄金白银' },
      { id: 'smoke-anniversary', type: 'anniversary', title: '纪念日', items: [{ id: 'a1', title: '生日', date: '2026-12-24' }] }
    ] } })
    return res?.ok === true
  })()`)
  check('通过后台写入 6 张卡片', seeded)

  await page.send('Page.reload', { ignoreCache: false })
  await sleep(2000)
  const cards = await evaluate(`[...document.querySelectorAll('#cardsGrid .card[data-card-id]')].map((el) => ({ id: el.dataset.cardId, cls: el.className }))`)
  check('6 张卡片全部渲染', cards.length === 6, JSON.stringify(cards.map((card) => card.id)))
  check('链接卡片按 link 类名渲染', cards.some((card) => card.id === 'smoke-link' && card.cls.trim() === 'card'))
  check('天气卡片渲染出卡壳', cards.some((card) => card.id === 'smoke-weather' && card.cls.includes('card-weather')))
  check('热搜卡片渲染出列表容器', await evaluate(`Boolean(document.querySelector('.card[data-card-id="smoke-hot"] [data-hot-list]'))`))
  check('股票卡片渲染出列表容器', await evaluate(`Boolean(document.querySelector('.card[data-card-id="smoke-stock"] [data-stock-list]'))`))
  check('贵金属卡片渲染出网格容器', await evaluate(`Boolean(document.querySelector('.card[data-card-id="smoke-metals"] [data-metals-grid]'))`))
  check('纪念日卡片渲染出倒计时', await evaluate(`Boolean(document.querySelector('.card[data-card-id="smoke-anniversary"] .anniversary-card .days'))`))
  check('渲染后无 JS 异常', page.errors().length === 0, JSON.stringify(page.errors()).slice(0, 300))

  // 3) 四类行情卡片的数据链路：等它离开「加载中」（拿到数据或明确报错都算链路跑通）
  const waitForCardSettled = async (selector, classify) => {
    for (let i = 0; i < 40; i += 1) {
      const state = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        return el ? ${classify} : null
      })()`)
      if (state && state !== 'loading') return state
      await sleep(500)
    }
    return 'timeout'
  }
  const settlement = [
    ['天气', '.card[data-card-id="smoke-weather"] [data-weather-content]', 'weather-empty'],
    ['热搜', '.card[data-card-id="smoke-hot"] [data-hot-list]', 'hot-empty'],
    ['股票', '.card[data-card-id="smoke-stock"] [data-stock-list]', 'stock-empty'],
    ['贵金属', '.card[data-card-id="smoke-metals"] [data-metals-grid]', 'metals-empty']
  ]
  for (const [name, selector, emptyClass] of settlement) {
    const state = await waitForCardSettled(selector, `(() => {
      const empty = el.querySelector('.${emptyClass}')
      if (!empty) return 'data'
      return /加载|Loading/.test(empty.textContent) ? 'loading' : 'error'
    })()`)
    check(`${name}卡片数据链路跑通（离开加载中）`, state === 'data' || state === 'error', `结果：${state}`)
  }
  check('行情链路无 JS 异常', page.errors().length === 0, JSON.stringify(page.errors()).slice(0, 300))

  // 4) 搜索历史：走真实消息链路
  const historyWrite = await evaluate(`(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'addSearchHistory', keyword: '冒烟关键词' })
    if (!res?.ok) return { ok: false, error: res?.error }
    return { ok: true, history: res.data.searchHistory }
  })()`)
  check('历史写入成功且包含关键词', historyWrite.ok && historyWrite.history.includes('冒烟关键词'), JSON.stringify(historyWrite).slice(0, 200))

  const historyRead = await evaluate(`(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'getConfig' })
    return res?.data?.searchHistory || []
  })()`)
  check('历史已持久化到配置', historyRead.includes('冒烟关键词'), JSON.stringify(historyRead).slice(0, 200))

  await sleep(600) // 等 storage 变更事件驱动页面刷新
  const sidebarItems = await evaluate(`document.querySelectorAll('#historyItems .history-item').length`)
  check('侧栏出现该历史条目', sidebarItems >= 1, `当前 ${sidebarItems} 条`)

  // 5) 主题切换 + 刷新后仍生效 + 首屏缓存
  const themeSwitch = await evaluate(`(async () => {
    document.querySelector('#openSettingsBtn').click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const radio = document.querySelector('input[name="theme"][value="neo-brutalism"]')
    if (!radio) return { ok: false }
    radio.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { ok: true, theme: document.documentElement.dataset.theme }
  })()`)
  check('切到新粗野主题生效', themeSwitch.ok && themeSwitch.theme === 'neo-brutalism', JSON.stringify(themeSwitch))
  check('主题已写入配置', (await evaluate(`chrome.runtime.sendMessage({ type: 'getConfig' }).then((res) => res?.data?.ui?.theme)`)) === 'neo-brutalism')

  await page.send('Page.reload', { ignoreCache: false })
  await sleep(1800)
  check('刷新后主题仍为新粗野', (await evaluate('document.documentElement.dataset.theme')) === 'neo-brutalism')
  check('首屏缓存已写入 localStorage', (await evaluate(`localStorage.getItem('chromeHomeTheme')`)) === 'neo-brutalism')

  // 5.1) 跨页面同步：在选项页切主题，新标签页要跟着变
  const optionsUrl = `chrome-extension://${extensionId}/options.html`
  const optionsTarget = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(optionsUrl)}`, { method: 'PUT' })).json()
  const optionsPage = new Cdp(optionsTarget.webSocketDebuggerUrl)
  await optionsPage.ready
  await optionsPage.send('Runtime.enable')
  await optionsPage.send('Log.enable')
  await sleep(1200)

  const readOptions = async (expression) => {
    const res = await optionsPage.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(`选项页求值异常：${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
    return res.result.value
  }

  const optionsState = await readOptions(`(() => ({
    theme: document.documentElement.dataset.theme,
    checked: document.querySelector('input[name="theme"]:checked')?.value ?? null,
    status: document.querySelector('#status')?.textContent ?? null
  }))()`)
  check('选项页读到同一主题', optionsState.theme === 'neo-brutalism' && optionsState.checked === 'neo-brutalism', JSON.stringify(optionsState))
  // 选项页 main() 的异常会被它自己的 catch 写进 #status，这里必须显式看一眼
  check('选项页无错误提示', optionsState.status === '已加载当前配置', String(optionsState.status))

  const optionsSwitch = await readOptions(`(async () => {
    const radio = document.querySelector('input[name="theme"][value="cyber-dark"]')
    if (!radio) return { ok: false }
    radio.click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { ok: true, theme: document.documentElement.dataset.theme }
  })()`)
  check('选项页可以切回赛博深色', optionsSwitch.ok && optionsSwitch.theme === 'cyber-dark', JSON.stringify(optionsSwitch))

  await sleep(800)
  const synced = await evaluate(`(() => ({
    theme: document.documentElement.dataset.theme,
    checked: document.querySelector('input[name="theme"]:checked')?.value ?? null
  }))()`)
  check('新标签页跟着切到赛博深色', synced.theme === 'cyber-dark', JSON.stringify(synced))
  check('新标签页的单选状态同步', synced.checked === 'cyber-dark', JSON.stringify(synced))
  check('选项页无 JS 异常', optionsPage.errors().length === 0, JSON.stringify(optionsPage.errors()).slice(0, 300))
  optionsPage.close()

  // 6) 语言切换
  const language = await evaluate(`(async () => {
    const select = document.querySelector('#languageSelect')
    if (!select) return { ok: false }
    select.value = 'en'
    select.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { ok: true, lang: document.documentElement.lang, label: document.querySelector('#openSettingsBtn').getAttribute('aria-label') }
  })()`)
  check('切到英文后文案更新', language.ok && language.lang === 'en' && language.label === 'Settings', JSON.stringify(language))

  // 7) 设置面板分页
  const panel = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.settings-item')].map((btn) => btn.dataset.tab)
    document.querySelector('.settings-item[data-tab="sync"]').click()
    return { tabs, syncVisible: !document.querySelector('#settingsPanelSync').hidden }
  })()`)
  check('设置面板四个分页齐全', JSON.stringify(panel.tabs) === JSON.stringify(['appearance', 'sync', 'language', 'about']), JSON.stringify(panel.tabs))
  check('同步分页可切换', panel.syncVisible)

  // 8) service worker：页面发过消息，此时应已唤醒
  await sleep(800)
  const swTarget = (await listTargets()).find((target) =>
    target.type === 'service_worker' && target.url === `chrome-extension://${extensionId}/background.js`)
  check('service worker 已唤醒', Boolean(swTarget), swTarget?.url || '未找到 background.js')
  if (swTarget) {
    const worker = new Cdp(swTarget.webSocketDebuggerUrl)
    await worker.ready
    await worker.send('Runtime.enable')
    await worker.send('Log.enable')
    const swName = (await worker.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest().name',
      returnByValue: true
    })).result.value
    check('service worker 命中的是我们的扩展', swName === 'Chrome Home Plugin', String(swName))
    check('service worker 无异常', worker.errors().length === 0, JSON.stringify(worker.errors()).slice(0, 300))
    worker.close()
  }

  // 9) 窄屏一致性：两个主题的侧栏显隐断点必须一致，且窄屏不出现横向溢出
  const widths = [1600, 1320, 1319, 1024, 720, 641, 640, 480]
  const layout = []
  for (const width of widths) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(120)
    layout.push(await evaluate(`(() => {
      const root = document.documentElement
      const previous = root.dataset.theme
      const sidebar = document.querySelector('#historySidebar')
      const visible = {}
      for (const theme of ['cyber-dark', 'neo-brutalism']) {
        root.dataset.theme = theme
        visible[theme] = getComputedStyle(sidebar).display !== 'none'
      }
      root.dataset.theme = previous
      return { width: window.innerWidth, dark: visible['cyber-dark'], brutal: visible['neo-brutalism'], overflow: root.scrollWidth - window.innerWidth }
    })()`))
  }
  const mismatched = layout.filter((row) => row.dark !== row.brutal)
  check('两个主题的侧栏显隐完全一致', mismatched.length === 0, JSON.stringify(layout.map((row) => `${row.width}:${row.dark ? 'on' : 'off'}/${row.brutal ? 'on' : 'off'}`).join(' ')))
  const wrongBreakpoint = layout.filter((row) => row.dark !== (row.width > 640))
  check('侧栏只在 ≤640px 隐藏', wrongBreakpoint.length === 0, JSON.stringify(wrongBreakpoint))
  const overflowing = layout.filter((row) => row.overflow > 1)
  check('各宽度无横向溢出', overflowing.length === 0, JSON.stringify(overflowing))
  await page.send('Emulation.clearDeviceMetricsOverride')

  // 10) 收尾：清掉冒烟写入的数据
  await evaluate(`chrome.runtime.sendMessage({ type: 'setConfig', data: { cards: [], searchHistory: [], ui: { language: 'zh', theme: 'cyber-dark' } } })`)
  page.close()
}

try {
  await runChecks()
} catch (error) {
  check('冒烟流程执行完成', false, error.message)
} finally {
  chrome.kill('SIGKILL')
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* profile 清理失败不影响结论 */ }
  const failed = results.filter((result) => !result.ok)
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  process.exit(failed.length ? 1 : 0)
}
