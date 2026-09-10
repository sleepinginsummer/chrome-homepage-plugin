# chrome-home-plugin

[中文](#中文) | [English](#english)

## 中文

一个 Chrome 新标签页扩展：多引擎搜索 + 搜索历史 + 常用网址卡片 + 配置同步（优先使用 Gitee 代码片段），并支持在设置中切换中英文界面。

### 功能

- 多引擎搜索：一次输入，按选择的多个引擎同时打开搜索结果标签页。
- 搜索历史：右侧浮层展示最近 20 条历史，搜索前保存到本机，点击可恢复搜索，支持清空。
- 网址卡片：新增/编辑卡片（标题 + 网址 + 可选 icon URL），支持拖拽排序、右键菜单删除/修改、点击打开。
- 配置同步：把当前配置（搜索引擎选择、历史、卡片、同步信息等）推送到远端（推荐：Gitee 代码片段），也支持从远端拉取覆盖设置（保留本机搜索历史）；可开启“配置变更后自动推送”。
- 主题切换：内置「赛博深色」与「新粗野」两套主题，设置中可切换，选择跟随配置同步；两套主题的信息架构一致（例如历史侧栏在同样的窄屏断点才隐藏）。
- 语言切换：设置中可切换中文/英文（默认中文）。

### 安装/加载

1. 打开 Chrome：`chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`/xxx/xxx/chrome-home-plugin`

### 同步配置（推荐：Gitee 代码片段）

1. 新标签页点击「设置」→「同步设置」
2. 填写：
   - `Git 地址`：Gitee 代码片段地址（例如 `https://gitee.com/<用户名>/codes/<代码片段ID>`）
   - `Token`：Gitee 私人令牌（需要对该代码片段有权限）
3. 点击「推送到远端」会在该代码片段中创建/更新 `config.json`；「从远端拉取」会读取 `config.json` 覆盖设置，但保留本机搜索历史（包括已清空的历史）；也可开启「自动同步」

> 注意：这是扩展页面发起的网络请求，需要在扩展的 `host_permissions` 中允许对应域名（本项目已包含 `api.github.com` 与 `gitee.com`）。

### 本地冒烟测试（真机）

用 Chrome for Testing 真实加载未打包扩展，跑一遍主链路：页面启动、六类卡片渲染、四类行情卡片数据链路、搜索历史落盘、主题与语言切换、service worker 无异常。

```bash
npm run smoke:install   # 首次：下载 Chrome for Testing 到用户缓存目录（约 190MB，可随时删除）
npm run smoke           # 一轮约 30 秒
```

- 为什么不用本机 Chrome：stable 版已禁止命令行 `--load-extension`，只有 Chrome for Testing / Chromium 能这样加载未打包扩展；也可以直接用 `CHROME_BIN` 指定已装好的这类浏览器。
- 冒烟用独立临时 profile，不碰你本机 Chrome 的数据；结束时会把冒烟写入的卡片与历史清掉。
- 网络不可用时行情卡片只校验「链路跑通（离开加载中）」，不会误报失败。

## English

A Chrome New Tab extension: multi-engine search + search history + site cards + config sync (recommended: Gitee codes). The UI language can be switched between Chinese and English (default: Chinese).

### Local smoke test (real browser)

Loads the unpacked extension in Chrome for Testing and exercises the main paths: page boot, all six card types rendering, the four quote-card data paths, search-history persistence, theme and language switching, and a clean service worker.

```bash
npm run smoke:install   # first run: downloads Chrome for Testing into the user cache dir (~190MB, safe to delete)
npm run smoke           # ~30 seconds per run
```

- Why not your own Chrome: stable builds reject `--load-extension` on the command line; only Chrome for Testing / Chromium builds can load unpacked extensions this way. You can also point `CHROME_BIN` at one you already have.
- The smoke run uses a throwaway profile and cleans up the cards/history it wrote.
- Quote cards only need to leave the loading state to pass, so a missing network never fails the run.

### Features

- Multi-engine search: one input, open results in multiple engines at once.
- Search history: the latest 20 terms are saved locally before navigation, with click-to-search and clear-all.
- Site cards: create/edit cards (title + URL + optional icon URL), drag to reorder, right-click menu to edit/delete, click to open.
- Config sync: push the current config (engines selection, history, cards, sync settings, etc.) to remote (recommended: Gitee codes); pull to overwrite settings while preserving local search history (including an empty history); optional auto-push on changes.
- Themes: two built-in themes (Cyber Dark and Neo-Brutalism), switchable in Settings and stored with the config; both share the same information architecture (for example the history sidebar hides at the same narrow breakpoint).
- Language: switch Chinese/English in Settings.

### Install / Load

1. Open Chrome: `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select directory: `/Users/syy/Desktop/project/chrome-home-plugin`

### Sync (Recommended: Gitee codes)

1. On the New Tab page: "Settings" → "Sync"
2. Fill in:
   - `Git URL`: Gitee codes URL (e.g. `https://gitee.com/<user>/codes/<gistId>`)
   - `Token`: Gitee access token (with permission to the codes)
3. "Push" creates/updates `config.json` in the codes; "Pull" reads `config.json` and overwrites local config; or enable "Auto Sync"
