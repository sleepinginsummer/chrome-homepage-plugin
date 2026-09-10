/**
 * @fileoverview
 * 链接卡片：卡面渲染（图标 + 标题）、新增/修改弹窗与增删改入口。
 *
 * 注意：
 * - 图标加载是异步且可取消的，render 返回取消函数，由卡片网格在重渲染时统一调用。
 * - 弹窗里正在编辑的卡片 id 属于卡片域内部状态，页面不再持有。
 */

import { createCardIconCandidates, getCardInitial, loadCardIcon } from './card-icon.js'
import { normalizeCardUrl } from './url-utils.js'

const getDocument = () => (typeof document === 'undefined' ? null : document)

/**
 * 规范化 icon 输入：只接受 http/https，其余（含空）视为无图标。
 */
export const normalizeIconUrl = (raw) => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * 创建链接卡片控制器。
 *
 * @param {object} options
 * @param {object} options.cards 卡片仓储门面：list/persist/apply。
 * @param {function(string): string} [options.runtimeGetURL] 扩展资源地址解析（chrome.runtime.getURL）。
 * @param {function(string): void} [options.setError] 页面级错误提示位。
 * @param {function(): void} [options.closeOverlays] 打开弹窗前收起其它浮层。
 * @param {object} [options.root=document] DOM 根节点。
 * @param {function(): string} [options.newId] 生成卡片 id，测试可注入。
 * @returns {{ render: function(object, object): (function(): void),
 *   openModal: function({mode: string, card?: object}): void, closeModal: function(): void,
 *   bindModalUi: function(): void }}
 */
export const createLinkCardController = ({
  cards,
  runtimeGetURL,
  setError,
  closeOverlays,
  root = getDocument(),
  newId = () => crypto.randomUUID()
}) => {
  // 重要逻辑：弹窗正在编辑的卡片 id 属于卡片域内部状态。
  let editingCardId = null

  const $ = (selector) => root?.querySelector?.(selector) || null

  /**
   * 渲染链接卡片：骨架 + 异步图标，返回取消图标加载的函数。
   */
  const render = (card, div) => {
    div.innerHTML = `
      <div class="card-icon" aria-hidden="true">
        <span class="card-icon-fallback"></span>
        <img class="card-icon-image" alt="" />
      </div>
      <div class="card-title"></div>
    `
    const icon = div.querySelector('.card-icon')
    const image = div.querySelector('.card-icon-image')
    icon.querySelector('.card-icon-fallback').textContent = getCardInitial(card.title)
    image.decoding = 'async'
    image.loading = 'lazy'

    const candidates = createCardIconCandidates({
      pageUrl: card.url,
      customIcon: card.icon,
      runtimeGetURL
    })
    const cancelIconLoad = loadCardIcon(image, candidates, {
      timeoutMs: 5000,
      onLoaded: (_source, dimensions) => {
        const sourceSize = Math.min(dimensions.width, dimensions.height)
        icon.classList.toggle('is-low-resolution', sourceSize < 24)
        icon.classList.toggle('is-medium-resolution', sourceSize >= 24 && sourceSize < 48)
        icon.classList.add('has-image')
      }
    })
    div.querySelector('.card-title').textContent = card.title
    return cancelIconLoad
  }

  const persistCards = async (next) => {
    await cards.persist(next)
    cards.apply()
  }

  const addCard = async ({ title, url, icon }) => {
    const next = [...cards.list()]
    next.push({
      id: newId(),
      title,
      url,
      ...(icon ? { icon } : {})
    })
    await persistCards(next)
  }

  const updateCard = async ({ id, title, url, icon }) => {
    const next = [...cards.list()]
    const index = next.findIndex((card) => card.id === id)
    if (index === -1) return
    const patch = { title, url }
    if (icon) patch.icon = icon
    else delete next[index].icon
    next[index] = { ...next[index], ...patch }
    await persistCards(next)
  }

  const closeModal = () => {
    const overlay = $('#cardModalOverlay')
    if (overlay) overlay.hidden = true
    editingCardId = null
    setError?.('')
  }

  const openModal = ({ mode, card }) => {
    const overlay = $('#cardModalOverlay')
    const title = $('#cardModalTitle')
    const titleInput = $('#cardModalTitleInput')
    const urlInput = $('#cardModalUrlInput')
    const iconInput = $('#cardModalIconInput')
    if (!overlay) return

    const editing = mode === 'edit' && card
    editingCardId = editing ? card.id : null
    if (title) title.textContent = editing ? '修改卡片' : '新增卡片'
    if (titleInput) titleInput.value = editing ? card.title : ''
    if (urlInput) urlInput.value = editing ? card.url : ''
    if (iconInput) iconInput.value = editing ? card.icon || '' : ''

    setError?.('')
    overlay.hidden = false
    closeOverlays?.()
    requestAnimationFrame(() => titleInput?.focus())
  }

  /**
   * 弹窗提交：标题与网址必填，icon 非法时给出提示但不阻断其它校验顺序。
   */
  const submitModal = async () => {
    const titleInput = $('#cardModalTitleInput')
    const urlInput = $('#cardModalUrlInput')
    const iconInput = $('#cardModalIconInput')
    const title = titleInput?.value.trim() || ''
    const url = normalizeCardUrl(urlInput?.value)
    const icon = normalizeIconUrl(iconInput?.value)

    if (!title) {
      setError?.('请输入标题')
      return
    }
    try {
      new URL(url)
    } catch {
      setError?.('请输入合法网址')
      return
    }
    setError?.('')
    if (iconInput?.value.trim() && !icon) {
      setError?.('Icon 请输入合法 URL（http/https），或留空')
      return
    }

    if (editingCardId) await updateCard({ id: editingCardId, title, url, icon })
    else await addCard({ title, url, icon })
    closeModal()
  }

  /**
   * 绑定链接卡片弹窗自身的元素；卡片菜单与新增选择器由页面处理。
   */
  const bindModalUi = () => {
    const overlay = $('#cardModalOverlay')
    const closeBtn = $('#cardModalCloseBtn')
    const cancelBtn = $('#cardModalCancelBtn')
    const form = $('#cardModalForm')

    overlay?.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal()
    })
    closeBtn?.addEventListener('click', closeModal)
    cancelBtn?.addEventListener('click', closeModal)
    form?.addEventListener('submit', (evt) => {
      evt.preventDefault()
      return submitModal()
    })
  }

  return { render, openModal, closeModal, bindModalUi, normalizeIconUrl }
}
