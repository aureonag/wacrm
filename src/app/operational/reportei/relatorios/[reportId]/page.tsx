"use client";

// One saved report: the frozen numbers per ad account with the change against
// the previous period, a free-text analysis, and print / save as PDF.

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, LayoutTemplate, Printer, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ReportDocEditor } from "../../_components/report-doc-editor";
import { ReportEditDialog } from "../../_components/report-edit-dialog";
import { ShareReport } from "../../_components/share-report";
import { TemplateDialog } from "../../_components/template-dialog";
import { effectiveOptions } from "@/lib/reportei/template";
import { useHasPermission } from "@/hooks/use-permissions";
import { PRINT_CSS, ReportView } from "@/components/reportei/report-view";
import type { ReportSnapshot } from "@/lib/reportei/report";

interface ReportData {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string | null;
  title: string;
  subtitle: string;
  notes: string;
  snapshot: ReportSnapshot;
  shareToken: string | null;
  shareExpiresAt: string | null;
  logoUrl?: string | null;
  createdAt: string;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; report: ReportData };

export default function ReporteiReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  const tp = useTranslations("Operational.reportei.reportPage");
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

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

  // Reports made as a document (blocks and indicators) open in the editor.
  if (snapshot.doc) {
    return (
      <ReportDocEditor
        canEdit={canEdit}
        report={{
          id: report.id,
          clientId: report.clientId,
          clientName: report.clientName,
          logoUrl: report.logoUrl ?? null,
          title: report.title,
          snapshot: { ...snapshot, doc: snapshot.doc },
          shareToken: report.shareToken,
          shareExpiresAt: report.shareExpiresAt,
          createdAt: report.createdAt,
        }}
      />
    );
  }

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
        <ReportView
          title={report.title}
          subtitle={report.subtitle}
          clientName={report.clientName}
          clientCode={report.clientCode}
          createdAt={report.createdAt}
          snapshot={snapshot}
        />

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
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                {tp("customize")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSavingTemplate(true)}>
                <LayoutTemplate className="mr-1.5 h-4 w-4" />
                {tp("saveAsTemplate")}
              </Button>
            </>
          )}
          {canEdit && <ShareReport reportId={reportId} initialToken={report.shareToken} initialExpiresAt={report.shareExpiresAt} />}
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            {tp("print")}
          </Button>
        </div>
      </div>
      {editing && (
        <ReportEditDialog
          reportId={reportId}
          title={report.title}
          subtitle={report.subtitle}
          snapshot={snapshot}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
      {savingTemplate && (
        <TemplateDialog
          template={null}
          prefill={{ ...effectiveOptions(snapshot.options), name: report.title, compare: snapshot.compare !== null }}
          onClose={() => setSavingTemplate(false)}
          onSaved={() => {
            setSavingTemplate(false);
            toast.success(tp("templateSaved"));
          }}
        />
      )}
    </>
  );
}
