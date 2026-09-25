"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Profile, Sector } from "@/types";
import type { ScopeSection } from "@/lib/contracts/scope";
import { SCOPE_TITLES } from "@/lib/tasks/kickoff-briefing";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

interface BoardOption {
  id: string;
  name: string;
}

interface CloseDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  sectors: Sector[];
  profiles: Profile[];
  defaultAssigneeId: string | null;
  onClosed: () => void;
}

const NONE = "__none";

export function CloseDealDialog({
  open,
  onOpenChange,
  dealId,
  sectors,
  profiles,
  defaultAssigneeId,
  onClosed,
}: CloseDealDialogProps) {
  const t = useTranslations("Pipelines.closing");

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [scope, setScope] = useState<ScopeSection[]>([]);
  const [hasSignedContract, setHasSignedContract] = useState(false);

  const [boardId, setBoardId] = useState(NONE);
  const [sectorId, setSectorId] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [observations, setObservations] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBoardId(NONE);
    setSectorId(NONE);
    setAssigneeId(defaultAssigneeId ?? NONE);
    setObservations("");
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/close`);
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as {
          boards: BoardOption[];
          scope: ScopeSection[];
          hasSignedContract: boolean;
        };
        if (cancelled) return;
        setBoards(data.boards);
        setScope(data.scope);
        setHasSignedContract(data.hasSignedContract);
      } catch {
        if (!cancelled) toast.error(t("toastLoadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId, defaultAssigneeId, t]);

  const canSubmit = boardId !== NONE && sectorId !== NONE && !loading && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId,
          sectorId,
          assigneeId: assigneeId === NONE ? null : assigneeId,
          observations,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t("toastError"));
        return;
      }
      onOpenChange(false);
      onClosed();
    } catch {
      toast.error(t("toastError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-1">
          <p className="text-sm text-muted-foreground">{t("description")}</p>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("boardLabel")}</Label>
            <Select value={boardId} onValueChange={(v) => setBoardId(v ?? NONE)}>
              <SelectTrigger className="bg-muted text-foreground">
                <SelectValue>{boards.find((b) => b.id === boardId)?.name ?? t("selectPlaceholder")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("sectorLabel")}</Label>
              <Select value={sectorId} onValueChange={(v) => setSectorId(v ?? NONE)}>
                <SelectTrigger className="bg-muted text-foreground">
                  <SelectValue>{sectors.find((s) => s.id === sectorId)?.name ?? t("selectPlaceholder")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("assigneeLabel")}</Label>
              <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
                <SelectTrigger className="bg-muted text-foreground">
                  <SelectValue>
                    {assigneeId === NONE
                      ? t("noAssignee")
                      : (profiles.find((p) => p.id === assigneeId)?.full_name ?? "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noAssignee")}</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("scopeTitle")}</Label>
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : scope.length > 0 ? (
                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {scope.map((section) => (
                    <div key={section.key}>
                      <div className="font-semibold text-foreground">{SCOPE_TITLES[section.key]}</div>
                      <ul className="ml-4 list-disc">
                        {section.lines.map((line, i) => (
                          <li key={i}>{line.replace(/^[-*•]\s+/, "")}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p>{hasSignedContract ? t("scopeNotFound") : t("scopeNoContract")}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("scopeHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("observationsLabel")}</Label>
            <Textarea
              spellCheck
              lang="pt-BR"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder={t("observationsPlaceholder")}
              className="min-h-24 border-border bg-muted text-sm text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover/50 border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
