"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaskComment } from "@/types";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "./mention-textarea";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadEnvironmentMembers } from "@/lib/auth/environment-members";
import { extractMentionedIds, splitMentions, type MentionMember } from "@/lib/tasks/mentions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useDraft } from "@/hooks/use-draft";

// Generic comment thread — Etapa 2 item 6. Unlike Comercial's deal
// comments (inline JSX on the deal detail page, no shared component),
// this is a standalone component so both the task drawer and (later)
// any other Operational surface can reuse it. One level of replies via
// `parent_comment_id` — matches the spec's "respostas" requirement
// without a full nested-thread tree.
//
// What is being typed is kept as a draft in this browser: switching tabs,
// closing the task or opening another one to copy something does not lose it.
// The draft is only cleared when the comment is sent (or the edit is saved).

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

function initials(name?: string | null) {
  const source = (name || "?").trim();
  return source ? source.charAt(0).toUpperCase() : "?";
}

interface CommentThreadProps {
  taskId: string;
  comments: TaskComment[];
  currentUserId?: string;
  canComment: boolean;
  onChanged: () => void;
}

const draftKey = (userId: string | undefined, suffix: string) => `wacrm:task-comment-draft:${userId ?? "anon"}:${suffix}`;

export function CommentThread({ taskId, comments, currentUserId, canComment, onChanged }: CommentThreadProps) {
  const t = useTranslations("Operational.comments");
  const [body, setBody] = useDraft(draftKey(currentUserId, taskId));
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // People who can be mentioned: those who have access to Operacional (they
  // can open the task). Everyone is used to highlight "@Name" in the texts;
  // the list offered while typing leaves yourself out.
  const { profile } = useAuth();
  const [members, setMembers] = useState<MentionMember[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadEnvironmentMembers(createClient(), "operational");
      if (!cancelled) setMembers(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const suggestable = useMemo(() => members.filter((m) => m.id !== profile?.id), [members, profile?.id]);

  const topLevel = comments.filter((c) => !c.parent_comment_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_comment_id === id);

  async function handleSubmit() {
    if (!body.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: body.trim(),
        parent_comment_id: replyTo,
        mentioned_profile_ids: extractMentionedIds(body, suggestable),
      }),
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

  function renderRow(comment: TaskComment, isReply = false) {
    return (
      <CommentRow
        key={comment.id}
        taskId={taskId}
        comment={comment}
        isReply={isReply}
        isMine={!!currentUserId && comment.user_id === currentUserId}
        canComment={canComment}
        currentUserId={currentUserId}
        members={members}
        suggestable={suggestable}
        editing={editingId === comment.id}
        onStartEdit={() => setEditingId(comment.id)}
        onStopEdit={() => setEditingId(null)}
        onReply={() => setReplyTo(comment.id)}
        onDelete={() => handleDelete(comment.id)}
        onChanged={onChanged}
      >
        {repliesOf(comment.id).map((reply) => renderRow(reply, true))}
      </CommentRow>
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
          <MentionTextarea
            value={body}
            onChange={setBody}
            members={suggestable}
            placeholder={t("placeholder")}
            className="min-h-16 border-border bg-muted text-sm text-foreground"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{body.trim() ? t("draftKept") : ""}</span>
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
          .map((comment) => renderRow(comment))
      )}
    </div>
  );
}

function CommentRow({
  taskId,
  comment,
  isReply,
  isMine,
  canComment,
  currentUserId,
  members,
  suggestable,
  editing,
  onStartEdit,
  onStopEdit,
  onReply,
  onDelete,
  onChanged,
  children,
}: {
  taskId: string;
  comment: TaskComment;
  isReply: boolean;
  isMine: boolean;
  canComment: boolean;
  currentUserId?: string;
  members: MentionMember[];
  suggestable: MentionMember[];
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onReply: () => void;
  onDelete: () => void;
  onChanged: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Operational.comments");
  const name = comment.author?.full_name || t("unknownAuthor");

  return (
    <div className={isReply ? "ml-10 mt-2" : "mt-3"}>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <Avatar size="lg" className="size-11">
          {comment.author?.avatar_url ? <AvatarImage src={comment.author.avatar_url} alt={name} /> : null}
          <AvatarFallback className="text-base font-semibold">{initials(comment.author?.full_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {/* Header as tall as the photo, so the name and the time sit centered next to it. */}
          <div className="flex min-h-11 items-center justify-between gap-2">
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {relativeTime(comment.created_at)}
                {comment.edited_at && (
                  <span className="ml-1.5" title={new Date(comment.edited_at).toLocaleString()}>
                    {t("edited")}
                  </span>
                )}
              </p>
            </div>
            {isMine && !editing && (
              <div className="flex shrink-0 items-center gap-2">
                {canComment && (
                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("edit")}
                    title={t("edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-muted-foreground hover:text-red-400"
                  aria-label={t("delete")}
                  title={t("delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          {editing ? (
            <EditBox
              taskId={taskId}
              comment={comment}
              currentUserId={currentUserId}
              suggestable={suggestable}
              onDone={() => {
                onStopEdit();
                onChanged();
              }}
              onCancel={onStopEdit}
            />
          ) : (
            <>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                {splitMentions(comment.body, members).map((part, i) =>
                  part.mention ? (
                    <span key={i} className="rounded bg-primary/15 px-1 font-medium text-primary">
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </p>
              {!isReply && canComment && (
                <button
                  type="button"
                  onClick={onReply}
                  className="mt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {t("reply")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Edit box for one of your comments. The text being edited is also kept as a draft. */
function EditBox({
  taskId,
  comment,
  currentUserId,
  suggestable,
  onDone,
  onCancel,
}: {
  taskId: string;
  comment: TaskComment;
  currentUserId?: string;
  suggestable: MentionMember[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Operational.comments");
  const key = draftKey(currentUserId, `edit:${comment.id}`);
  const [draft, setDraft] = useDraft(key);
  const [saving, setSaving] = useState(false);
  // Until the person types (or comes back to a saved draft) the box shows the
  // current text of the comment; after that it shows what they are writing.
  const [touched, setTouched] = useState(draft !== "");
  const text = touched ? draft : comment.body;
  const unchanged = text.trim() === comment.body.trim();

  async function save() {
    if (!text.trim() || unchanged) return;
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${taskId}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text.trim(), mentioned_profile_ids: extractMentionedIds(text, suggestable) }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastEditFailed"));
      return;
    }
    setDraft("");
    onDone();
  }

  function cancel() {
    setDraft("");
    onCancel();
  }

  return (
    <div className="mt-1 space-y-2">
      <MentionTextarea
        autoFocus
        value={text}
        onChange={(v) => {
          setTouched(true);
          setDraft(v);
        }}
        members={suggestable}
        className="min-h-16 border-border bg-muted text-sm text-foreground"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={cancel} disabled={saving}>
          {t("cancelEdit")}
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !text.trim() || unchanged}>
          {saving ? t("saving") : t("saveEdit")}
        </Button>
      </div>
    </div>
  );
}
