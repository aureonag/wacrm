"use client";

import { useState } from "react";
import type { TaskComment } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// Generic comment thread — Etapa 2 item 6. Unlike Comercial's deal
// comments (inline JSX on the deal detail page, no shared component),
// this is a standalone component so both the task drawer and (later)
// any other Operational surface can reuse it. One level of replies via
// `parent_comment_id` — matches the spec's "respostas" requirement
// without a full nested-thread tree.

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

interface CommentThreadProps {
  taskId: string;
  comments: TaskComment[];
  currentUserId?: string;
  canComment: boolean;
  onChanged: () => void;
}

export function CommentThread({ taskId, comments, currentUserId, canComment, onChanged }: CommentThreadProps) {
  const t = useTranslations("Operational.comments");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_comment_id === id);

  async function handleSubmit() {
    if (!body.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim(), parent_comment_id: replyTo }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setBody("");
    setReplyTo(null);
    onChanged();
  }

  async function handleDelete(commentId: string) {
    const res = await fetch(`/api/operational/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onChanged();
  }

  function CommentRow({ comment, isReply }: { comment: TaskComment; isReply?: boolean }) {
    const canDelete = comment.user_id === currentUserId;
    return (
      <div className={isReply ? "ml-8 mt-2" : "mt-3"}>
        <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/50 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                {comment.author?.full_name || t("unknownAuthor")}
              </span>
              <span className="text-[11px] text-muted-foreground">{relativeTime(comment.created_at)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{comment.body}</p>
            {!isReply && canComment && (
              <button
                type="button"
                onClick={() => setReplyTo(comment.id)}
                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t("reply")}
              </button>
            )}
          </div>
          {canDelete && (
            <button
              type="button"
              onClick={() => handleDelete(comment.id)}
              className="shrink-0 text-muted-foreground hover:text-red-400"
              aria-label={t("delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {repliesOf(comment.id).map((reply) => (
          <CommentRow key={reply.id} comment={reply} isReply />
        ))}
      </div>
    );
  }

  return (
    <div>
      {canComment && (
        <div className="space-y-2">
          {replyTo && (
            <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              {t("replyingTo")}
              <button type="button" onClick={() => setReplyTo(null)} className="text-primary">
                {t("cancelReply")}
              </button>
            </div>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("placeholder")}
            className="min-h-16 border-border bg-muted text-sm text-foreground"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmit} disabled={saving || !body.trim()}>
              {saving ? t("saving") : t("submit")}
            </Button>
          </div>
        </div>
      )}

      {topLevel.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        topLevel
          .slice()
          .reverse()
          .map((comment) => <CommentRow key={comment.id} comment={comment} />)
      )}
    </div>
  );
}
