import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { cancelarPesquisa } from "@/lib/prospecting/tools/status";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";

/**
 * GET /api/prospecting/runs/[id]
 *
 * Status/progress for the polling hook — any member (viewer+) may
 * read, matching `prospecting_runs`' RLS SELECT policy.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data, error } = await supabase
      .from("prospecting_runs")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("[prospecting/runs/[id] GET] fetch error:", error);
      return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    return NextResponse.json({ run: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/prospecting/runs/[id]  (agent+)
 *
 * Body `{ action: "cancel" }` — the only supported action. Delegates
 * to the same `cancelarPesquisa` the agent's `cancelar_pesquisa` tool
 * uses, so both paths share one ownership check, one terminal-state
 * guard, and one audit trail entry.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;

    if (body?.action !== "cancel") {
      return NextResponse.json({ error: "Only action: 'cancel' is supported" }, { status: 400 });
    }

    const result = await cancelarPesquisa(supabase, accountId, userId, { run_id: id });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProspectingToolError) {
      const status = err.code === "run_not_found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    return toErrorResponse(err);
  }
}
