# 隐私政策 / Privacy Policy

Smart Home Tab（下称"本扩展"，原 Chrome Home Plugin）

最后更新：2026-10-29

## 你的数据存在哪里

本扩展不使用任何作者自建的服务器，也不会把用户数据上传到作者。

- 扩展配置、网址卡片、搜索历史、主题与语言设置：保存在浏览器本地存储（`chrome.storage.local`）中，仅存在于你自己的电脑上。
- 配置同步 token（可选功能）：保存在浏览器本地存储中；只有你主动填写并开启同步时，才会请求你指定的 Gitee 代码片段地址来读写你自己的配置文件。

## 会发起的网络请求

以下请求由扩展页面直接发起，仅用于渲染新标签页上的内容，作者不接收、不存储这些请求或其中的数据：

| 目的 | 目标域名 | 发送内容 |
| --- | --- | --- |
| 城市天气与预报 | bot.znzme.com | 你在天气卡片中填写的城市名 |
| 热搜榜单 | bot.znzme.com | 你选择的榜单来源名称 |
| 股票行情 | qt.gtimg.cn | 你在自选股卡片中填写的股票代码 |
| 黄金白银报价 | api.gold-api.com | 无用户数据 |
| 美元兑人民币汇率 | open.er-api.com | 无用户数据 |
| 配置同步（可选） | gitee.com | 你自己的配置文件内容与 token |
| 网址卡片图标 | 卡片对应站点、favicon.im、Chrome favicon API | 卡片网址 |

## 不收集什么

- 不做用户行为分析、不做埋点，没有第三方统计 SDK
- 不含广告、不投放广告、不读取或修改你的登录状态
- 不读取你浏览的网页内容，不向网页注入脚本
- 不收集设备的精确位置（天气城市由你手动填写）

## 权限说明

- `storage`：保存上述配置与历史
- `favicon`：在网址卡片上显示站点图标
- 各站点主机权限：仅用于上表列出的内容请求

## 删除数据

卸载扩展即可删除全部本地数据；也可以在新标签页的设置面板中清空搜索历史或删除卡片。

## 联系方式

如对隐私有疑问，请通过 Chrome 应用商店页面上显示的开发者邮箱联系。

---

# Privacy Policy (English)

Smart Home Tab stores all configuration, cards and search history in your browser's local storage (`chrome.storage.local`). The developer operates no servers and does not collect, transmit or sell your data.

Optional config sync talks only to the Gitee snippet URL you configure yourself. Network requests are limited to the weather, trending, stock, precious-metal, exchange-rate and favicon endpoints listed above, and are used solely to render the new tab page.

No analytics, no ads, no tracking, no web page content access. Uninstalling the extension removes all locally stored data.
