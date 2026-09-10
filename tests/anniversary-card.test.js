import { describe, expect, it } from 'vitest'
import { renderAnniversaryCardHtml, renderAnniversaryEditorHtml } from '../anniversary-card.js'

/** 相对今天生成 YYYY-MM-DD，保证排序断言与运行日期无关。 */
const inDays = (days) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

describe('anniversary card html', () => {
  it('renders the empty state with a placeholder', () => {
    const html = renderAnniversaryCardHtml({ items: [] })

    expect(html).toContain('点击添加纪念日')
    expect(html).toContain('anniversary-card')
    expect(html).not.toContain('anniversary-mini-item')
  })

  it('features the nearest upcoming item and lists the rest', () => {
    const html = renderAnniversaryCardHtml({
      items: [
        { id: 'far', title: '远', date: inDays(30) },
        { id: 'near', title: '近', date: inDays(10) }
      ]
    })

    expect(html).toContain('下一个纪念日')
    expect(html).toContain('<div class="title">近</div>')
    expect(html.split('anniversary-mini-item')).toHaveLength(3)
    expect(html).toContain('10天')
  })

  it('escapes titles coming from config', () => {
    const html = renderAnniversaryCardHtml({ items: [{ id: 'a', title: '<b>生日</b>', date: inDays(3) }] })

    expect(html).not.toContain('<b>生日</b>')
    expect(html).toContain('&lt;b&gt;生日&lt;/b&gt;')
  })

  it('tolerates a card without items', () => {
    expect(renderAnniversaryCardHtml({})).toContain('点击添加纪念日')
  })
})

describe('anniversary editor html', () => {
  it('renders an empty hint without items', () => {
    expect(renderAnniversaryEditorHtml([])).toContain('editor-empty')
    expect(renderAnniversaryEditorHtml(undefined)).toContain('editor-empty')
  })

  it('renders item rows with countdown, anniversary count and delete button', () => {
    const html = renderAnniversaryEditorHtml([{ id: 'a', title: '结婚纪念', date: inDays(5) }])

    expect(html).toContain('data-item-id="a"')
    expect(html).toContain('结婚纪念')
    expect(html).toContain('5天')
    expect(html).toContain('data-action="delete"')
  })

  it('escapes titles and ids', () => {
    const html = renderAnniversaryEditorHtml([{ id: '"><script>', title: '<x>', date: inDays(1) }])

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;x&gt;')
  })
})
