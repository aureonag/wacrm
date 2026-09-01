import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/prospecting/admin-client";
import { logProspectingAudit } from "@/lib/prospecting/audit";

/**
 * GET /api/prospecting/runs/[id]/candidates
 *
 * The review table's data source — any member (viewer+) may read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id: runId } = await params;

    const { data: run } = await supabase
      .from("prospecting_runs")
      .select("id")
      .eq("id", runId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("prospecting_candidates")
      .select("*")
      .eq("run_id", runId)
      .order("icp_score", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("[prospecting/runs/[id]/candidates GET] fetch error:", error);
      return NextResponse.json({ error: "Failed to load candidates" }, { status: 500 });
    }
    return NextResponse.json({ candidates: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/prospecting/runs/[id]/candidates  (agent+)
 *
 * Body `{ candidate_id, selected }` — toggles one candidate's review
 * checkbox. Uses the caller's own RLS-scoped client (agent+ may
 * UPDATE `prospecting_candidates` per migration 047), and re-verifies
 * the candidate actually belongs to this run/account first.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id: runId } = await params;
    const body = (await request.json().catch(() => null)) as { candidate_id?: unknown; selected?: unknown } | null;

    const candidateId = typeof body?.candidate_id === "string" ? body.candidate_id : "";
    if (!candidateId || typeof body?.selected !== "boolean") {
      return NextResponse.json({ error: "candidate_id and selected (boolean) are required" }, { status: 400 });
    }

    const { data: candidate } = await supabase
      .from("prospecting_candidates")
      .select("id")
      .eq("id", candidateId)
      .eq("run_id", runId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const { error } = await supabase
      .from("prospecting_candidates")
      .update({ selected: body.selected })
      .eq("id", candidateId);
    if (error) {
      console.error("[prospecting/runs/[id]/candidates PATCH] update error:", error);
      return NextResponse.json({ error: "Failed to update candidate" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/prospecting/runs/[id]/candidates  (agent+)
 *
 * Body `{ candidate_ids: string[] }` — discards candidates from the
 * review list (e.g. "Excluir selecionados"). `prospecting_candidates`
 * has no client-writable DELETE policy (migration 047), so this uses
 * the service-role client after re-verifying ownership through the
 * caller's own RLS-scoped client. Already-imported candidates are
 * never deleted — they're real deals now, not review-stage rows.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id: runId } = await params;
    const body = (await request.json().catch(() => null)) as { candidate_ids?: unknown } | null;

    const candidateIds = Array.isArray(body?.candidate_ids)
      ? body.candidate_ids.filter((v): v is string => typeof v === "string")
      : [];
    if (candidateIds.length === 0) {
      return NextResponse.json({ error: "candidate_ids is required" }, { status: 400 });
    }

    const { data: run } = await supabase
      .from("prospecting_runs")
      .select("id")
      .eq("id", runId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const admin = supabaseAdmin();
    const { data: deleted, error } = await admin
      .from("prospecting_candidates")
      .delete()
      .in("id", candidateIds)
      .eq("run_id", runId)
      .eq("account_id", accountId)
      .is("imported_deal_id", null)
      .select("id");

    if (error) {
      console.error("[prospecting/runs/[id]/candidates DELETE] delete error:", error);
      return NextResponse.json({ error: "Failed to delete candidates" }, { status: 500 });
    }

    void logProspectingAudit(admin, {
      accountId,
      userId,
      runId,
      action: "delete_candidates",
      status: "success",
      metadata: { candidateIds: (deleted ?? []).map((c) => c.id) },
    });

    return NextResponse.json({ deleted: deleted?.length ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
