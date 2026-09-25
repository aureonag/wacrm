// ============================================================
// /api/deals/[id]/close (agent+) — ficha de fechamento
//
// GET  -> data the closing dialog needs: the boards a kickoff task can
//         land on (read with the service role because a salesperson
//         usually has no Operacional board permission) and a preview of
//         the contract scope that will go to the task (no prices).
// POST -> completes the closing sheet: builds the kickoff briefing and
//         calls close_deal_with_sheet (migration 085), which marks the
//         deal won and creates the task atomically.
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { extractScopeSections } from "@/lib/contracts/scope";
import { KICKOFF_CHECKLIST, buildKickoffBriefing } from "@/lib/tasks/kickoff-briefing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBSERVATIONS = 4000;

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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;

    const { data: deal } = await supabase
      .from("deals")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const { data: boards } = await supabaseAdmin()
      .from("boards")
      .select("id, name")
      .eq("account_id", accountId)
      .order("name");

    const { hasSignedContract, scope } = await loadScope(supabase, id);
    return NextResponse.json({ boards: boards ?? [], hasSignedContract, scope });
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
      .select("id, status, contact_id, segment, region, origin")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (deal.status !== "open") {
      return NextResponse.json({ error: "Este negócio já foi encerrado" }, { status: 409 });
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
    });

    if (error) {
      console.error("[deals/close] rpc error:", error);
      const status = /forbidden/.test(error.message) ? 403 : /invalid|required|no stages/.test(error.message) ? 400 : 500;
      return NextResponse.json({ error: "Não foi possível concluir o fechamento" }, { status });
    }

    return NextResponse.json({ ok: true, taskId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
