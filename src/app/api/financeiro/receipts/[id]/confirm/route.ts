// ============================================================
// POST /api/financeiro/receipts/[id]/confirm (owner-only)
//
// Turns a reviewed receipt into a real `fin_expenses` row. The body
// carries whatever the owner confirmed in the review UI — usually the
// AI's suggestion untouched, sometimes corrected (wrong category,
// misread amount) — never the AI's fields directly, so a correction
// in the UI can't be bypassed by stale suggestion data server-side.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

interface ConfirmBody {
  category_id?: unknown
  amount?: unknown
  year?: unknown
  month?: unknown
  description?: unknown
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as ConfirmBody | null

    const categoryId = typeof body?.category_id === 'string' ? body.category_id : ''
    const amount = Number(body?.amount)
    const year = Number(body?.year)
    const month = Number(body?.month)
    const description = typeof body?.description === 'string' ? body.description.trim() : ''

    if (
      !categoryId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      return NextResponse.json({ error: 'Dados inválidos para confirmar o lançamento' }, { status: 400 })
    }

    const { data: receipt, error: receiptError } = await supabase
      .from('fin_receipts')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (receiptError || !receipt) {
      return NextResponse.json({ error: 'Comprovante não encontrado' }, { status: 404 })
    }
    if (receipt.status === 'confirmed') {
      return NextResponse.json({ error: 'Este comprovante já foi confirmado' }, { status: 409 })
    }

    const { data: category } = await supabase
      .from('fin_expense_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!category) {
      return NextResponse.json({ error: 'Categoria inválida' }, { status: 400 })
    }

    // fin_expenses is one row per (category, year, month) — the same
    // grid cell a manual edit in the Despesas UI would touch. A second
    // receipt confirmed into an already-populated cell adds to it
    // (two real payments in the same category/month) rather than
    // overwriting, so neither one silently erases the other.
    const { data: existing } = await supabase
      .from('fin_expenses')
      .select('amount')
      .eq('category_id', categoryId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle()

    const { data: expense, error: expenseError } = await supabase
      .from('fin_expenses')
      .upsert(
        {
          account_id: accountId,
          category_id: categoryId,
          amount: (existing?.amount ?? 0) + amount,
          year,
          month,
          description: description || null,
          created_by: userId,
        },
        { onConflict: 'category_id,year,month' },
      )
      .select()
      .single()
    if (expenseError || !expense) {
      console.error('[financeiro/receipts/confirm] expense upsert error:', expenseError)
      return NextResponse.json({ error: 'Falha ao criar o lançamento' }, { status: 500 })
    }

    const { data: updatedReceipt, error: updateError } = await supabase
      .from('fin_receipts')
      .update({
        status: 'confirmed',
        confirmed_expense_id: expense.id,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()
    if (updateError) {
      // The expense already exists at this point — surfacing this as a
      // hard failure would let the owner retry and double-post it, so
      // log loudly and still return success with the expense created.
      console.error('[financeiro/receipts/confirm] receipt update error:', updateError)
    }

    return NextResponse.json({ expense, receipt: updatedReceipt ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
