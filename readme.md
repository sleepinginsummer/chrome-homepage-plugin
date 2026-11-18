# chrome-home-plugin

[中文](#中文) | [English](#english)

## 中文

一个 Chrome 新标签页扩展：多引擎搜索 + 搜索历史 + 常用网址卡片 + 云同步备份（GitHub / Gitee 代码片段、WebDAV、Chrome 账号同步），并支持在设置中切换中英文界面。

### 功能

- 多引擎搜索：一次输入，按选择的多个引擎同时打开搜索结果标签页。
- 搜索历史：右侧浮层展示最近 20 条历史，搜索前保存到本机，点击可恢复搜索，支持清空。
- 网址卡片：新增/编辑卡片（标题 + 网址 + 可选 icon URL），支持拖拽排序、右键菜单删除/修改、点击打开。
- 云同步备份：四种同步源可切换——GitHub 代码片段、Gitee 代码片段、WebDAV（坚果云 / Nextcloud / Alist）、Chrome 账号同步（零配置）。可勾选同步内容（卡片 / 搜索引擎 / 主题与语言 / 搜索历史），可开启「配置变更后自动推送」。
- 备份回滚：每次推送前会把远端旧内容存成一份快照（默认保留 5 份），设置面板里可以逐个回滚；回滚动作本身也会先存一份，回滚错了还能再回来。
- 主题切换：内置「赛博深色」与「新粗野」两套主题，设置中可切换，选择跟随配置同步；两套主题的信息架构一致（例如历史侧栏在同样的窄屏断点才隐藏）。
- 语言切换：设置中可切换中文/英文（默认中文）。

### 安装/加载

1. 打开 Chrome：`chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`/xxx/xxx/chrome-home-plugin`

### 同步配置

新标签页点击「设置」→「同步设置」，先选服务商：

| 服务商 | 需要填 | 说明 |
| --- | --- | --- |
| GitHub 代码片段 | 代码片段地址（`https://gist.github.com/<用户名>/<ID>`）+ Token（需 `gist` 权限） | 支持备份快照 |
| Gitee 代码片段 | 代码片段地址（`https://gitee.com/<用户名>/codes/<ID>`）+ 私人令牌 | 支持备份快照 |
| WebDAV | 目录地址（如 `https://dav.jianguoyun.com/dav/chrome-home/`）+ 用户名 + 应用密码 | 支持备份快照；目录需先建好 |
| Chrome 账号同步 | 无 | 零配置，靠 Google 账号跨设备；受 100KB 配额限制，不保留备份版本 |

填好后「推送到远端」会把配置写进远端的 `config.json`，「从远端拉取」按勾选的分区覆盖本机设置。

几个行为约定：
- 同步 token 只存在本机 `chrome.storage.local`，**不会写进远端文件**；远端文档里不含 `sync` 字段。
- 搜索历史默认不同步（属于单台设备的使用痕迹），需要的话在「同步内容」里打开。
- 拉取只覆盖勾选的分区，未勾选的分区（如搜索历史，包括你主动清空的状态）保留本机值。
- 自动同步会保留尚未上传的本机改动；远端也有更新时暂停，请在设置里确认用哪一边覆盖。
- 关闭搜索历史同步后，本机的新历史不会再上传。要删除当前同步源及插件备份里的旧历史，点击「清除远端搜索历史」。本机历史、其他设备和服务商自身的文件修订不受此操作影响；其他设备也应关闭历史同步，以免再次上传。
- WebDAV 支持 HTTP 和 HTTPS。HTTP 会明文传输 WebDAV 凭据和配置，只建议用于可信内网。
- Chrome 账号同步在写入前检查 Chrome 的容量配额。插件可确认本机写入；是否发往其他设备由 Chrome 的账号同步设置和状态决定。

> 权限说明：GitHub 与 WebDAV 的域名放在 `optional_host_permissions`，只有在设置面板里点推送/拉取/测试时才按需申请，装扩展时不会一次性索要。Gitee 因为沿用旧版本权限，仍在 `host_permissions` 里。

### 本地冒烟测试（真机）

用 Chrome for Testing 真实加载未打包扩展，跑一遍主链路：页面启动、六类卡片渲染、四类行情卡片数据链路、搜索历史落盘、主题与语言切换、service worker 无异常。

```bash
npm run smoke:install   # 首次：下载 Chrome for Testing 到用户缓存目录（约 190MB，可随时删除）
npm run smoke           # 一轮约 30 秒
```

- 为什么不用本机 Chrome：stable 版已禁止命令行 `--load-extension`，只有 Chrome for Testing / Chromium 能这样加载未打包扩展；也可以直接用 `CHROME_BIN` 指定已装好的这类浏览器。
- 冒烟用独立临时 profile，不碰你本机 Chrome 的数据；结束时会把冒烟写入的卡片与历史清掉。
- 天气使用固定接口响应，必须成功渲染温度。其他行情卡片只校验离开加载状态，避免第三方服务不可用时阻断冒烟。

### 发布到 Chrome 应用商店

```bash
npm run package            # 生成 dist/chrome-home-plugin-v<version>.zip
npm run publish:webstore   # 上传并提交审核
```

- 需要环境变量 `CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN`、`CWS_PUBLISHER_ID`、`CWS_ITEM_ID`；来源与流程见 `scripts/publish-webstore.mjs` 头部说明。
- `CWS_UPLOAD_ONLY=1` 只上传不提交，适合先在后台看状态。
- 改了 `permissions` 或 `optional_host_permissions` 之后，后台「隐私惯例」里的权限理由要同步改，否则审核会打回。
- 走代理的机器要加 `NODE_USE_ENV_PROXY=1`，Node 的 fetch 默认不吃 `HTTPS_PROXY`。变量可放 `~/.config/cws/env`（`chmod 600`），用 `set -a; . ~/.config/cws/env; set +a` 注入。

## English

A Chrome New Tab extension: multi-engine search + search history + site cards + cloud sync & backup (GitHub / Gitee gists, WebDAV, Chrome account sync). The UI language can be switched between Chinese and English (default: Chinese).

### Local smoke test (real browser)

Loads the unpacked extension in Chrome for Testing and exercises the main paths: page boot, all six card types rendering, the four quote-card data paths, search-history persistence, theme and language switching, and a clean service worker.

```bash
npm run smoke:install   # first run: downloads Chrome for Testing into the user cache dir (~190MB, safe to delete)
npm run smoke           # ~30 seconds per run
```

- Why not your own Chrome: stable builds reject `--load-extension` on the command line; only Chrome for Testing / Chromium builds can load unpacked extensions this way. You can also point `CHROME_BIN` at one you already have.
- The smoke run uses a throwaway profile and cleans up the cards/history it wrote.
- Weather must render a temperature from a fixed response. Other quote cards only need to leave the loading state.

### Publish to the Chrome Web Store

```bash
npm run package            # builds dist/chrome-home-plugin-v<version>.zip
npm run publish:webstore   # upload + submit for review
```

- Needs `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_ITEM_ID`; see the header of `scripts/publish-webstore.mjs` for where each one comes from.
- `CWS_UPLOAD_ONLY=1` uploads without submitting, handy for checking the state in the dashboard first.
- If `permissions` or `optional_host_permissions` changed, update the justifications under Privacy practices in the dashboard too, otherwise review bounces.
- Behind a proxy, add `NODE_USE_ENV_PROXY=1`: Node's fetch ignores `HTTPS_PROXY`. The variables can live in `~/.config/cws/env` (`chmod 600`), injected with `set -a; . ~/.config/cws/env; set +a`.

### Features

- Multi-engine search: one input, open results in multiple engines at once.
- Search history: the latest 20 terms are saved locally before navigation, with click-to-search and clear-all.
- Site cards: create/edit cards (title + URL + optional icon URL), drag to reorder, right-click menu to edit/delete, click to open.
- Cloud sync & backup: four providers — GitHub Gist, Gitee Gist, WebDAV (Nutstore / Nextcloud / Alist), Chrome account sync (zero config). Pick which sections sync (cards / engines / theme & language / history) and optionally auto-push on changes.
- Restorable versions: every push stores the previous remote content as a snapshot (5 by default). Restoring is itself a push, so a wrong rollback can be undone.
- Themes: two built-in themes (Cyber Dark and Neo-Brutalism), switchable in Settings and stored with the config; both share the same information architecture (for example the history sidebar hides at the same narrow breakpoint).
- Language: switch Chinese/English in Settings.

### Install / Load

1. Open Chrome: `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select directory: `/Users/syy/Desktop/project/chrome-home-plugin`

### Sync

On the New Tab page: "Settings" → "Sync", then pick a provider:

| Provider | Needs | Notes |
| --- | --- | --- |
| GitHub Gist | Gist URL (`https://gist.github.com/<user>/<id>`) + token with `gist` scope | Keeps restorable versions |
| Gitee Gist | Gitee codes URL (`https://gitee.com/<user>/codes/<id>`) + personal token | Keeps restorable versions |
| WebDAV | Folder URL (e.g. `https://dav.jianguoyun.com/dav/chrome-home/`) + username + app password | Keeps restorable versions; create the folder first |
| Chrome account sync | Nothing | Zero config, syncs via your Google account; 100KB quota, no versions |

"Push" writes `config.json` to the remote; "Pull" overwrites the selected sections locally.

- The sync token stays in `chrome.storage.local` and is never written to the remote file.
- Search history is not synced by default; enable it under "What to sync".
- Turn off history sync to stop uploading new searches. Use **Clear remote search history** to remove history from the current sync document and the extension's backups. Local history and the provider's own file revisions remain. Turn off history sync on other devices to prevent re-upload.
- Pending local changes survive browser restarts. If the remote has also changed, choose which version to keep in Settings.
- WebDAV supports both HTTP and HTTPS. HTTP transmits credentials and configuration without encryption; use it only on a trusted network.
- Chrome account sync checks capacity before writing. A successful write confirms storage on this device; Chrome controls replication to other devices.
- GitHub and WebDAV access is requested when you use the relevant sync actions in Settings.
