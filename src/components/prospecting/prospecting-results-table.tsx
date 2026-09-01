"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CircleCheck,
  ExternalLink,
  Import,
  Loader2,
  Sparkle,
  Star,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-can";
import { useTranslations } from "next-intl";

export interface ProspectingCandidate {
  id: string;
  company_name: string;
  segment: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  icp_score: number | null;
  icp_grade: "A" | "B" | "C" | null;
  duplicate_status: "new" | "possible_duplicate" | "existing";
  selected: boolean;
  imported_deal_id: string | null;
}

interface ProspectingResultsTableProps {
  runId: string;
  candidates: ProspectingCandidate[];
  onCandidatesChange: (candidates: ProspectingCandidate[]) => void;
  onImported: () => void;
}

/** A row's label-over-value cell — the building block for both card lines. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="truncate text-sm text-foreground">{children}</div>
    </div>
  );
}

/** Five-star rating, filled up to `value` (out of `max`) — used for both the Google rating and the ICP score. */
function RatingStars({ value, max, tone }: { value: number | null; max: number; tone: "amber" | "primary" }) {
  if (value === null) return <span className="text-sm text-muted-foreground">—</span>;
  const filled = Math.round((value / max) * 5);
  const starClass = tone === "amber" ? "fill-amber-400 text-amber-400" : "fill-primary text-primary";
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm tabular-nums text-foreground">{tone === "amber" ? value.toFixed(1).replace(".", ",") : value}</span>
      <div className="flex">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cn("h-3 w-3", i < filled ? starClass : "text-muted-foreground/30")} />
        ))}
      </div>
    </div>
  );
}

function StatusPill({ candidate, t }: { candidate: ProspectingCandidate; t: ReturnType<typeof useTranslations> }) {
  if (candidate.imported_deal_id) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <CircleCheck className="h-3.5 w-3.5" />
        {t("statusImported")}
      </span>
    );
  }
  if (candidate.duplicate_status === "existing") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" />
        {t("statusExisting")}
      </span>
    );
  }
  if (candidate.duplicate_status === "possible_duplicate") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-400">
        <TriangleAlert className="h-3.5 w-3.5" />
        {t("statusPossibleDuplicate")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-primary">
      <Sparkle className="h-3.5 w-3.5" />
      {t("statusNew")}
    </span>
  );
}

export function ProspectingResultsTable({
  runId,
  candidates,
  onCandidatesChange,
  onImported,
}: ProspectingResultsTableProps) {
  const t = useTranslations("Prospecting.results");
  const canImport = useCan("send-messages");
  const [importing, setImporting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectableCandidates = useMemo(() => candidates.filter((c) => !c.imported_deal_id), [candidates]);
  const selectedIds = candidates.filter((c) => c.selected && !c.imported_deal_id).map((c) => c.id);
  const allSelected = selectableCandidates.length > 0 && selectedIds.length === selectableCandidates.length;

  async function patchSelected(candidateId: string, selected: boolean): Promise<boolean> {
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateId, selected }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function toggleSelected(candidate: ProspectingCandidate, selected: boolean) {
    setSavingId(candidate.id);
    onCandidatesChange(candidates.map((c) => (c.id === candidate.id ? { ...c, selected } : c)));
    const ok = await patchSelected(candidate.id, selected);
    if (!ok) {
      toast.error(t("toastFailedToggle"));
      onCandidatesChange(candidates.map((c) => (c.id === candidate.id ? { ...c, selected: !selected } : c)));
    }
    setSavingId(null);
  }

  async function handleSelectAll() {
    const nextSelected = !allSelected;
    setSelectingAll(true);
    const previous = candidates;
    onCandidatesChange(
      candidates.map((c) => (c.imported_deal_id ? c : { ...c, selected: nextSelected })),
    );
    const results = await Promise.all(
      selectableCandidates.map((c) => patchSelected(c.id, nextSelected)),
    );
    if (results.some((ok) => !ok)) {
      toast.error(t("toastFailedToggle"));
      onCandidatesChange(previous);
    }
    setSelectingAll(false);
  }

  async function handleImport() {
    if (selectedIds.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_ids: selectedIds }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? t("toastFailedImport"));
        return;
      }
      toast.success(t("toastImported", { count: json.imported ?? 0 }));
      onImported();
    } catch {
      toast.error(t("toastFailedImport"));
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}/candidates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_ids: selectedIds }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? t("toastFailedDelete"));
        return;
      }
      toast.success(t("toastDeleted", { count: json.deleted ?? selectedIds.length }));
      onCandidatesChange(candidates.filter((c) => !selectedIds.includes(c.id)));
      setDeleteDialogOpen(false);
    } catch {
      toast.error(t("toastFailedDelete"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {canImport && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={allSelected}
              disabled={selectingAll || selectableCandidates.length === 0}
              onCheckedChange={() => void handleSelectAll()}
            />
            {t("selectAllLabel")}
            <span className="text-xs text-muted-foreground">{t("selectedCount", { count: selectedIds.length })}</span>
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={selectedIds.length === 0}
              title={t("deleteButton")}
              className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={handleImport} disabled={importing || selectedIds.length === 0}>
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Import className="h-3.5 w-3.5" />}
              {t("importButton")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t("deleteDialogTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("deleteDialogDesc", { count: selectedIds.length })}</p>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button onClick={handleDeleteSelected} disabled={deleting} className="bg-red-600 text-white hover:bg-red-700">
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("deletingButton")}
                </>
              ) : (
                t("deleteButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        {candidates.map((c) => {
          const region = [c.city, c.state].filter(Boolean).join(", ");
          return (
            <div key={c.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={c.selected}
                  disabled={!canImport || !!c.imported_deal_id || savingId === c.id}
                  onCheckedChange={(checked) => toggleSelected(c, checked === true)}
                  aria-label={t("selectRowLabel", { company: c.company_name })}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Line 1 — who they are */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Field label={t("colCompany")}>
                      <span className="font-medium">{c.company_name}</span>
                    </Field>
                    <Field label={t("colSegment")}>{c.segment ?? "—"}</Field>
                    <Field label={t("colRegion")}>{region || "—"}</Field>
                    <Field label={t("colPhone")}>{c.phone ?? "—"}</Field>
                  </div>

                  {/* Line 2 — what we found about them */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-2 sm:grid-cols-5">
                    <Field label={t("colWebsite")}>
                      {c.website ? (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {t("linkLabel")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </Field>
                    <Field label={t("colInstagram")}>
                      {c.instagram ? (
                        <a
                          href={`https://instagram.com/${c.instagram}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{c.instagram}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Field>
                    <Field label={t("colRating")}>
                      <RatingStars value={c.google_rating} max={5} tone="amber" />
                    </Field>
                    <Field label={t("colScore")}>
                      <RatingStars value={c.icp_score} max={100} tone="primary" />
                    </Field>
                    <Field label={t("colDuplicate")}>
                      <StatusPill candidate={c} t={t} />
                    </Field>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
