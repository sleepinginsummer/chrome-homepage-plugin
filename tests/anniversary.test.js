import { describe, expect, it } from 'vitest'
import {
  buildNextItems,
  calcNextAnniversary,
  createSafeDateAtNoon,
  formatMonthDay,
  isLeapYear,
  parseYmd,
  sortAnniversaryItems
} from '../anniversary.js'

describe('anniversary date rules', () => {
  it.each([
    [2024, true],
    [2025, false],
    [2000, true],
    [1900, false]
  ])('isLeapYear(%s) === %s', (year, expected) => {
    expect(isLeapYear(year)).toBe(expected)
  })

  it('falls back to Feb 28 when Feb 29 does not exist', () => {
    expect(createSafeDateAtNoon(2025, 1, 29).getDate()).toBe(28)
    expect(createSafeDateAtNoon(2024, 1, 29).getDate()).toBe(29)
  })

  it.each([
    ['2026-09-10', { year: 2026, month: 9, day: 10 }],
    ['2026-1-1', null],
    ['2026-02-30', null],
    ['2026-13-01', null],
    ['', null],
    [null, null]
  ])('parseYmd(%s) === %o', (input, expected) => {
    expect(parseYmd(input)).toEqual(expected)
  })

  it('formats month and day', () => {
    expect(formatMonthDay({ month: 9, day: 10 })).toBe('9月10日')
  })
})

describe('next anniversary', () => {
  const now = new Date(2026, 8, 10, 9, 0, 0) // 2026-09-10 本地时间

  it('counts down within the same year', () => {
    expect(calcNextAnniversary('2020-10-01', now)).toMatchObject({ days: 21, years: 6 })
  })

  it('rolls over to next year once the date has passed', () => {
    expect(calcNextAnniversary('2020-01-01', now)).toMatchObject({ days: 113, years: 7 })
  })

  it('returns zero days on the day itself', () => {
    expect(calcNextAnniversary('2020-09-10', now)).toMatchObject({ days: 0, years: 6 })
  })

  it('treats Feb 29 as Feb 28 in non-leap years', () => {
    expect(calcNextAnniversary('2024-02-29', new Date(2025, 1, 27, 9, 0, 0))).toMatchObject({ days: 1, years: 1 })
  })

  it('returns null for an invalid date', () => {
    expect(calcNextAnniversary('2026-02-30', now)).toBeNull()
    expect(calcNextAnniversary('', now)).toBeNull()
  })
})

describe('anniversary list ordering', () => {
  const now = new Date(2026, 8, 10, 9, 0, 0)

  it('sorts by the nearest upcoming date and keeps invalid ones last', () => {
    const items = [
      { id: 'c', title: 'C', date: '2020-01-01' },
      { id: 'a', title: 'A', date: '2020-09-20' },
      { id: 'x', title: 'X', date: 'bad' },
      { id: 'b', title: 'B', date: '2020-10-01' }
    ]

    expect(sortAnniversaryItems(items, now).map((it) => it.id)).toEqual(['a', 'b', 'c', 'x'])
  })

  it('breaks ties by title and does not mutate the input', () => {
    const items = [
      { id: 'b', title: '乙', date: '2020-10-01' },
      { id: 'a', title: '甲', date: '2020-10-01' }
    ]
    const sorted = sortAnniversaryItems(items, now)

    expect(sorted).toHaveLength(2)
    expect(sorted.map((it) => it.id)).toEqual([...sorted].sort((x, y) => x.title.localeCompare(y.title)).map((it) => it.id))
    expect(items[0].id).toBe('b')
  })

  it('tolerates a non-array input', () => {
    expect(sortAnniversaryItems(null, now)).toEqual([])
  })
})

describe('anniversary item editing', () => {
  const items = [{ id: 'a', title: '旧的', date: '2020-01-01' }]

  it('replaces the edited item in place', () => {
    const result = buildNextItems(items, 'a', { id: 'ignored', title: '新的', date: '2021-02-02' })

    expect(result.items).toEqual([{ id: 'a', title: '新的', date: '2021-02-02' }])
    expect(result.editingItemId).toBeNull()
  })

  it('prepends a new item', () => {
    const result = buildNextItems(items, null, { id: 'b', title: '新增', date: '2020-03-03' })

    expect(result.items.map((it) => it.id)).toEqual(['b', 'a'])
    expect(result.items[0]).toMatchObject({ title: '新增', date: '2020-03-03' })
  })

  it('falls back to prepending when the edited item disappeared', () => {
    const result = buildNextItems(items, 'gone', { id: 'c', title: '补录', date: '2020-04-04' })

    expect(result.items.map((it) => it.id)).toEqual(['a'])
  })
})
