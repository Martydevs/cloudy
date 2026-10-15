import { describe, expect, it } from 'vitest'
import { isSafeRedirect } from '../../shared/validation/redirect'

describe('isSafeRedirect', () => {
  it.each([
    ['/a', true],
    ['/archivos/123?q=dom', true],
    ['/a?b=//c', true],
    ['//a', false],
    ['/\\evil.com', false],
    ['https://a', false],
    ['/redirect?to=https://a', false],
    ['', false],
    ['archivos', false],
  ])('%s → %s', (value, expected) => {
    expect(isSafeRedirect(value)).toBe(expected)
  })

  it('rechaza lo que no es texto', () => {
    expect(isSafeRedirect(undefined)).toBe(false)
    expect(isSafeRedirect(['/a'])).toBe(false)
  })
})
