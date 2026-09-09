// ============================================================
// GET /api/financeiro/receipts — list receipts (owner-only).
// POST /api/financeiro/receipts — upload a comprovante + AI read.
//
// The upload never auto-posts a `fin_expenses` row: this just stores
// the file and the AI's suggestion (amount/period/category) with
// status 'needs_review'. Confirming (with corrections, if any) is a
// separate step — POST /api/financeiro/receipts/[id]/confirm.
//
// A failed AI read (no AI configured, provider error, unparsable
// output) still keeps the uploaded file and inserts the row with
// status 'failed' + `error_message`, so nothing is silently dropped —
// the owner can still fill in the amount/category by hand from the
// review queue.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { AiError } from '@/lib/ai/types'
import { extractReceiptData, ReceiptExtractionError } from '@/lib/finance/receipt-extraction'
import { loadSystemAiConfig } from '@/lib/finance/system-ai-config'

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const MAX_BYTES = 10 * 1024 * 1024

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query = supabase
      .from('fin_receipts')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      console.error('[financeiro/receipts] list error:', error)
      return NextResponse.json({ error: 'Failed to load receipts' }, { status: 500 })
    }
    return NextResponse.json({ receipts: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function safeFileName(name: string): string {
  const hasExt = /\.[^.]+$/.test(name)
  const ext = hasExt ? name.split('.').pop()!.toLowerCase() : 'bin'
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40)
  return `${base || 'comprovante'}.${ext}`
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner')
    const { supabase, accountId, userId } = ctx

    const formData = await request.formData().catch(() => null)
    const file = formData?.get('file')
    const description = String(formData?.get('description') ?? '').trim()

    if (!(file instanceof Blob) || !file.size) {
      return NextResponse.json({ error: 'Arquivo do comprovante é obrigatório' }, { status: 400 })
    }
    if (!description) {
      return NextResponse.json({ error: 'Descrição é obrigatória' }, { status: 400 })
    }
    const mimeType = file.type || 'application/octet-stream'
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo não suportado. Envie uma imagem (JPG/PNG/WEBP) ou PDF.' },
        { status: 400 },
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Arquivo maior que 10 MB' }, { status: 400 })
    }

    const originalName = file instanceof File ? file.name : 'comprovante'
    const fileName = safeFileName(originalName)
    const path = `account-${accountId}/${Date.now()}-${fileName}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from('fin-receipts')
      .upload(path, bytes, { contentType: mimeType, upsert: false })
    if (uploadError) {
      console.error('[financeiro/receipts] upload error:', uploadError)
      return NextResponse.json({ error: 'Falha ao enviar o arquivo' }, { status: 500 })
    }

    const { data: categoryRows } = await supabase
      .from('fin_expense_categories')
      .select('id, name')
      .eq('account_id', accountId)
      .order('name')
    const categories = categoryRows ?? []

    const baseInsert = {
      account_id: accountId,
      file_path: path,
      file_name: originalName,
      mime_type: mimeType,
      description,
      created_by: userId,
    }

    let extraction: Awaited<ReturnType<typeof extractReceiptData>> | null = null
    let errorMessage: string | null = null

    // The Financeiro reader has its own platform-owned key (env var) so
    // it works with zero setup; the account's Agentes de IA key (if any)
    // is only a fallback for accounts that had one before this existed.
    const aiConfig =
      loadSystemAiConfig() ??
      (await loadAiConfig(supabase, accountId, { requireActive: false }).catch(() => null))
    if (!aiConfig) {
      errorMessage =
        'Leitura por IA não configurada no servidor (falta FINANCEIRO_AI_API_KEY). O comprovante foi salvo — preencha os dados manualmente.'
    } else {
      try {
        extraction = await extractReceiptData({
          config: aiConfig,
          fileBase64: bytes.toString('base64'),
          mimeType,
          userDescription: description,
          categories,
          todayIso: new Date().toISOString().slice(0, 10),
        })
      } catch (err) {
        errorMessage =
          err instanceof AiError || err instanceof ReceiptExtractionError
            ? err.message
            : 'Falha inesperada ao ler o comprovante com IA.'
        console.error('[financeiro/receipts] extraction error:', err)
      }
    }

    const { data: receipt, error: insertError } = await supabase
      .from('fin_receipts')
      .insert(
        extraction
          ? {
              ...baseInsert,
              status: 'needs_review',
              suggested_category_id: extraction.categoryId,
              suggested_amount: extraction.amount,
              suggested_year: extraction.year,
              suggested_month: extraction.month,
              suggested_description: extraction.description,
              ai_notes: extraction.notes,
            }
          : { ...baseInsert, status: 'failed', error_message: errorMessage },
      )
      .select()
      .single()

    if (insertError || !receipt) {
      console.error('[financeiro/receipts] insert error:', insertError)
      return NextResponse.json({ error: 'Falha ao salvar o comprovante' }, { status: 500 })
    }

    return NextResponse.json({ receipt })
  } catch (err) {
    return toErrorResponse(err)
  }
}
