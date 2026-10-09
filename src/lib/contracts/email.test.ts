import { describe, expect, it } from 'vitest'
import { isPlainEmail } from './email'

describe('isPlainEmail', () => {
  it('accepts normal addresses', () => {
    expect(isPlainEmail('cliente@empresa.com.br')).toBe(true)
  })
  it('rejects structured, oversized and non-string input', () => {
    expect(isPlainEmail('"a b"@x.com')).toBe(false)
    expect(isPlainEmail('Nome <a@b.com>')).toBe(false)
    expect(isPlainEmail('a@b.com, c@d.com')).toBe(false)
    expect(isPlainEmail(`${'a'.repeat(250)}@b.com`)).toBe(false)
    expect(isPlainEmail(['a@b.com'])).toBe(false)
  })
})
