import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signWebhookUrl, verifyWebhookSecret } from './webhook-secret'

describe('zapi webhook secret', () => {
  const prev = process.env.ZAPI_CLIENT_TOKEN
  beforeEach(() => {
    process.env.ZAPI_CLIENT_TOKEN = 'test-client-token'
  })
  afterEach(() => {
    process.env.ZAPI_CLIENT_TOKEN = prev
  })

  it('round-trips a signed url', () => {
    const url = new URL(signWebhookUrl('https://x.test/hook', 'inst1'))
    expect(verifyWebhookSecret('inst1', url.searchParams.get('s'))).toBe(true)
  })

  it('rejects another instance, missing and tampered secrets', () => {
    const s = new URL(signWebhookUrl('https://x.test/hook', 'inst1')).searchParams.get('s')
    expect(verifyWebhookSecret('inst2', s)).toBe(false)
    expect(verifyWebhookSecret('inst1', null)).toBe(false)
    expect(verifyWebhookSecret('inst1', 'abc')).toBe(false)
  })
})
