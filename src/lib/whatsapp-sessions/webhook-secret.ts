import { createHmac, timingSafeEqual } from 'node:crypto'

// Z-API doesn't sign webhooks, so the only thing proving a callback is
// really ours is a secret baked into the webhook URL we register for each
// instance. The secret is HMAC-SHA256(instanceId) keyed with the existing
// account-wide ZAPI_CLIENT_TOKEN — no new env var, and it can't be derived
// from the (non-secret) instance id alone.

function secretFor(instanceId: string): string | null {
  const key = process.env.ZAPI_CLIENT_TOKEN
  if (!key) return null
  return createHmac('sha256', key).update(`zapi-webhook:${instanceId}`).digest('hex')
}

/** Appends the per-instance secret to the webhook URL registered on Z-API. */
export function signWebhookUrl(baseUrl: string, instanceId: string): string {
  const s = secretFor(instanceId)
  if (!s) return baseUrl
  return `${baseUrl}?s=${s}`
}

export function verifyWebhookSecret(
  instanceId: string,
  supplied: string | null,
): boolean {
  const expected = secretFor(instanceId)
  if (!expected || !supplied) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
