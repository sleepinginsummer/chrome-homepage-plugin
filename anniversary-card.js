/**
 * @fileoverview
 * 纪念日卡片的纯渲染层：卡面 HTML 与编辑列表 HTML。
 *
 * 注意：
 * - 不读页面状态，文案沿用原有硬编码（与迁移前一致，未接入 i18n）。
 * - 日期计算全部来自 anniversary.js，这里只负责拼 HTML 与转义。
 */

import { calcNextAnniversary, formatMonthDay, sortAnniversaryItems } from './anniversary.js'

const escapeHtml = (raw) =>
  String(raw ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * 生成纪念日卡片 HTML。
 *
 * @param {any} card 卡片配置。
 * @returns {string} 卡片 HTML。
 */
export const renderAnniversaryCardHtml = (card) => {
  const items = sortAnniversaryItems(Array.isArray(card?.items) ? card.items : [])
  const featured = items[0]
  const featuredCalc = featured ? calcNextAnniversary(featured.date) : null
  const featuredTitle = featured?.title ? escapeHtml(featured.title) : ''
  const featuredDate = featuredCalc ? formatMonthDay(featuredCalc) : ''
  const daysText = featuredCalc ? String(featuredCalc.days) : '--'

  const mini = items.map((it) => {
    const c = calcNextAnniversary(it.date)
    const t = escapeHtml(String(it.title || ''))
    const date = c ? formatMonthDay(c) : ''
    const days = c ? `${c.days}天` : '--'
    const years = c ? `${c.years}周年` : ''
    return `
      <div class="anniversary-mini-item">
        <div class="left">
          <div class="mini-title">${t || '未命名'}</div>
          <div class="mini-date">${date || ''}</div>
        </div>
        <div class="right">
          <div class="years">${years}</div>
          <div class="mini-days">${days}</div>
        </div>
      </div>
    `
  })

  const empty = !items.length
  return `
    <div class="anniversary-card">
      <div class="anniversary-feature">
        <div>
          <div class="label">${empty ? '点击添加纪念日' : '下一个纪念日'}</div>
          <div class="title">${featuredTitle || (empty ? '' : '未命名')}</div>
        </div>
        <div class="countdown">
          <div class="days">${daysText}</div>
          <div class="unit">天</div>
        </div>
        <div class="date">${featuredDate}</div>
      </div>
      <div class="anniversary-list-mini">
        ${mini.join('')}
      </div>
    </div>
  `
}

/**
 * 生成编辑弹窗里的条目列表 HTML。
 *
 * @param {Array<any>} items 条目列表。
 * @returns {string} 列表 HTML，无条目时返回空态提示。
 */
export const renderAnniversaryEditorHtml = (items) => {
  const list = sortAnniversaryItems(Array.isArray(items) ? items : [])
  if (!list.length) return '<div class="editor-empty">暂无纪念日，右侧新增一个吧</div>'

  return list
    .map((it) => {
      const c = calcNextAnniversary(it.date)
      const title = escapeHtml(String(it.title || '未命名'))
      const date = c ? formatMonthDay(c) : ''
      const badge = c ? `${c.days}天` : '--'
      const years = c ? `${c.years}周年` : ''
      return `
        <div class="anniversary-list-item" data-item-id="${escapeHtml(it.id)}">
          <div class="meta">
            <div class="name">${title}</div>
            <div class="sub">${escapeHtml(date)} · ${escapeHtml(years)}</div>
          </div>
          <div class="actions">
            <div class="badge">${escapeHtml(badge)}</div>
            <button class="danger-btn" type="button" data-action="delete" data-item-id="${escapeHtml(it.id)}">删除</button>
          </div>
        </div>
      `
    })
    .join('')
}
