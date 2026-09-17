"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES,
} from "@/lib/storage/upload-media";

/** Same bucket the WhatsApp inbox composer uses (migration 023) — its
 *  RLS is account-scoped, not feature-scoped, so chat attachments can
 *  safely share it rather than adding a new bucket. */
const CHAT_MEDIA_BUCKET = "chat-media";

export interface ChatAttachmentDraft {
  url: string;
  path: string;
  type: string;
  name: string;
}

interface ChatComposerProps {
  disabled?: boolean;
  onSend: (content: string | null, attachment: ChatAttachmentDraft | null) => Promise<void> | void;
}

export function ChatComposer({ disabled = false, onSend }: ChatComposerProps) {
  const t = useTranslations("Chat.composer");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<ChatAttachmentDraft | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentRef = useRef<ChatAttachmentDraft | null>(null);

  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);

  // GC a staged-but-unsent attachment if the user navigates away.
  useEffect(() => {
    return () => {
      const staged = attachmentRef.current;
      if (staged) void deleteAccountMedia(CHAT_MEDIA_BUCKET, staged.path).catch(() => {});
    };
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handlePick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setBusy(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      if (attachmentRef.current) {
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, attachmentRef.current.path).catch(() => {});
      }
      setAttachment({ url: publicUrl, path, type: file.type, name: file.name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("uploadError"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const discardAttachment = useCallback(() => {
    if (attachment) void deleteAccountMedia(CHAT_MEDIA_BUCKET, attachment.path).catch(() => {});
    setAttachment(null);
  }, [attachment]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed || null, attachment);
      setText("");
      setAttachment(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } finally {
      setSending(false);
    }
  }, [text, attachment, sending, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-border bg-card p-3">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          void handlePick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {attachment && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="truncate text-sm text-foreground">{attachment.name}</span>
          <button
            type="button"
            onClick={discardAttachment}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
          title={t("attach")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("placeholder")}
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />

        <button
          type="button"
          disabled={disabled || sending || (!text.trim() && !attachment)}
          onClick={() => void handleSend()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary p-0 text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
