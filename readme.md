# chrome-home-plugin

[中文](#中文) | [English](#english)

## 中文

一个 Chrome 新标签页扩展：多引擎搜索 + 搜索历史 + 常用网址卡片 + 配置同步（优先使用 Gitee 代码片段），并支持在设置中切换中英文界面。

### 功能

- 多引擎搜索：一次输入，按选择的多个引擎同时打开搜索结果标签页。
- 搜索历史：右侧浮层展示历史，点击可恢复搜索，支持清空。
- 网址卡片：新增/编辑卡片（标题 + 网址 + 可选 icon URL），支持拖拽排序、右键菜单删除/修改、点击打开。
- 配置同步：把当前配置（搜索引擎选择、历史、卡片、同步信息等）推送到远端（推荐：Gitee 代码片段），也支持从远端拉取覆盖本地配置；可开启“配置变更后自动推送”。
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
3. 点击「推送到远端」会在该代码片段中创建/更新 `config.json`；「从远端拉取」会读取 `config.json` 覆盖本地配置；也可开启「自动同步」

> 注意：这是扩展页面发起的网络请求，需要在扩展的 `host_permissions` 中允许对应域名（本项目已包含 `api.github.com` 与 `gitee.com`）。

## English

A Chrome New Tab extension: multi-engine search + search history + site cards + config sync (recommended: Gitee codes). The UI language can be switched between Chinese and English (default: Chinese).

### Features

- Multi-engine search: one input, open results in multiple engines at once.
- Search history: sidebar list with click-to-search and clear-all.
- Site cards: create/edit cards (title + URL + optional icon URL), drag to reorder, right-click menu to edit/delete, click to open.
- Config sync: push the current config (engines selection, history, cards, sync settings, etc.) to remote (recommended: Gitee codes); pull to overwrite local config; optional auto-push on changes.
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
