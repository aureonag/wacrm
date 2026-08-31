"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const GRADE_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  A: "default",
  B: "secondary",
  C: "destructive",
};

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

  const selectedIds = candidates.filter((c) => c.selected && !c.imported_deal_id).map((c) => c.id);

  async function toggleSelected(candidate: ProspectingCandidate, selected: boolean) {
    setSavingId(candidate.id);
    onCandidatesChange(candidates.map((c) => (c.id === candidate.id ? { ...c, selected } : c)));
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidate.id, selected }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      toast.error(t("toastFailedToggle"));
      onCandidatesChange(candidates.map((c) => (c.id === candidate.id ? { ...c, selected: !selected } : c)));
    } finally {
      setSavingId(null);
    }
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

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t("colCompany")}</TableHead>
              <TableHead>{t("colSegment")}</TableHead>
              <TableHead>{t("colRegion")}</TableHead>
              <TableHead>{t("colPhone")}</TableHead>
              <TableHead>{t("colWebsite")}</TableHead>
              <TableHead>{t("colInstagram")}</TableHead>
              <TableHead>{t("colRating")}</TableHead>
              <TableHead>{t("colScore")}</TableHead>
              <TableHead>{t("colDuplicate")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Checkbox
                    checked={c.selected}
                    disabled={!canImport || !!c.imported_deal_id || savingId === c.id}
                    onCheckedChange={(checked) => toggleSelected(c, checked === true)}
                    aria-label={t("selectRowLabel", { company: c.company_name })}
                  />
                </TableCell>
                <TableCell className="font-medium text-foreground">{c.company_name}</TableCell>
                <TableCell className="text-muted-foreground">{c.segment ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.website ? (
                    <a href={c.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {t("linkLabel")}
                    </a>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
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
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {c.google_rating !== null ? `${c.google_rating.toFixed(1)} (${c.google_review_count ?? 0})` : "—"}
                </TableCell>
                <TableCell>
                  {c.icp_grade ? (
                    <Badge variant={GRADE_VARIANT[c.icp_grade]}>
                      {c.icp_grade} · {c.icp_score}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {c.imported_deal_id ? (
                    <Badge variant="secondary">{t("statusImported")}</Badge>
                  ) : c.duplicate_status === "existing" ? (
                    <Badge variant="destructive">{t("statusExisting")}</Badge>
                  ) : c.duplicate_status === "possible_duplicate" ? (
                    <Badge variant="outline">{t("statusPossibleDuplicate")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("statusNew")}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canImport && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{t("selectedCount", { count: selectedIds.length })}</p>
          <Button size="sm" onClick={handleImport} disabled={importing || selectedIds.length === 0}>
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("importButton")}
          </Button>
        </div>
      )}
    </div>
  );
}
