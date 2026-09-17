"use client";

import { useEffect, useRef } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return format(d, "'Ontem' HH:mm");
  return format(d, "dd/MM HH:mm");
}

function isImageAttachment(type?: string | null): boolean {
  return !!type && type.startsWith("image/");
}

interface ChatMessageListProps {
  messages: ChatMessage[];
  currentProfileId: string | null;
  canModerate: boolean;
  loading: boolean;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
}

export function ChatMessageList({
  messages,
  currentProfileId,
  canModerate,
  loading,
  onEdit,
  onDelete,
}: ChatMessageListProps) {
  const t = useTranslations("Chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("empty.noMessages")}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="flex flex-col gap-3">
        {messages.map((m) => {
          const isMine = !!currentProfileId && m.author_id === currentProfileId;
          const isDeleted = !!m.deleted_at;
          return (
            <div key={m.id} className="group flex items-start gap-3">
              <Avatar className="mt-0.5 size-8 shrink-0">
                {m.author?.avatar_url ? (
                  <AvatarImage src={m.author.avatar_url} alt={m.author.full_name ?? ""} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                  {m.author?.full_name?.charAt(0)?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {m.author?.full_name ?? "?"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTimestamp(m.created_at)}
                  </span>
                  {m.edited_at && !isDeleted && (
                    <span className="text-[11px] text-muted-foreground">{t("message.edited")}</span>
                  )}
                </div>

                {isDeleted ? (
                  <p className="text-sm italic text-muted-foreground">{t("message.deleted")}</p>
                ) : (
                  <>
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                        {m.content}
                      </p>
                    )}
                    {m.attachment_url && (
                      <div className="mt-1">
                        {isImageAttachment(m.attachment_type) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.attachment_url}
                            alt={m.attachment_name ?? ""}
                            className="max-h-64 rounded-lg border border-border object-cover"
                          />
                        ) : (
                          <a
                            href={m.attachment_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{m.attachment_name ?? m.attachment_url}</span>
                          </a>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {!isDeleted && (isMine || canModerate) && (
                <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => onEdit(m)}
                      aria-label={t("message.edit")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(m)}
                    aria-label={t("message.delete")}
                    className={cn("rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
