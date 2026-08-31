"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ProspectingSelections } from "./prospecting-config-card";
import { useTranslations } from "next-intl";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  pending?: boolean;
}

interface ProspectingChatProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  selections: ProspectingSelections;
  /** Fired when the agent's `pesquisar_empresas` tool call returns a run id, so the
   * page can start tracking that run's progress independently of the chat stream. */
  onRunStarted?: (runId: string) => void;
}

const SUGGESTIONS = [
  "suggestion1",
  "suggestion2",
  "suggestion3",
  "suggestion4",
] as const;

function parseSseChunk(chunk: string): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  for (const block of chunk.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    try {
      events.push({ event, data: JSON.parse(dataLine) });
    } catch {
      // Malformed frame — skip it rather than crash the whole stream.
    }
  }
  return events;
}

export function ProspectingChat({
  conversationId,
  onConversationCreated,
  selections,
  onRunStarted,
}: ProspectingChatProps) {
  const t = useTranslations("Prospecting.chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    try {
      const res = await fetch("/api/prospecting/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_pipeline_id: selections.pipelineId || null,
          selected_owner_id: selections.ownerId || null,
          selected_frente_leadgen: selections.frenteLeadgen,
          selected_frente_avr: selections.frenteAvr,
          requested_quantity: selections.quantity,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.conversation?.id) {
        toast.error(json?.error ?? t("toastFailedCreateConversation"));
        return null;
      }
      onConversationCreated(json.conversation.id as string);
      return json.conversation.id as string;
    } catch {
      toast.error(t("toastFailedCreateConversation"));
      return null;
    }
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || sending) return;

    setSending(true);
    const userMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content }]);
    setInput("");

    const convId = await ensureConversation();
    if (!convId) {
      setSending(false);
      return;
    }

    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: "", pending: true }]);

    try {
      const res = await fetch(`/api/prospecting/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.status === 409) {
        const json = await res.json().catch(() => null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, pending: false, role: "system", content: t("notConfiguredMessage") }
              : m,
          ),
        );
        if (json?.setup_url) {
          toast.error(t("notConfiguredToast"));
        }
        return;
      }

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error ?? t("toastFailedSend"));
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const { event, data } of parseSseChunk(part + "\n\n")) {
            if (event === "token") {
              assistantText += (data as { delta: string }).delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, content: assistantText } : m)),
              );
            } else if (event === "tool_call") {
              setToolActivity((data as { name: string }).name);
            } else if (event === "tool_result") {
              setToolActivity(null);
              const { name, result } = data as { name: string; result?: { run_id?: string } };
              if (name === "pesquisar_empresas" && result?.run_id) {
                onRunStarted?.(result.run_id);
              }
            } else if (event === "error") {
              setToolActivity(null);
              toast.error((data as { message: string }).message);
            } else if (event === "done") {
              setToolActivity(null);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, pending: false } : m)),
              );
            }
          }
        }
      }

      setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, pending: false } : m)));
    } catch {
      toast.error(t("toastFailedSend"));
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      setSending(false);
      setToolActivity(null);
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-border bg-card/60">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Radar className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("emptyStateHint")}</p>
            <div className="grid w-full max-w-md gap-2">
              {SUGGESTIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => sendMessage(t(`suggestions.${key}`))}
                  className="rounded-lg border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                >
                  {t(`suggestions.${key}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : m.role === "system"
                      ? "border border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "bg-muted text-foreground",
                )}
              >
                {m.content || (m.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "")}
              </div>
            </div>
          ))
        )}
      </div>

      {toolActivity && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("toolActivity", { tool: toolActivity })}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
        className={cn("flex items-end gap-2 p-3", !toolActivity && "border-t border-border")}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input);
            }
          }}
          placeholder={t("inputPlaceholder")}
          className="min-h-[40px] flex-1 resize-none border-border bg-muted text-foreground"
          disabled={sending}
        />
        <Button type="submit" size="sm" disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}
