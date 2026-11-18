/**
 * @fileoverview
 * 界面文案词典与把文案写进 DOM 的工具。
 *
 * 注意：
 * - 语言状态（config.ui.language）由页面持有，这里只提供数据与纯 DOM 应用，
 *   便于页面按当前语言取词，也便于后续接入其它页面。
 * - 支持 data-i18n / data-i18n-placeholder / data-i18n-aria-label / data-i18n-title 四类标注。
 */

export const I18N = {
  zh: {
    open_settings: '设置',
    brand_mini: 'SMART SEARCH',
    hint: '一次输入 多个引擎 同时搜索',
    search_placeholder: '输入关键词开始搜索...',
    search_btn: 'SEARCH',
    clear_history: '清空历史',
    settings_appearance: '外观',
    settings_sync: '同步设置',
    settings_language: '语言',
    settings_about: '关于',
    language_label: '语言',
    theme_label: '主题',
    theme_cyber_dark: '赛博深色',
    theme_neo_brutalism: '新粗野',
    theme_save_error: '主题保存失败，已恢复原主题',
    sync_sub: '把配置存到代码片段、WebDAV 或 Chrome 账号同步，并保留历史版本可回滚。',
    sync_provider: '服务商',
    sync_provider_github: 'GitHub 代码片段',
    sync_provider_gitee: 'Gitee 代码片段',
    sync_provider_webdav: 'WebDAV（坚果云 / Nextcloud）',
    sync_provider_storage: 'Chrome 账号同步',
    sync_giturl: '代码片段地址',
    sync_giturl_ph: 'https://gist.github.com/<用户名>/<ID> 或 https://gitee.com/<用户名>/codes/<ID>',
    sync_webdav_url: 'WebDAV 目录地址',
    sync_webdav_url_ph: 'https://dav.jianguoyun.com/dav/chrome-home/',
    sync_username: '用户名',
    sync_token: 'Token / 密码',
    sync_token_ph: '代码片段填 Token，WebDAV 填应用密码',
    sync_sections: '同步内容',
    sync_section_cards: '网址卡片',
    sync_section_engines: '搜索引擎',
    sync_section_ui: '主题与语言',
    sync_section_history: '搜索历史',
    sync_snapshots: '备份版本',
    sync_snapshots_refresh: '刷新',
    sync_autopush: '自动同步',
    sync_autopush_desc: '配置变更后自动推送到远端',
    common_save: '保存',
    sync_push: '推送到远端',
    sync_pull: '从远端拉取',
    sync_test: '测试连接',
    sync_confirm_push: '远端版本与本机不同。用本机配置覆盖远端？',
    sync_confirm_pull: '本机有尚未上传的改动。用远端配置覆盖本机？',
    sync_clear_remote_history: '清除远端搜索历史',
    sync_clear_remote_history_confirm: '清除当前同步源的配置及插件备份中的搜索历史？本机历史会保留，服务商自己的文件修订不在清除范围内。',
    sync_clear_remote_history_disabled: '请先关闭搜索历史同步',
    sync_clear_remote_history_done: '已清除当前同步源中的搜索历史',
    sync_account_saved: '已写入本机 Chrome 同步存储',
    sync_last_sync_at: '最新同步时间：',
    card_title: '标题',
    card_title_ph: '例如：Google',
    card_url: '网址',
    card_url_ph: '例如：https://example.com',
    card_icon: 'Icon（选填，默认使用网站icon）',
    card_icon_ph: '例如：https://example.com/icon.png',
    common_cancel: '取消',
    confirm_title: '确认删除',
    common_confirm: '确认',
    add_choose_title: '新增',
    add_choose_card: '添加卡片',
    add_choose_component: '添加组件',
    component_list_title: '组件',
    component_hot: '热搜',
    component_stock: '股票',
    component_metals: '黄金白银',
    component_anniversary: '纪念日',
    hot_source_label: '来源',
    anniversary_title: '纪念日',
    anniversary_item_title: '标题',
    anniversary_item_title_ph: '例如：小胖达生日',
    anniversary_item_date: '日期',
    stock_title: '股票',
    stock_card_title: '标题',
    stock_card_title_ph: '例如：我的股票',
    stock_symbols_label: '股票代码',
    stock_symbols_ph: '例如：AAPL, MSFT, TSLA',
    stock_live_label: '实时行情',
    stock_updated_at: '更新于',
    stock_loading: '加载中...',
    stock_no_data: '暂无数据',
    stock_error: '加载失败，点击刷新重试',
    metals_title: '国际金价',
    metals_gold: '国际金价',
    metals_silver: '国际银价',
    metals_usd: '美元',
    metals_cny: '人民币',
    metals_loading: '加载中...',
    metals_error: '加载失败，点击刷新重试',
    component_weather: '天气',
    weather_title: '天气',
    weather_city_label: '城市名称',
    weather_city_ph: '例如：南京',
    weather_loading: '正在获取天气...',
    weather_error: '天气加载失败，点击刷新重试',
    weather_empty: '暂无天气数据',
    weather_humidity: '湿度',
    weather_updated_at: '更新于',
    weather_refresh: '刷新天气'
  },
  en: {
    open_settings: 'Settings',
    brand_mini: 'SMART SEARCH',
    hint: 'ONE INPUT, MULTIPLE ENGINES. INSTANT ACCESS.',
    search_placeholder: 'Enter keyword to search...',
    search_btn: 'SEARCH',
    clear_history: 'Clear History',
    settings_appearance: 'Appearance',
    settings_sync: 'Sync',
    settings_language: 'Language',
    settings_about: 'About',
    language_label: 'Language',
    theme_label: 'Theme',
    theme_cyber_dark: 'Cyber Dark',
    theme_neo_brutalism: 'Neo-Brutalism',
    theme_save_error: 'Could not save the theme. The previous theme was restored.',
    sync_sub: 'Store your config in a gist, WebDAV or Chrome account sync, with restorable versions.',
    sync_provider: 'Provider',
    sync_provider_github: 'GitHub Gist',
    sync_provider_gitee: 'Gitee Gist',
    sync_provider_webdav: 'WebDAV (Nutstore / Nextcloud)',
    sync_provider_storage: 'Chrome account sync',
    sync_giturl: 'Gist URL',
    sync_giturl_ph: 'https://gist.github.com/<user>/<id> or https://gitee.com/<user>/codes/<id>',
    sync_webdav_url: 'WebDAV folder URL',
    sync_webdav_url_ph: 'https://dav.jianguoyun.com/dav/chrome-home/',
    sync_username: 'Username',
    sync_token: 'Token / password',
    sync_token_ph: 'Gist token, or WebDAV app password',
    sync_sections: 'What to sync',
    sync_section_cards: 'Site cards',
    sync_section_engines: 'Search engines',
    sync_section_ui: 'Theme & language',
    sync_section_history: 'Search history',
    sync_snapshots: 'Versions',
    sync_snapshots_refresh: 'Refresh',
    sync_autopush: 'Auto Sync',
    sync_autopush_desc: 'Auto push changes to remote',
    common_save: 'Save',
    sync_push: 'Push',
    sync_pull: 'Pull',
    sync_test: 'Test',
    sync_confirm_push: 'The remote version differs. Replace it with your local configuration?',
    sync_confirm_pull: 'There are local changes that have not been uploaded. Replace them with the remote configuration?',
    sync_clear_remote_history: 'Clear remote search history',
    sync_clear_remote_history_confirm: 'Clear search history from this sync destination and its extension backups? Local history and revision history kept by the provider will remain.',
    sync_clear_remote_history_disabled: 'Turn off search history sync first',
    sync_clear_remote_history_done: 'Search history cleared from the current sync destination',
    sync_account_saved: 'Saved to Chrome sync storage on this device',
    sync_last_sync_at: 'Last sync:',
    card_title: 'Title',
    card_title_ph: 'e.g. Google',
    card_url: 'URL',
    card_url_ph: 'e.g. https://example.com',
    card_icon: 'Icon (optional, fallback to site icon)',
    card_icon_ph: 'e.g. https://example.com/icon.png',
    common_cancel: 'Cancel',
    confirm_title: 'Confirm delete',
    common_confirm: 'Confirm',
    add_choose_title: 'Add',
    add_choose_card: 'Add Card',
    add_choose_component: 'Add Component',
    component_list_title: 'Components',
    component_hot: 'Hot search',
    component_stock: 'Stocks',
    component_metals: 'Gold & Silver',
    component_anniversary: 'Anniversary',
    hot_source_label: 'Source',
    anniversary_title: 'Anniversary',
    anniversary_item_title: 'Title',
    anniversary_item_title_ph: 'e.g. Birthday',
    anniversary_item_date: 'Date',
    stock_title: 'Stocks',
    stock_card_title: 'Title',
    stock_card_title_ph: 'e.g. My Stocks',
    stock_symbols_label: 'Symbols',
    stock_symbols_ph: 'e.g. AAPL, MSFT, TSLA',
    stock_live_label: 'Live quotes',
    stock_updated_at: 'Updated',
    stock_loading: 'Loading...',
    stock_no_data: 'No data',
    stock_error: 'Load failed, click refresh to retry',
    metals_title: 'Gold',
    metals_gold: 'Gold',
    metals_silver: 'Silver',
    metals_usd: 'USD',
    metals_cny: 'CNY',
    metals_loading: 'Loading...',
    metals_error: 'Load failed, click refresh to retry',
    component_weather: 'Weather',
    weather_title: 'Weather',
    weather_city_label: 'City',
    weather_city_ph: 'e.g. Nanjing',
    weather_loading: 'Loading weather...',
    weather_error: 'Load failed, click refresh to retry',
    weather_empty: 'No weather data',
    weather_humidity: 'Humidity',
    weather_updated_at: 'Updated',
    weather_refresh: 'Refresh weather'
  }
}

/** 取指定语言的词典，未知语言回落中文。 */
export const getDict = (lang) => I18N[lang] || I18N.zh

/**
 * 把当前语言文案写入 DOM。
 *
 * @param {{root?: object, lang: string}} options 根节点与语言。
 * @returns {object} 使用的词典。
 */
export const applyTranslations = ({ root = typeof document === 'undefined' ? null : document, lang }) => {
  const dict = getDict(lang)
  if (!root) return dict

  const writeAll = (selector, attribute) => {
    for (const el of root.querySelectorAll(selector)) {
      const key = el.getAttribute(selector.slice(1, -1))
      if (!key) continue
      const value = dict[key]
      if (typeof value !== 'string') continue
      if (attribute === 'textContent') el.textContent = value
      else el.setAttribute(attribute, value)
    }
  }

  writeAll('[data-i18n]', 'textContent')
  writeAll('[data-i18n-placeholder]', 'placeholder')
  writeAll('[data-i18n-aria-label]', 'aria-label')
  writeAll('[data-i18n-title]', 'title')
  return dict
}

/**
 * 天气卡片文案。
 */
export const getWeatherText = (lang) => {
  const dict = getDict(lang)
  return {
    title: dict.weather_title || '天气',
    loading: dict.weather_loading || '正在获取天气...',
    error: dict.weather_error || '天气加载失败，点击刷新重试',
    empty: dict.weather_empty || '暂无天气数据',
    humidity: dict.weather_humidity || '湿度',
    updatedAt: dict.weather_updated_at || '更新于',
    refresh: dict.weather_refresh || '刷新天气'
  }
}

/**
 * 股票卡片文案。
 */
export const getStockText = (lang) => {
  const dict = getDict(lang)
  return {
    liveLabel: dict.stock_live_label || '实时行情',
    updatedAt: dict.stock_updated_at || '更新于',
    loading: dict.stock_loading || '加载中...',
    empty: dict.stock_no_data || '暂无数据',
    error: dict.stock_error || '加载失败，点击刷新重试'
  }
}

/**
 * 黄金白银卡片文案。
 */
export const getMetalsText = (lang) => {
  const dict = getDict(lang)
  return {
    title: dict.metals_title || '黄金白银',
    gold: dict.metals_gold || '国际金价',
    silver: dict.metals_silver || '国际银价',
    usd: dict.metals_usd || '美元',
    cny: dict.metals_cny || '人民币',
    loading: dict.metals_loading || '加载中...',
    error: dict.metals_error || '加载失败，点击刷新重试'
  }
}
