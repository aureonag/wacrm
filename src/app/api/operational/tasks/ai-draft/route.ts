// POST /api/operational/tasks/ai-draft — fills a new task from a short
// description, using the account's own AI key (Agentes de IA).
// Returns { title, briefing, checklist } for the "Nova tarefa" dialog to
// show and let the person edit; nothing is saved here.
// Requires operational:tasks:create_tasks.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadAiConfig } from "@/lib/ai/config";
import { generateReply } from "@/lib/ai/generate";
import { AiError } from "@/lib/ai/types";
import {
  AI_DRAFT_SYSTEM_PROMPT,
  buildAiDraftUserMessage,
  parseAiDraft,
  templateById,
} from "@/lib/tasks/templates";

const MAX_DESCRIPTION = 1500;

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("operational", "tasks", "create_tasks");

    const limit = checkRateLimit(`operational:taskAiDraft:${ctx.userId}`, { limit: 15, windowMs: 60_000 });
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      description?: unknown;
      template_id?: unknown;
      contact_id?: unknown;
    } | null;

    const description = typeof body?.description === "string" ? body.description.trim().slice(0, MAX_DESCRIPTION) : "";
    if (!description) {
      return NextResponse.json({ error: "description_required" }, { status: 400 });
    }
    const template = typeof body?.template_id === "string" ? (templateById(body.template_id) ?? null) : null;

    let clientName: string | null = null;
    if (typeof body?.contact_id === "string") {
      const { data: contact } = await ctx.supabase
        .from("contacts")
        .select("name")
        .eq("id", body.contact_id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      clientName = (contact?.name as string | null) ?? null;
    }

    const config = await loadAiConfig(ctx.supabase, ctx.accountId);
    if (!config) return NextResponse.json({ error: "ai_not_configured" }, { status: 409 });

    let text: string;
    try {
      ({ text } = await generateReply({
        config,
        systemPrompt: AI_DRAFT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildAiDraftUserMessage({ template, description, clientName }) }],
      }));
    } catch (err) {
      if (err instanceof AiError) {
        console.error("[POST /api/operational/tasks/ai-draft] AI error:", err.code, err.message);
        return NextResponse.json({ error: "ai_failed", code: err.code }, { status: err.status });
      }
      throw err;
    }

    const draft = parseAiDraft(text);
    if (!draft) return NextResponse.json({ error: "ai_unreadable" }, { status: 502 });
    return NextResponse.json({ draft });
  } catch (err) {
    return toErrorResponse(err);
  }
}
