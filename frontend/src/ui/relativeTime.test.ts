import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relativeTime.ts'

const now = new Date(2026, 9, 11, 15, 0, 0)

describe('formatRelativeTime', () => {
  it('describes very recent times', () => {
    expect(formatRelativeTime(new Date(2026, 9, 11, 14, 59, 30), now)).toBe('Just now')
    expect(formatRelativeTime(new Date(2026, 9, 11, 14, 48), now)).toBe('12 min ago')
    expect(formatRelativeTime(new Date(2026, 9, 11, 9, 30), now)).toBe('5 hr ago')
  })

  it('switches to day labels across midnight', () => {
    expect(formatRelativeTime(new Date(2026, 9, 10, 23, 0), now)).toBe('Yesterday')
    expect(formatRelativeTime(new Date(2026, 9, 10, 9, 0), now)).toBe('Yesterday')
  })

  it('omits the year only for the current year', () => {
    expect(formatRelativeTime(new Date(2026, 2, 4), now)).not.toMatch(/2026/)
    expect(formatRelativeTime(new Date(2025, 2, 4), now)).toMatch(/2025/)
  })

  it('handles invalid input', () => {
    expect(formatRelativeTime('not a date', now)).toBe('—')
  })
})
