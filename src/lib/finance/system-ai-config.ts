import type { AiConfig, AiProvider } from '@/lib/ai/types'

// ============================================================
// Platform-level AI credential for the Financeiro receipt reader —
// deliberately NOT the account's bring-your-own-key config
// (`@/lib/ai/config`'s `loadAiConfig`, used by the inbox AI assistant).
//
// Allan asked for comprovante reading to work without first going to
// Agentes de IA and pasting a key there — Financeiro is a separate,
// owner-only feature and shouldn't depend on that unrelated setup step.
// So this reads a key straight from the server environment, set once at
// deploy time (see .env.local.example), never entered through any UI or
// stored in the database.
// ============================================================

/**
 * Returns the system-owned AI config for receipt reading, or null if
 * `FINANCEIRO_AI_API_KEY` isn't set in the environment. Callers should
 * fall back to the account's own `loadAiConfig` when this is null, so
 * an account that already has Agentes de IA configured keeps working
 * even before the platform key is set.
 */
export function loadSystemAiConfig(): AiConfig | null {
  const apiKey = process.env.FINANCEIRO_AI_API_KEY
  if (!apiKey) return null

  const provider: AiProvider = process.env.FINANCEIRO_AI_PROVIDER === 'openai' ? 'openai' : 'anthropic'
  const model =
    process.env.FINANCEIRO_AI_MODEL || (provider === 'openai' ? 'gpt-5.4-mini' : 'claude-haiku-4-5-20251001')

  return {
    provider,
    model,
    apiKey,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 0,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}
