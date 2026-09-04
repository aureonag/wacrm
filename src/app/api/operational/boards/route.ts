// GET  /api/operational/boards — list this account's boards. Requires
//      operational:tasks:view_boards.
// POST /api/operational/boards — create a board. Requires
//      operational:tasks:create_boards.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { Board } from "@/types";

export async function GET() {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_boards");

    const { data, error } = await ctx.supabase
      .from("boards")
      .select("*")
      .eq("account_id", ctx.accountId)
      .order("created_at");

    if (error) {
      console.error("[GET /api/operational/boards] fetch error:", error);
      return NextResponse.json({ error: "Failed to load boards" }, { status: 500 });
    }

    return NextResponse.json({ boards: (data ?? []) as Board[] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const DEFAULT_STAGES = [
  { name: "A fazer", color: "#64748b" },
  { name: "Em andamento", color: "#3b82f6" },
  { name: "Concluído", color: "#22c55e" },
];

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "create_boards");

    const limit = checkRateLimit(`operational:boardCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; description?: unknown }
      | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    if (!name) return NextResponse.json({ error: "'name' is required" }, { status: 400 });

    const { data: board, error } = await ctx.supabase
      .from("boards")
      .insert({ account_id: ctx.accountId, name, description, created_by: ctx.userId })
      .select("id")
      .single();

    if (error) {
      console.error("[POST /api/operational/boards] insert error:", error);
      return NextResponse.json({ error: "Failed to create board" }, { status: 500 });
    }

    // Seed default stages so a brand-new board isn't an empty kanban —
    // same idea as PipelinesPage seeding 6 stages for a new pipeline.
    const { error: stagesError } = await ctx.supabase.from("board_stages").insert(
      DEFAULT_STAGES.map((s, i) => ({ board_id: board.id, name: s.name, color: s.color, position: i })),
    );
    if (stagesError) {
      console.error("[POST /api/operational/boards] default stages error:", stagesError);
    }

    return NextResponse.json({ id: board.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
