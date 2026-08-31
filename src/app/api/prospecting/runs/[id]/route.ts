import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { PROSPECTING_TERMINAL_STATUSES } from "@/lib/prospecting/constants";
import { supabaseAdmin } from "@/lib/prospecting/admin-client";

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
 * Body `{ action: "cancel" }` — the only supported action. Writes go
 * through the service-role client (`prospecting_runs` has no
 * client-writable policy); ownership is verified first via the
 * caller's own RLS-scoped client.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;

    if (body?.action !== "cancel") {
      return NextResponse.json({ error: "Only action: 'cancel' is supported" }, { status: 400 });
    }

    const { data: run } = await supabase
      .from("prospecting_runs")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (PROSPECTING_TERMINAL_STATUSES.includes(run.status as never)) {
      return NextResponse.json({ error: "This run has already ended" }, { status: 400 });
    }

    await supabaseAdmin()
      .from("prospecting_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ run_id: id, status: "cancelled" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
