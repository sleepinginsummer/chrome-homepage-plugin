/**
 * @fileoverview
 * 天气卡片的域控制器：把天气卡片的渲染、拉取、刷新、增删改弹窗从 newtab.js 拆出来。
 *
 * 设计目标：
 * - 与 theme-controller 同样的注入风格：卡片存储、重渲染与 i18n 仍由页面决定，
 *   控制器不直接读写 config，也不持有页面状态。
 * - 天气缓存按城市失效，卡片删除/改城市时由 cleanup 负责回收。
 */

import { createWeatherClient } from './weather.js'
import { renderWeatherCardHtml, updateWeatherCardDom } from './weather-card.js'

const CARD_TYPE = 'weather'
const RENDER_TOKEN_KEY = 'weatherRenderToken'
const ITEM_ACTION_SELECTOR = '[data-weather-action]'
const INITIAL_LOAD_DELAY_MS = 800

/**
 * 默认根节点。node 测试环境没有 document，这里必须用 typeof 探测而不是直接引用 document。
 */
const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建天气卡片控制器。
 *
 * @param {object} options
 * @param {object} options.storage chrome.storage.local（默认天气客户端用它做离线缓存）。
 * @param {function(): string} options.getLang 当前语言。
 * @param {function(): object} options.getText 天气卡片文案（页面持有 i18n 字典）。
 * @param {function(function(), number): *} options.runWhenIdle 空闲调度，用于延迟首屏拉取。
 * @param {object} options.cards 卡片仓储门面：
 *   list() 读取卡片数组；getById(id) 取单张卡片；
 *   persist(next) 写入并持久化；apply() 重渲染并触发自动推送。
 * @param {function(): void} [options.closeOverlays] 打开卡片弹窗前收起其它浮层（组件列表/卡片菜单）。
 * @param {object} [options.client] 天气客户端，默认按 storage 创建，测试可注入替身。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ renderHtml: function(object): string, initialize: function(object, object): void,
 *   handleClick: function(object, object): Promise<void>, refresh: function(string): Promise<void>,
 *   cleanup: function(object, Array): Promise<void>, openModal: function(object): void,
 *   closeModal: function(): void, bindModalUi: function(): void }}
 */
export const createWeatherCardController = ({
  storage,
  getLang,
  getText,
  runWhenIdle,
  cards,
  closeOverlays,
  client = createWeatherClient({ storage }),
  root = getDocument()
}) => {
  // 重要逻辑：弹窗模式属于卡片域内部状态，页面不需要知道。
  let modalMode = 'create'
  let editingCardId = null

  const $ = (selector) => root?.querySelector?.(selector) || null
  const t = (zh, en) => (getLang?.() === 'en' ? en : zh)
  const getCity = (card) => String(card?.city || '').trim()
  const getCardTitle = (city) => (getLang?.() === 'en' ? `${city} Weather` : `${city}天气`)

  /**
   * 拉取并写入卡片 DOM；失败时写入错误态，卡片本身保留。
   */
  const load = async (card, { cardEl, renderToken, forceRefresh = false }) => {
    const text = getText()
    try {
      const data = await client.load(getCity(card), { forceRefresh })
      updateWeatherCardDom({ cardEl, renderToken, data, text })
    } catch {
      updateWeatherCardDom({ cardEl, renderToken, errorText: text.error, text })
    }
  }

  const renderHtml = (card) => renderWeatherCardHtml(card, getText())

  /**
   * 卡片挂载后延迟拉取，避免新标签页首屏被网络请求拖慢。
   */
  const initialize = (card, cardEl) => {
    const renderToken = crypto.randomUUID()
    cardEl.dataset[RENDER_TOKEN_KEY] = renderToken
    void runWhenIdle(() => load(card, { cardEl, renderToken }), INITIAL_LOAD_DELAY_MS)
  }

  const refresh = async (cardId) => {
    const card = cards.getById(cardId)
    if (!card || (card.type || 'link') !== CARD_TYPE) return
    const cardEl = $(`.card[data-card-id="${card.id}"]`)
    const renderToken = cardEl?.dataset?.[RENDER_TOKEN_KEY]
    if (!cardEl || !renderToken) {
      // 卡片还没渲染（或在别的标签页被删了），整体重渲染一次。
      cards.apply()
      return
    }
    await load(card, { cardEl, renderToken, forceRefresh: true })
  }

  const handleClick = async (card, evt) => {
    const actionEl = evt.target?.closest?.(ITEM_ACTION_SELECTOR)
    if (actionEl?.dataset?.weatherAction === 'refresh') {
      evt.preventDefault()
      evt.stopPropagation()
      await refresh(card.id)
      return
    }
    openModal({ mode: 'edit', cardId: card.id })
  }

  /**
   * 回收城市缓存：还有卡片用同一个城市时保留，否则失效。
   */
  const cleanup = async (card, remainingCards) => {
    const city = getCity(card)
    const stillUsed = remainingCards.some((item) => item?.type === CARD_TYPE && getCity(item) === city)
    if (city && !stillUsed) await client.invalidate(city)
  }

  const closeModal = () => {
    const overlay = $('#weatherOverlay')
    if (overlay) overlay.hidden = true
    editingCardId = null
    modalMode = 'create'
  }

  const openModal = ({ mode, cardId }) => {
    const overlay = $('#weatherOverlay')
    const titleEl = $('#weatherModalTitle')
    const cityInput = $('#weatherCityInput')
    const card = mode === 'edit' ? cards.getById(cardId) : null
    modalMode = mode === 'edit' ? 'edit' : 'create'
    editingCardId = mode === 'edit' ? cardId : null
    if (titleEl) {
      titleEl.textContent = mode === 'edit' ? t('天气设置', 'Weather settings') : t('新增天气', 'Add weather')
    }
    if (cityInput) cityInput.value = getCity(card)
    if (overlay) overlay.hidden = false
    closeOverlays?.()
    requestAnimationFrame(() => cityInput?.focus())
  }

  const addComponent = async (city) => {
    const next = [...cards.list()]
    next.push({ id: crypto.randomUUID(), type: CARD_TYPE, city, title: getCardTitle(city) })
    await cards.persist(next)
    cards.apply()
  }

  const savePatch = async (cardId, city) => {
    const next = [...cards.list()]
    const index = next.findIndex((card) => card.id === cardId)
    if (index === -1) return
    const previousCard = next[index]
    next[index] = { ...next[index], city, title: getCardTitle(city) }
    await cards.persist(next)
    // 重要逻辑：先失效旧城市缓存再重渲染，避免新城市直接读到旧数据。
    // 这里类型已确定是天气卡，直接调本模块的 cleanup，不走宿主的跨类型分发。
    await cleanup(previousCard, next)
    cards.apply()
  }

  /**
   * 弹窗提交：编辑态改城市，新增态追加卡片。
   */
  const submitModal = async () => {
    const cityInput = $('#weatherCityInput')
    if (!cityInput) return
    const city = cityInput.value.trim()
    if (!city) {
      cityInput.setCustomValidity(t('请输入城市名称', 'Enter a city'))
      cityInput.reportValidity()
      return
    }
    if (modalMode === 'edit' && editingCardId) await savePatch(editingCardId, city)
    else await addComponent(city)
    closeModal()
  }

  /**
   * 绑定天气弹窗自身的元素；新增按钮由页面的组件列表统一处理。
   */
  const bindModalUi = () => {
    const overlay = $('#weatherOverlay')
    const closeBtn = $('#weatherCloseBtn')
    const cancelBtn = $('#weatherCancelBtn')
    const form = $('#weatherForm')
    const cityInput = $('#weatherCityInput')

    overlay?.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal()
    })
    closeBtn?.addEventListener('click', closeModal)
    cancelBtn?.addEventListener('click', closeModal)
    cityInput?.addEventListener('input', () => cityInput.setCustomValidity(''))
    form?.addEventListener('submit', async (evt) => {
      evt.preventDefault()
      await submitModal()
    })
  }

  return { renderHtml, initialize, handleClick, refresh, cleanup, openModal, closeModal, bindModalUi }
}
