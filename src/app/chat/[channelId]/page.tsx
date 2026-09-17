"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Hash, Lock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useRealtime } from "@/hooks/use-realtime";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer, type ChatAttachmentDraft } from "@/components/chat/chat-composer";
import type { ChatChannel, ChatMessage } from "@/types";

export default function ChatChannelPage() {
  const t = useTranslations("Chat");
  const params = useParams<{ channelId: string }>();
  const router = useRouter();
  const { profile, canManageMembers } = useAuth();

  const [channel, setChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const channelId = params.channelId;
  // Kept in a ref so the realtime callback (registered once per
  // channelId via useRealtime's effect) always filters against the
  // channel actually being viewed, not a stale closure.
  const channelIdRef = useRef(channelId);
  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/channels/${channelId}/messages`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("loadError"));
        return;
      }
      setMessages(data.messages ?? []);
    } catch {
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  const loadChannel = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/channels");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const found = (data.channels ?? []).find((c: ChatChannel) => c.id === channelId) ?? null;
      setChannel(found);
      if (!found) {
        toast.error(t("channelNotFound"));
        router.push("/chat");
      }
    } catch {
      // Non-fatal — the message list still loads via its own fetch.
    }
  }, [channelId, router, t]);

  useEffect(() => {
    void loadChannel();
    void loadMessages();
  }, [loadChannel, loadMessages]);

  useRealtime({
    channelName: "chat-messages",
    onChatMessageEvent: (event) => {
      const row = event.new as ChatMessage;
      if (!row || row.channel_id !== channelIdRef.current) return;
      if (event.eventType === "INSERT") {
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      } else if (event.eventType === "UPDATE") {
        setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
      }
    },
  });

  const handleSend = useCallback(
    async (content: string | null, attachment: ChatAttachmentDraft | null) => {
      const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          attachment_url: attachment?.url,
          attachment_type: attachment?.type,
          attachment_name: attachment?.name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("sendError"));
        return;
      }
      // Realtime will also deliver this INSERT — the dedupe in the
      // handler above (by id) makes appending here safe too, and gives
      // the sender's own view an immediate update even if the socket
      // is briefly behind.
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
    },
    [channelId, t],
  );

  const handleEdit = useCallback(
    async (message: ChatMessage) => {
      const next = window.prompt(t("message.editPrompt"), message.content ?? "");
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      const res = await fetch(`/api/chat/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("message.editError"));
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === message.id ? data.message : m)));
    },
    [t],
  );

  const handleDelete = useCallback(
    async (message: ChatMessage) => {
      if (!window.confirm(t("message.deleteConfirm"))) return;
      const res = await fetch(`/api/chat/messages/${message.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("message.deleteError"));
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, content: null, attachment_url: null, deleted_at: new Date().toISOString() }
            : m,
        ),
      );
    },
    [t],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        {channel?.is_private ? (
          <Lock className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Hash className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium text-foreground">{channel?.name ?? "..."}</span>
        {channel?.description && (
          <span className="truncate text-sm text-muted-foreground">— {channel.description}</span>
        )}
      </div>

      <ChatMessageList
        messages={messages}
        currentProfileId={profile?.id ?? null}
        canModerate={canManageMembers}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <ChatComposer onSend={handleSend} />
    </div>
  );
}
