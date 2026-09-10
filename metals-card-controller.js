/**
 * @fileoverview
 * 黄金白银卡片控制器：报价缓存调度、刷新、点击与新增组件。
 *
 * 设计目标：
 * - 数据与渲染分别在 metals.js / metals-card.js，这里只做编排。
 * - 配置读写走页面注入的 cardRepository，外链打开由页面提供。
 *
 * 注意：
 * - 定时轮询由页面的 initializePollingCard 统一调度（与股票共用），控制器只暴露 loadData。
 * - 黄金白银卡片没有配置弹窗，新增即取当前文案作为标题。
 */

import { createMetalsClient } from './metals.js'
import { renderMetalsCardHtml, updateMetalsCardDom } from './metals-card.js'

const CARD_TYPE = 'metals'
const ITEM_ACTION_SELECTOR = '[data-metals-action]'
const ITEM_SYMBOL_SELECTOR = '[data-metals-symbol]'
const QUOTE_PAGE_BASE = 'https://finance.yahoo.com/quote/'

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建黄金白银卡片控制器。
 *
 * @param {object} options
 * @param {function(): string} options.getLang 当前语言。
 * @param {function(): object} options.getText 黄金白银卡片文案（页面持有 i18n 字典）。
 * @param {object} options.cards 卡片仓储门面：list/persist/apply，语义同其它域控制器。
 * @param {function(string): Promise<void>} [options.openUrl] 打开行情详情页。
 * @param {function(object): Promise<object>} [options.send] 扩展内部消息发送，默认客户端用它取报价。
 * @param {object} [options.client] 报价客户端，默认按 send 创建，测试可注入替身。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ renderHtml: function(object): string, loadData: function(object, object): Promise<void>,
 *   handleClick: function(object, object): Promise<void>, refresh: function(string): Promise<void>,
 *   addComponent: function(): Promise<void> }}
 */
export const createMetalsCardController = ({
  getLang,
  getText,
  cards,
  openUrl,
  send,
  client = createMetalsClient({ send }),
  root = getDocument()
}) => {
  const $ = (selector) => root?.querySelector?.(selector) || null

  const renderHtml = (card) => renderMetalsCardHtml(card, { text: getText(), lang: getLang?.() })

  /**
   * 拉取报价并写入卡片 DOM；失败时写入错误态，卡片本身保留。
   */
  const loadData = async (card, { cardEl, renderToken, forceRefresh = false }) => {
    const text = getText()
    const lang = getLang?.()
    try {
      const items = await client.load(card.id, { forceRefresh })
      updateMetalsCardDom({ cardEl, renderToken, items, text, lang })
    } catch (error) {
      console.error('[chrome-home] metalsCard:loadFailed', error?.message || String(error))
      updateMetalsCardDom({ cardEl, renderToken, items: [], errorText: text.error, text, lang })
    }
  }

  const refresh = async (cardId) => {
    const card = cards.getById(cardId)
    if (!card || (card.type || 'link') !== CARD_TYPE) return
    client.invalidate(card.id)
    const cardEl = $(`.card[data-card-id="${card.id}"]`)
    const renderToken = cardEl?.dataset?.metalsRenderToken
    if (!cardEl || !renderToken) {
      // 卡片还没渲染（或在别的标签页被删了），整体重渲染一次。
      cards.apply()
      return
    }
    await loadData(card, { cardEl, renderToken, forceRefresh: true })
  }

  const handleClick = async (card, evt) => {
    const actionEl = evt.target?.closest?.(ITEM_ACTION_SELECTOR)
    if (actionEl?.dataset?.metalsAction === 'refresh') {
      evt.preventDefault()
      evt.stopPropagation()
      await refresh(card.id)
      return
    }
    const itemEl = evt.target?.closest?.(ITEM_SYMBOL_SELECTOR)
    const symbol = itemEl?.dataset?.metalsSymbol
    if (!symbol) return
    await openUrl?.(`${QUOTE_PAGE_BASE}${encodeURIComponent(symbol)}`)
  }

  /**
   * 新增黄金白银组件：标题取当前语言的默认文案。
   */
  const addComponent = async () => {
    const next = [...cards.list()]
    next.push({
      id: crypto.randomUUID(),
      type: CARD_TYPE,
      title: getText().title
    })
    await cards.persist(next)
    cards.apply()
  }

  return { renderHtml, loadData, handleClick, refresh, addComponent }
}
