import { AiError, type AiConfig } from '@/lib/ai/types'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { toNetworkError, providerHttpError } from '@/lib/ai/providers/shared'

// ============================================================
// Receipt (comprovante) reading for the Financeiro module.
//
// Separate from `@/lib/ai/generate.ts` because that module's
// `ChatMessage` is text-only — receipts need a multimodal (image/PDF)
// request, which the two providers shape very differently. Reuses the
// account's already-configured AI provider/key (`loadAiConfig`) rather
// than asking for a second one.
//
// The model is asked to both READ the receipt (amount, date) and
// CLASSIFY it against the account's own expense categories (so a
// recurring-but-variable cost like "Contabilidade" or a one-off PIX
// lands in the right bucket) — but nothing here writes to the
// database. The caller (POST /api/financeiro/receipts) stores this as
// a *suggestion* on `fin_receipts`; the owner reviews/corrects it and
// only then does a `fin_expenses` row get created.
// ============================================================

export interface ReceiptExtractionCategory {
  id: string
  name: string
}

export interface ReceiptExtractionResult {
  amount: number | null
  year: number | null
  month: number | null
  categoryId: string | null
  categoryName: string | null
  description: string | null
  notes: string | null
}

export class ReceiptExtractionError extends Error {
  readonly code: string
  constructor(message: string, code = 'extraction_error') {
    super(message)
    this.name = 'ReceiptExtractionError'
    this.code = code
  }
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_OUTPUT_TOKENS = 1024

function buildPrompt(args: {
  userDescription: string
  categories: ReceiptExtractionCategory[]
  todayIso: string
}): string {
  const { userDescription, categories, todayIso } = args
  const categoryList =
    categories.length > 0
      ? categories.map((c) => `- ${c.name}`).join('\n')
      : '(nenhuma categoria cadastrada ainda — deixe "category" como null)'

  return [
    'Você está lendo um comprovante de pagamento brasileiro (PIX, boleto, TED, recibo etc.) anexado a esta mensagem.',
    `A data de hoje é ${todayIso}.`,
    `Descrição informada por quem enviou o comprovante: "${userDescription || '(nenhuma)'}"`,
    '',
    'Categorias de despesa já cadastradas nesta conta (escolha uma pelo nome EXATO, ou null se nenhuma corresponder):',
    categoryList,
    '',
    'Extraia os dados do comprovante e responda APENAS com um objeto JSON, sem markdown, sem texto antes ou depois, no formato:',
    '{"amount": number ou null, "year": number ou null, "month": number (1-12) ou null, "category": string ou null, "description": string ou null, "notes": string ou null}',
    '',
    '- "amount": o valor pago, em reais, como número (ex: 1234.56).',
    '- "year"/"month": o mês de competência do pagamento (normalmente o mês em que o comprovante foi emitido/pago).',
    '- "category": o nome de uma categoria da lista acima que melhor combina com este pagamento, ou null.',
    '- "description": uma descrição curta e objetiva do lançamento, combinando o que você vê no comprovante com a descrição informada.',
    '- "notes": qualquer ambiguidade ou algo que mereça revisão manual (ou null se não houver).',
  ].join('\n')
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toMonth(v: unknown): number | null {
  const n = toNumber(v)
  if (n === null) return null
  const m = Math.round(n)
  return m >= 1 && m <= 12 ? m : null
}

function parseModelJson(
  raw: string,
  categories: ReceiptExtractionCategory[],
): ReceiptExtractionResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch {
    throw new ReceiptExtractionError(
      'O modelo de IA não retornou um JSON válido para este comprovante.',
      'invalid_json',
    )
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ReceiptExtractionError(
      'O modelo de IA retornou um formato inesperado para este comprovante.',
      'invalid_json',
    )
  }
  const obj = parsed as Record<string, unknown>

  const categoryName = typeof obj.category === 'string' ? obj.category.trim() : null
  const matchedCategory = categoryName
    ? (categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase()) ?? null)
    : null

  const year = toNumber(obj.year)

  return {
    amount: toNumber(obj.amount),
    year: year !== null ? Math.round(year) : null,
    month: toMonth(obj.month),
    categoryId: matchedCategory?.id ?? null,
    categoryName: matchedCategory?.name ?? categoryName,
    description: typeof obj.description === 'string' ? obj.description.trim() || null : null,
    notes: typeof obj.notes === 'string' ? obj.notes.trim() || null : null,
  }
}

async function callAnthropicVision(args: {
  apiKey: string
  model: string
  prompt: string
  fileBase64: string
  mimeType: string
  timeoutMs: number
}): Promise<string> {
  const { apiKey, model, prompt, fileBase64, mimeType, timeoutMs } = args
  const isPdf = mimeType === 'application/pdf'
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: 'user',
            content: [contentBlock, { type: 'text', text: prompt }],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Anthropic', res)

  const data = (await res.json().catch(() => null)) as {
    content?: { type?: string; text?: string }[]
  } | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic retornou uma resposta vazia para o comprovante.', {
      code: 'empty_response',
    })
  }
  return text
}

async function callOpenAiVision(args: {
  apiKey: string
  model: string
  prompt: string
  fileBase64: string
  mimeType: string
  timeoutMs: number
}): Promise<string> {
  const { apiKey, model, prompt, fileBase64, mimeType, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
            ],
          },
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenAI', res)

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
  } | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || !text.trim()) {
    throw new AiError('OpenAI retornou uma resposta vazia para o comprovante.', {
      code: 'empty_response',
    })
  }
  return text
}

/**
 * Read a receipt file (image or PDF) with the account's configured AI
 * provider and return a suggested expense (amount/period/category).
 * Never writes anything — the caller persists this as a suggestion on
 * `fin_receipts` for the owner to confirm.
 *
 * Throws `ReceiptExtractionError` for a PDF sent to an OpenAI-configured
 * account (OpenAI's chat-completions vision input only accepts images —
 * PDF-as-document is Anthropic-specific) and for unparsable model output;
 * throws `AiError` for provider/network failures (same class the rest of
 * the AI feature uses, so routes can handle both uniformly).
 */
export async function extractReceiptData(args: {
  config: AiConfig
  fileBase64: string
  mimeType: string
  userDescription: string
  categories: ReceiptExtractionCategory[]
  todayIso: string
}): Promise<ReceiptExtractionResult> {
  const { config, fileBase64, mimeType, userDescription, categories, todayIso } = args

  if (mimeType === 'application/pdf' && config.provider === 'openai') {
    throw new ReceiptExtractionError(
      'Comprovantes em PDF só são suportados com o provedor Anthropic (configurado em Agentes de IA). Envie uma foto ou print do comprovante, ou troque o provedor de IA para Anthropic.',
      'pdf_unsupported_provider',
    )
  }

  const prompt = buildPrompt({ userDescription, categories, todayIso })
  const timeoutMs = aiRequestTimeoutMs()

  const rawText =
    config.provider === 'anthropic'
      ? await callAnthropicVision({
          apiKey: config.apiKey,
          model: config.model,
          prompt,
          fileBase64,
          mimeType,
          timeoutMs,
        })
      : await callOpenAiVision({
          apiKey: config.apiKey,
          model: config.model,
          prompt,
          fileBase64,
          mimeType,
          timeoutMs,
        })

  return parseModelJson(rawText, categories)
}
