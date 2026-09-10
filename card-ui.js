/**
 * @fileoverview
 * 卡片相关的通用浮层：右键菜单、确认弹窗、新增选择器与组件列表，并把各域弹窗一次性绑定好。
 *
 * 设计目标：
 * - 页面只负责创建各域控制器并注入，这里处理菜单/确认/选择器之间的优先级与互斥。
 * - 编辑入口按卡片类型分发到对应域控制器，链接卡片走 link-card-controller。
 *
 * 注意：
 * - Escape 的生效顺序是菜单 → 确认 → 各域弹窗 → 组件列表 → 新增选择器（与迁移前一致）。
 * - 右键菜单坐标会按视口夹紧，避免贴边时跑出屏幕。
 */

const DEFAULT_TYPE = 'link'
const MENU_MARGIN = 8

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 创建卡片浮层控制器。
 *
 * @param {object} options
 * @param {function(string): object} options.getCardById 按 id 取卡片。
 * @param {function(string): Promise<void>} options.onDeleteCard 删除卡片（由卡片网格实现）。
 * @param {function(string=): void} [options.setError] 页面级错误提示位。
 * @param {object} options.domains 各域控制器：link/weather/hot/stock/metals/anniversary。
 * @param {object} [options.root=document] DOM 根节点。
 * @returns {{ init: function(): void, openMenu: function(object): void, closeMenu: function(): void,
 *   openAddChooser: function(): void, closeAddChooser: function(): void,
 *   openComponentList: function(): void, closeComponentList: function(): void,
 *   openConfirm: function(object): void, closeConfirm: function(): void }}
 */
export const createCardUi = ({
  getCardById,
  onDeleteCard,
  setError,
  domains,
  root = getDocument()
}) => {
  const $ = (selector) => root?.querySelector?.(selector) || null
  let contextCardId = null
  let confirmAction = null

  const closeMenu = () => {
    const menu = $('#cardMenu')
    if (menu) menu.hidden = true
    contextCardId = null
  }

  const openMenu = ({ x, y, cardId }) => {
    const menu = $('#cardMenu')
    if (!menu) return
    contextCardId = cardId
    menu.hidden = false
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect()
      const maxLeft = window.innerWidth - rect.width - MENU_MARGIN
      const maxTop = window.innerHeight - rect.height - MENU_MARGIN
      menu.style.left = `${clamp(x, MENU_MARGIN, maxLeft)}px`
      menu.style.top = `${clamp(y, MENU_MARGIN, maxTop)}px`
    })
  }

  const closeConfirm = () => {
    const overlay = $('#confirmOverlay')
    if (overlay) overlay.hidden = true
    confirmAction = null
  }

  const openConfirm = ({ title, text, onConfirm }) => {
    const overlay = $('#confirmOverlay')
    if (!overlay) return
    const titleEl = $('#confirmTitle')
    const textEl = $('#confirmText')
    if (titleEl) titleEl.textContent = title
    if (textEl) textEl.textContent = text
    confirmAction = onConfirm
    overlay.hidden = false
    closeMenu()
  }

  const closeAddChooser = () => {
    const overlay = $('#addChooserOverlay')
    if (overlay) overlay.hidden = true
  }

  const openAddChooser = () => {
    setError?.('')
    const overlay = $('#addChooserOverlay')
    if (overlay) overlay.hidden = false
  }

  const closeComponentList = () => {
    const overlay = $('#componentListOverlay')
    if (overlay) overlay.hidden = true
  }

  const openComponentList = () => {
    closeAddChooser()
    const overlay = $('#componentListOverlay')
    if (overlay) overlay.hidden = false
  }

  /**
   * 按卡片类型打开对应的编辑入口。
   */
  const openCardEditor = (card) => {
    const type = card?.type || DEFAULT_TYPE
    if (type === 'anniversary') domains.anniversary.openModal(card.id)
    else if (type === 'hot') domains.hot.openModal({ mode: 'edit', cardId: card.id })
    else if (type === 'stock') domains.stock.openModal({ mode: 'edit', cardId: card.id })
    else if (type === 'weather') domains.weather.openModal({ mode: 'edit', cardId: card.id })
    else if (type === 'metals') closeMenu()
    else domains.link.openModal({ mode: 'edit', card })
  }

  const init = () => {
    const menu = $('#cardMenu')
    const confirmOverlay = $('#confirmOverlay')
    const addChooserOverlay = $('#addChooserOverlay')
    const componentListOverlay = $('#componentListOverlay')

    root?.addEventListener?.('click', (evt) => {
      if (!menu || menu.hidden) return
      if (menu.contains(evt.target)) return
      closeMenu()
    })

    root?.addEventListener?.('keydown', (evt) => {
      if (evt.key !== 'Escape') return
      if (menu && !menu.hidden) closeMenu()
      else if (confirmOverlay && !confirmOverlay.hidden) closeConfirm()
      else if (!$('#cardModalOverlay')?.hidden) domains.link.closeModal()
      else if (!$('#anniversaryOverlay')?.hidden) domains.anniversary.closeModal()
      else if (!$('#hotOverlay')?.hidden) domains.hot.closeModal()
      else if (!$('#stockOverlay')?.hidden) domains.stock.closeModal()
      else if (componentListOverlay && !componentListOverlay.hidden) closeComponentList()
      else if (addChooserOverlay && !addChooserOverlay.hidden) closeAddChooser()
    })

    $('#cardMenuEditBtn')?.addEventListener('click', () => {
      const card = getCardById(contextCardId)
      if (!card) return closeMenu()
      openCardEditor(card)
    })

    $('#cardMenuDeleteBtn')?.addEventListener('click', () => {
      const card = getCardById(contextCardId)
      if (!card) return closeMenu()
      openConfirm({
        title: '确认删除',
        text: `确认删除卡片「${card.title}」吗？`,
        onConfirm: async () => {
          await onDeleteCard(card.id)
        }
      })
    })

    domains.link.bindModalUi()
    domains.hot.bindModalUi()
    domains.weather.bindModalUi()
    domains.stock.bindModalUi()
    domains.anniversary.bindModalUi()

    confirmOverlay?.addEventListener('click', (evt) => {
      if (evt.target === confirmOverlay) closeConfirm()
    })
    $('#confirmCloseBtn')?.addEventListener('click', closeConfirm)
    $('#confirmCancelBtn')?.addEventListener('click', closeConfirm)
    $('#confirmOkBtn')?.addEventListener('click', async () => {
      const action = confirmAction
      closeConfirm()
      if (action) await action()
    })

    addChooserOverlay?.addEventListener('click', (evt) => {
      if (evt.target === addChooserOverlay) closeAddChooser()
    })
    $('#addChooserCloseBtn')?.addEventListener('click', closeAddChooser)
    $('#addChooserCardBtn')?.addEventListener('click', () => {
      closeAddChooser()
      domains.link.openModal({ mode: 'create' })
    })
    $('#addChooserComponentBtn')?.addEventListener('click', openComponentList)

    componentListOverlay?.addEventListener('click', (evt) => {
      if (evt.target === componentListOverlay) closeComponentList()
    })
    $('#componentListCloseBtn')?.addEventListener('click', closeComponentList)
    $('#componentHotBtn')?.addEventListener('click', () => domains.hot.openModal({ mode: 'create' }))
    $('#componentStockBtn')?.addEventListener('click', () => domains.stock.openModal({ mode: 'create' }))
    $('#componentWeatherBtn')?.addEventListener('click', () => domains.weather.openModal({ mode: 'create' }))
    $('#componentMetalsBtn')?.addEventListener('click', async () => {
      closeComponentList()
      await domains.metals.addComponent()
    })
    $('#componentAnniversaryBtn')?.addEventListener('click', async () => {
      closeComponentList()
      await domains.anniversary.addComponent()
    })
  }

  return { init, openMenu, closeMenu, openAddChooser, closeAddChooser, openComponentList, closeComponentList, openConfirm, closeConfirm }
}
