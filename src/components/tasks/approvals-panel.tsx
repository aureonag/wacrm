"use client";

import { useState } from "react";
import type { Profile, TaskApproval } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface ApprovalsPanelProps {
  taskId: string;
  approvals: TaskApproval[];
  profiles: Profile[];
  currentUserId?: string;
  canRequest: boolean;
  onChanged: () => void;
}

const NONE = "__none";

export function ApprovalsPanel({ taskId, approvals, profiles, currentUserId, canRequest, onChanged }: ApprovalsPanelProps) {
  const t = useTranslations("Operational.approvals");
  const [requestedTo, setRequestedTo] = useState<string>(NONE);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function handleRequest() {
    if (requestedTo === NONE) return;
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${taskId}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requested_to: requestedTo, comment: comment.trim() || undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setRequestedTo(NONE);
    setComment("");
    toast.success(t("toastRequested"));
    onChanged();
  }

  async function handleDecide(approvalId: string, status: "approved" | "rejected") {
    setDecidingId(approvalId);
    const res = await fetch(`/api/operational/tasks/${taskId}/approvals/${approvalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setDecidingId(null);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-4">
      {canRequest && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid gap-1">
            <Select value={requestedTo} onValueChange={(v) => setRequestedTo(v ?? NONE)}>
              <SelectTrigger className="h-8 w-full bg-muted border-border text-xs text-foreground">
                <SelectValue>
                  {requestedTo === NONE ? t("selectRecipient") : (profiles.find((p) => p.id === requestedTo)?.full_name ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("commentPlaceholder")}
            className="min-h-16 border-border bg-muted text-xs text-foreground"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleRequest} disabled={saving || requestedTo === NONE}>
              {t("request")}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {approvals.map((a) => {
          const isRecipient = !!currentUserId && a.requested_to_profile?.user_id === currentUserId;
          return (
            <div key={a.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">
                  {t("requestedTo", { name: a.requested_to_profile?.full_name ?? t("unknown") })}
                </span>
                <StatusBadge status={a.status} />
              </div>
              {a.comment && <p className="mt-1 text-xs text-muted-foreground">{a.comment}</p>}
              {a.status === "pending" && isRecipient && (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decidingId === a.id}
                    onClick={() => handleDecide(a.id, "approved")}
                    className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                  >
                    <Check className="size-3.5" />
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decidingId === a.id}
                    onClick={() => handleDecide(a.id, "rejected")}
                    className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                  >
                    <X className="size-3.5" />
                    {t("reject")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {approvals.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskApproval["status"] }) {
  const t = useTranslations("Operational.approvals");
  const styles: Record<TaskApproval["status"], string> = {
    pending: "bg-amber-500/15 text-amber-500",
    approved: "bg-emerald-500/15 text-emerald-500",
    rejected: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${styles[status]}`}>
      {t(`status_${status}`)}
    </span>
  );
}
