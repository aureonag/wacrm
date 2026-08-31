import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { importCandidates } from "@/lib/prospecting/import";

/**
 * POST /api/prospecting/runs/[id]/import  (agent+)
 *
 * Body `{ candidate_ids: string[] }`. Idempotent — see
 * `src/lib/prospecting/import.ts` for the `imported_deal_id` guard
 * that makes re-posting the same ids safe.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const result = await importCandidates(supabase, { runId, candidateIds, accountId, userId });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
