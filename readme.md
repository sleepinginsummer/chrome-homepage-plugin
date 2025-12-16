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

我现在需要做一个热搜的卡片，大小和纪念日一样，每个卡片需要选一个来源，就是接口的title参数，同时title也是卡片的title作为卡片的头部显示，卡片下方的是可以滚动的一条条的热搜
https://bot.znzme.com/dailyhot?title=知乎
title 可以从这些中选择：哔哩哔哩，百度，知乎，百度贴吧，少数派，IT之家，澎湃新闻，今日头条，微博热搜，36氪，稀土掘金，腾讯新闻

这个是接口返回的json
{"data": [{"title": "万岁山武侠城前 10 月营收超 10 亿，接待游客两千多万，这算文旅业成功案例吗？哪些经验值得借鉴？", "link": "https://www.zhihu.com/question/1979526699818435955"}, {"title": "如何看待逃离鸭科夫mod作者通过mod内黑名单禁止用户进入游戏？", "link": "https://www.zhihu.com/question/1983452497533219380"}, {"title": "欧洲六代机项目再起波折，达索与空客争夺80%控制权，德国工会以不信任为由要求逐出达索，如何看待此事？", "link": "https://www.zhihu.com/question/1982469068020802039"}, {"title": "如何评价算执导，江奇霖主演的 731 主题电视剧《反人类暴行》？", "link": "https://www.zhihu.com/question/1983328142488724509"}, {"title": "7 岁男童坠亡，事发前偷拿文具店玩具被斥责，涉事店家是否需担责？儿童犯错，教育时应注意哪些方式方法？", "link": "https://www.zhihu.com/question/1983961820948554366"}, {"title": "孙悟空经常遇难就找观音，为什么到了镇元子哪里就没有直接去找观音?", "link": "https://www.zhihu.com/question/665095251"}, {"title": "北京保利拍卖发声明，称郭沫若手卷上拍流程合规，此前郭沫若之女声称作品遗失，法律层面如何界定该作品归属？", "link": "https://www.zhihu.com/question/1982793755644883981"}, {"title": "如果华为海思上市，会达到摩尔线程一半的市值吗？", "link": "https://www.zhihu.com/question/1983140374206756378"}, {"title": "我国已经进入拉尼娜状态，专家预测可能出现冬春连旱，「拉尼娜状态」是什么？这会带来哪些影响？", "link": "https://www.zhihu.com/question/1983597834075906696"}, {"title": "甲和乙游戏一次的胜率是p，但甲输后可以耍赖宣布三局两胜，如再输就五局三胜，无限下去，甲胜率多少？", "link": "https://www.zhihu.com/question/1911827962799563646"}, {"title": "高速铁轨为什么没有伸缩缝，热胀冷缩问题是怎么解决的?", "link": "https://www.zhihu.com/question/29294246"}, {"title": "跳槽离职前的最后一天，你会在工位上做什么？", "link": "https://www.zhihu.com/question/652234883"}, {"title": "宇宙为什么要大费周章地创造对它毫无用处的生命？", "link": "https://www.zhihu.com/question/439249174"}, {"title": "怎么学英语最快？", "link": "https://www.zhihu.com/question/20622292"}, {"title": "澳大利亚枪击案已致16死40伤，嫌疑人持有合法持枪执照，当地枪支管控是怎么样的？现场当时有多凶险？", "link": "https://www.zhihu.com/question/1983843588359020649"}, {"title": "韩国人有没有想过用阿根廷牛肉，猪脚饭来提高老百姓肉食蛋白质量?", "link": "https://www.zhihu.com/question/6829552936"}, {"title": "智商140以上的人会怎样感知世界？", "link": "https://www.zhihu.com/question/396673634"}, {"title": "有没有一种可能，时间本身不存在?", "link": "https://www.zhihu.com/question/614783412"}, {"title": "网红张凯毅开办免费艺术展，有孩子将其丈夫亲手打造的4斤重的黄金凤冠碰触倒地，导致损伤，此事该如何评价？", "link": "https://www.zhihu.com/question/1983499407107319760"}, {"title": "《怦然心动》导演罗伯·莱纳与妻子家中遇害，其子被列为嫌疑人，具体情况如何？你对他的哪部影片印象深刻？", "link": "https://www.zhihu.com/question/1983885513497732818"}, {"title": "「亚运三金王」王莉举报被领导索要 15 万元比赛奖金，怎么回事？暴露出体育行业哪些问题？", "link": "https://www.zhihu.com/question/1983833834140243856"}, {"title": "在相声和小品中，什么样的包袱才能称为高级包袱？", "link": "https://www.zhihu.com/question/65594015"}, {"title": "市场监管总局公开征求意见，拟禁止车企亏本卖车，并要求明码标价，从市场和经济角度如何解读？新车会涨价么？", "link": "https://www.zhihu.com/question/1983654252980216881"}, {"title": "健身要练一休一否则容易脱发发炎甚至内脏功能异常，体力劳动一天十来个小时却很少休息，如何看待这两种情况？", "link": "https://www.zhihu.com/question/1982170069824983547"}, {"title": "有什么书让你看完之后逢人就推荐？", "link": "https://www.zhihu.com/question/29054752"}, {"title": "你见过哪些有趣且迷惑的动物行为？", "link": "https://www.zhihu.com/question/566699567"}, {"title": "澳大利亚沙滩枪击案中，路人徒手夺枪，如何评价其英勇行为？", "link": "https://www.zhihu.com/question/1983644405865923216"}, {"title": "大众不理解的艺术是意味着大众审美低下，还是先锋艺术本身就脱离了艺术应有的能被一定程度理解和感受的本质？", "link": "https://www.zhihu.com/question/3078450734"}, {"title": "为什么隐身战斗机使用有源雷达？ 一旦发射电磁波，不是很容易被敌方探测到吗？", "link": "https://www.zhihu.com/question/1937460049028027737"}, {"title": "网上有文章称「看视频开倍速可能伤害大脑」，如何理解「浅层认知模式」并平衡效率与认知健康？", "link": "https://www.zhihu.com/question/1980475729713058077"}]}