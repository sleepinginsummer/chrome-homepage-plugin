# chrome-home-plugin

一个 Chrome 新标签页扩展：多引擎搜索 + 常用网址卡片 + 配置同步（GitHub/Gitee）。

## 功能

- 多引擎搜索：一键同时在多个引擎打开搜索结果（Google/Bing/DuckDuckGo/GitHub/Baidu）。
- 搜索历史：右侧浮层展示历史，点击可恢复搜索，支持清空。
- 网址卡片：在搜索框下方新增卡片（标题 + 网址），自动显示网站图标（favicon），支持删除/点击打开。
- 配置同步：支持把当前配置推送到 GitHub/Gitee 仓库中的一个 JSON 文件，也支持从远端拉取覆盖本地配置。

## 安装/加载

1. 打开 Chrome：`chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`/Users/syy/Desktop/project/chrome-home-plugin`

## 同步配置（GitHub / Gitee）

1. 新标签页点击「同步设置」打开选项页
2. 填写：
   - `Owner/Namespace`、`Repo`、`Branch`
   - `Path`：配置文件路径（例如 `chrome-home-plugin/config.json`）
   - `Token`：GitHub Token 或 Gitee 私人令牌（需要对目标仓库有写权限）
3. 点击「推送到远端」或「从远端拉取」

> 注意：由于这是扩展页面发起的网络请求，需要在扩展的 `host_permissions` 中允许对应域名（本项目已包含 `api.github.com` 与 `gitee.com`）。


1.网址卡片可以拖动调换位置 
2.右键网址卡片可以修改
3.卡片的样式改成 图标+下方title的样式
4.同步设置放到右上角改为设置，点击之后出现一个弹窗，弹窗左边是菜单，一个菜单就是同步测试，第二个菜单是关于，关于先空着
5.右侧的搜索历史样式现在丢失了，参考之前的项目复刻一下/Users/syy/Desktop/project/tool-project/
6.搜索网站的复选框的现在多一个外框，和之前项目样式不一致/Users/syy/Desktop/project/tool-project/ 需要保持一致