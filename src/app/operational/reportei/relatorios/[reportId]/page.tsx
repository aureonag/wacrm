"use client";

// One saved report: the frozen numbers per ad account with the change against
// the previous period, a free-text analysis, and print / save as PDF.

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Megaphone, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { useHasPermission } from "@/hooks/use-permissions";
import { formatMetric, showDate, showDateTime } from "@/lib/reportei/format";
import { METRICS, toneFor, variation, type ReportSnapshot } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";

interface ReportData {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string | null;
  title: string;
  notes: string;
  snapshot: ReportSnapshot;
  createdAt: string;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; report: ReportData };

const TONE = { good: "text-emerald-500", bad: "text-red-500", neutral: "text-muted-foreground" } as const;

// Print only the report: hide the app chrome, force a light page.
const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  #report-print, #report-print * { visibility: visible; }
  #report-print { position: absolute; left: 0; top: 0; width: 100%; color: #111; background: #fff;
    --foreground: #111; --card: #fff; --background: #fff; --muted-foreground: #555; --border: #ddd; }
  html, body, div.h-screen, main { height: auto !important; overflow: visible !important; background: #fff !important; }
  .no-print { display: none !important; }
}`;

export default function ReporteiReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const t = useTranslations("Operational.reportei.reports");
  const tp = useTranslations("Operational.reportei.reportPage");
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/reports/${reportId}`);
    if (res.status === 404) return setState({ kind: "notFound" });
    if (!res.ok) return setState({ kind: "error" });
    const { report } = (await res.json()) as { report: ReportData };
    setNotes(report.notes);
    setState({ kind: "ready", report });
  }, [reportId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    void load();
  }, [load]);

  const back = (
    <Link href="/operational/reportei/relatorios" className="no-print inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      {tp("back")}
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <>
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-56" />
      </>
    );
  }
  if (state.kind !== "ready") {
    return (
      <>
        {back}
        <EmptyState title={state.kind === "notFound" ? tp("notFound") : tp("error")} className="min-h-40" />
      </>
    );
  }

  const { report } = state;
  const { snapshot } = report;

  async function saveNotes() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) return toast.error(tp("saveError"));
      toast.success(tp("saved"));
    } catch {
      toast.error(tp("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(tp("deleteConfirm"))) return;
    const res = await fetch(`/api/operational/reportei/reports/${reportId}`, { method: "DELETE" });
    if (!res.ok) return toast.error(tp("deleteError"));
    toast.success(tp("deleted"));
    router.push("/operational/reportei/relatorios");
  }

  return (
    <>
      <style>{PRINT_CSS}</style>
      {back}
      <div id="report-print" className="space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ClientCode code={report.clientCode} />
            <p className="text-sm text-muted-foreground">{report.clientName}</p>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("range", { since: showDate(snapshot.period.since), until: showDate(snapshot.period.until) })}
            {snapshot.compare && (
              <>
                {" · "}
                {tp("comparedWith", { since: showDate(snapshot.compare.since), until: showDate(snapshot.compare.until) })}
              </>
            )}
            {" · "}
            {tp("generatedAt", { date: showDateTime(report.createdAt) })}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {snapshot.accounts.map((a) => (
            <section key={a.id} className="break-inside-avoid rounded-xl border border-border bg-card p-4">
              <header className="mb-3 flex items-center gap-2">
                <Megaphone className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-foreground">{a.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">Meta Ads · {a.id}</p>
                </div>
              </header>
              {a.insights ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
                  {METRICS.map((key) => {
                    const current = a.insights![key];
                    const change = a.previous ? variation(current, a.previous[key]) : null;
                    const tone = toneFor(key, change);
                    return (
                      <div key={key}>
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`metric_${key}`)}</dt>
                        <dd className="mt-0.5 text-base font-semibold text-foreground">{formatMetric(key, current, a.currency)}</dd>
                        {snapshot.compare && (
                          <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs", TONE[tone])}>
                            {change === null ? (
                              tp("noBase")
                            ) : (
                              <>
                                {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {`${change >= 0 ? "+" : "−"}${Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="text-sm text-red-500">{t(`accountError_${a.error ?? "request_failed"}`)}</p>
              )}
            </section>
          ))}
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{tp("notesTitle")}</h2>
          {canEdit ? (
            <>
              <Textarea
                value={notes}
                maxLength={5000}
                rows={6}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tp("notesPlaceholder")}
                className="no-print"
              />
              {/* Print shows the text, not the box. */}
              <p className="hidden whitespace-pre-wrap text-sm text-foreground print:block">{notes}</p>
              <div className="no-print flex justify-end">
                <Button size="sm" variant="outline" disabled={saving || notes.trim() === report.notes.trim()} onClick={saveNotes}>
                  {tp("saveNotes")}
                </Button>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">{report.notes || <span className="text-muted-foreground">{tp("noNotes")}</span>}</p>
          )}
        </section>
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {canEdit ? (
          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-500" onClick={remove}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            {tp("delete")}
          </Button>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" />
          {tp("print")}
        </Button>
      </div>
    </>
  );
}
