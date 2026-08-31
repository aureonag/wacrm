import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { loadAiConfig } from "@/lib/ai/config";
import { runProspectingTurn, type AgentChatMessage } from "@/lib/prospecting/openai-agent";

/**
 * POST /api/prospecting/conversations/[id]/messages  (agent+)
 *
 * The streaming chat-turn endpoint. Returns Server-Sent Events —
 * `token` (text delta), `tool_call`, `tool_result`, `done`, `error` —
 * as the agent's Responses API turn progresses.
 *
 * The user's message and the assistant's final reply are persisted to
 * `prospecting_messages` regardless of whether anyone is still
 * listening to the stream, so closing the tab mid-reply never loses
 * the turn — reopening the conversation (`GET .../conversations/[id]`)
 * replays full history.
 *
 * Long-running work (an actual company search, `pesquisar_empresas`)
 * is intentionally NOT run inline here — that tool only creates a
 * `prospecting_runs` row and kicks off its first step; this endpoint
 * stays scoped to one conversational turn.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id: conversationId } = await params;

    const { data: conversation, error: convError } = await supabase
      .from("prospecting_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (convError) {
      console.error("[prospecting messages POST] conversation fetch error:", convError);
      return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    let aiConfig;
    try {
      aiConfig = await loadAiConfig(supabase, accountId);
    } catch (err) {
      console.error("[prospecting messages POST] loadAiConfig error:", err);
      return NextResponse.json(
        { error: "Stored API key could not be decrypted — re-enter it in Agentes de IA.", code: "key_decrypt_failed" },
        { status: 400 },
      );
    }
    if (!aiConfig) {
      // No stream is opened at all — the client shows a CTA and never
      // sees a half-open connection for a feature that isn't set up.
      return NextResponse.json(
        { error: "not_configured", setup_url: "/agents" },
        { status: 409 },
      );
    }

    const { error: insertUserMsgError } = await supabase.from("prospecting_messages").insert({
      conversation_id: conversationId,
      account_id: accountId,
      role: "user",
      content,
    });
    if (insertUserMsgError) {
      console.error("[prospecting messages POST] user message insert error:", insertUserMsgError);
      return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
    }

    const { data: priorMessages } = await supabase
      .from("prospecting_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(30);

    const history: AgentChatMessage[] = (priorMessages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string | null) ?? "",
    }));

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller already closed (client disconnected) — nothing to do.
          }
        }

        let finalText = "";

        await runProspectingTurn({
          db: supabase,
          accountId,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          provider: aiConfig.provider,
          history,
          handlers: {
            onTextDelta: (delta) => send("token", { delta }),
            onToolCall: (name, toolArgs) => {
              send("tool_call", { name, args: toolArgs });
              void supabase.from("prospecting_messages").insert({
                conversation_id: conversationId,
                account_id: accountId,
                role: "tool",
                content: null,
                metadata: { kind: "call", name, args: toolArgs },
              });
            },
            onToolResult: (name, result, error) => {
              send("tool_result", { name, result, error });
              void supabase.from("prospecting_messages").insert({
                conversation_id: conversationId,
                account_id: accountId,
                role: "tool",
                content: null,
                metadata: { kind: "result", name, result, error },
              });
            },
            onDone: (text) => {
              finalText = text;
              send("done", { text });
            },
            onError: (message) => send("error", { message }),
          },
        });

        // Persisted after the turn resolves (not inside onDone) so the
        // insert is guaranteed to finish before the stream closes,
        // regardless of how the model's turn ended.
        if (finalText.trim()) {
          const { error: insertAssistantMsgError } = await supabase.from("prospecting_messages").insert({
            conversation_id: conversationId,
            account_id: accountId,
            role: "assistant",
            content: finalText,
          });
          if (insertAssistantMsgError) {
            console.error("[prospecting messages POST] assistant message insert error:", insertAssistantMsgError);
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
