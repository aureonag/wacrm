// ============================================================
// /api/deals/[id]/close (agent+) — ficha de fechamento
//
// GET  -> data the closing dialog needs: the boards a kickoff task can
//         land on and the Financeiro service lines (both read with the
//         service role — a salesperson has no Operacional/Financeiro
//         permission), the deal's monthly items, the client code/name
//         parsed from the title, and a preview of the contract scope
//         that will go to the task (no prices).
// POST -> completes the closing sheet: builds the kickoff briefing and
//         the Financeiro schedule/commissions, then calls
//         close_deal_with_sheet (migration 085), which marks the deal won
//         (if still open) and persists everything atomically. A deal
//         already won by contract signature is accepted too — that is
//         the "Agendar kickoff" path.
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { extractScopeSections } from "@/lib/contracts/scope";
import { KICKOFF_CHECKLIST, buildKickoffBriefing } from "@/lib/tasks/kickoff-briefing";
import {
  buildMonthlySchedule,
  firstMonthTotal,
  parseDealTitle,
  splitCommission,
  validateFinance,
  type FinanceError,
  type FinanceInput,
} from "@/lib/finance/closing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBSERVATIONS = 4000;

const FINANCE_MESSAGES: Record<FinanceError, string> = {
  invalid_date: "Informe a data do primeiro pagamento.",
  no_items: "Não há serviço mensal para lançar no Financeiro.",
  invalid_item: "Confira a linha de serviço, o nome e o valor de cada serviço mensal.",
  invalid_promo: "Confira a promoção: de 1 a 11 meses e um valor válido.",
  invalid_commission: "Confira as pessoas da comissão: sem repetir e com porcentagem válida.",
  commission_sum: "As porcentagens da comissão precisam somar 100%.",
};

async function loadScope(supabase: SupabaseClient, dealId: string) {
  const { data: contract } = await supabase
    .from("deal_contracts")
    .select("rendered_content")
    .eq("deal_id", dealId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    hasSignedContract: !!contract,
    scope: extractScopeSections(contract?.rendered_content as string | null | undefined),
  };
}

async function loadMonthlyItems(supabase: SupabaseClient, dealId: string) {
  const { data } = await supabase
    .from("deal_line_items")
    .select("id, label, value")
    .eq("deal_id", dealId)
    .eq("type", "mensal")
    .order("created_at");
  return (data ?? []) as { id: string; label: string | null; value: number }[];
}

function num(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
}

/** Defensive parse of the finance block sent by the dialog. */
function parseFinance(raw: unknown): FinanceInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  const commissions = Array.isArray(r.commissions) ? r.commissions : [];
  return {
    firstPaymentDate: typeof r.firstPaymentDate === "string" ? r.firstPaymentDate : "",
    items: items.map((i) => {
      const o = (i ?? {}) as Record<string, unknown>;
      return {
        serviceLineId: typeof o.serviceLineId === "string" && UUID.test(o.serviceLineId) ? o.serviceLineId : "",
        code: typeof o.code === "string" && o.code.trim() ? o.code.trim().slice(0, 20) : null,
        name: typeof o.name === "string" ? o.name.trim().slice(0, 120) : "",
        amount: num(o.amount),
        promoMonths: Math.trunc(num(o.promoMonths) || 0),
        promoAmount: num(o.promoAmount) || 0,
      };
    }),
    commissions: commissions.map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        profileId: typeof o.profileId === "string" && UUID.test(o.profileId) ? o.profileId : "",
        pct: num(o.pct),
      };
    }),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;

    const { data: deal } = await supabase
      .from("deals")
      .select("id, title, status")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const admin = supabaseAdmin();
    const [{ data: boards }, { data: serviceLines }, monthlyItems, { hasSignedContract, scope }] = await Promise.all([
      admin.from("boards").select("id, name").eq("account_id", accountId).order("name"),
      admin
        .from("fin_service_lines")
        .select("id, name")
        .eq("account_id", accountId)
        .eq("is_active", true)
        .order("sort_order"),
      loadMonthlyItems(supabase, id),
      loadScope(supabase, id),
    ]);

    return NextResponse.json({
      boards: boards ?? [],
      serviceLines: serviceLines ?? [],
      monthlyItems,
      client: parseDealTitle(deal.title as string),
      hasSignedContract,
      scope,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      boardId?: unknown;
      sectorId?: unknown;
      assigneeId?: unknown;
      observations?: unknown;
      finance?: unknown;
    } | null;

    const boardId = typeof body?.boardId === "string" ? body.boardId : "";
    const sectorId = typeof body?.sectorId === "string" ? body.sectorId : "";
    const assigneeId = typeof body?.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
    const observations = typeof body?.observations === "string" ? body.observations.slice(0, MAX_OBSERVATIONS) : "";

    if (!UUID.test(boardId) || !UUID.test(sectorId) || (assigneeId && !UUID.test(assigneeId))) {
      return NextResponse.json({ error: "Quadro e setor são obrigatórios" }, { status: 400 });
    }

    const { data: deal } = await supabase
      .from("deals")
      .select("id, title, status, contact_id, segment, region, origin")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (deal.status !== "open" && deal.status !== "won") {
      return NextResponse.json({ error: "Este negócio já foi encerrado" }, { status: 409 });
    }

    // Monthly services must be declared for the Financeiro; a deal with
    // none (one-off only) closes without a finance block.
    const monthlyItems = await loadMonthlyItems(supabase, id);
    let pFinance: Record<string, unknown> | null = null;
    if (monthlyItems.length > 0) {
      const finance = parseFinance(body?.finance);
      const error = finance ? validateFinance(finance) : "no_items";
      if (!finance || error) {
        return NextResponse.json({ error: FINANCE_MESSAGES[error ?? "no_items"] }, { status: 400 });
      }
      const base = firstMonthTotal(finance);
      const shares = splitCommission(base, finance.commissions);
      pFinance = {
        first_payment_date: finance.firstPaymentDate,
        client_label: deal.title,
        items: finance.items.map((item) => ({
          service_line_id: item.serviceLineId,
          code: item.code,
          name: item.name,
          amount: item.amount,
          promo_months: item.promoMonths,
          promo_amount: item.promoAmount,
          schedule: buildMonthlySchedule({
            firstPaymentDate: finance.firstPaymentDate,
            amount: item.amount,
            promoMonths: item.promoMonths,
            promoAmount: item.promoAmount,
          }),
        })),
        commissions: shares.map((s) => ({ profile_id: s.profileId, pct: s.pct, amount: s.amount })),
      };
    }

    let contact: { name: string | null; phone: string | null; email: string | null } | null = null;
    if (deal.contact_id) {
      const { data } = await supabase
        .from("contacts")
        .select("name, phone, email")
        .eq("id", deal.contact_id)
        .maybeSingle();
      contact = data ?? null;
    }

    const { hasSignedContract, scope } = await loadScope(supabase, id);
    const briefing = buildKickoffBriefing({
      contact,
      segment: deal.segment,
      region: deal.region,
      origin: deal.origin,
      scope,
      hasSignedContract,
      observations,
    });

    const { data: taskId, error } = await supabase.rpc("close_deal_with_sheet", {
      p_deal_id: id,
      p_board_id: boardId,
      p_sector_id: sectorId,
      p_assignee_id: assigneeId,
      p_observations: observations,
      p_briefing: briefing,
      p_checklist: KICKOFF_CHECKLIST,
      p_finance: pFinance,
    });

    if (error) {
      console.error("[deals/close] rpc error:", error);
      const status = /forbidden/.test(error.message)
        ? 403
        : /invalid|required|no stages|does not match/.test(error.message)
          ? 400
          : 500;
      return NextResponse.json({ error: "Não foi possível concluir o fechamento" }, { status });
    }

    return NextResponse.json({ ok: true, taskId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
