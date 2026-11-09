"use client";

// Public, read-only view of a shared Reportei report (see /api/public/reportei).

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/dashboard/skeleton";
import { DocBody } from "@/components/reportei/report-doc-view";
import { PRINT_CSS, ReportView } from "@/components/reportei/report-view";
import { showDate } from "@/lib/reportei/format";
import type { ReportSnapshot } from "@/lib/reportei/report";

interface SharedReport {
  clientName: string;
  logoUrl?: string | null;
  title: string;
  subtitle?: string;
  notes: string;
  createdAt: string;
  snapshot: ReportSnapshot;
}

type State = { kind: "loading" } | { kind: "notFound" } | { kind: "error" } | { kind: "ready"; report: SharedReport };

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const tp = useTranslations("Operational.reportei.reportPage");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/reportei/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 404) return setState({ kind: "notFound" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", report: ((await res.json()) as { report: SharedReport }).report });
      })
      .catch(() => alive && setState({ kind: "error" }));
    return () => {
      alive = false;
    };
  }, [token]);

  if (state.kind === "loading") return <Skeleton className="h-64" />;
  if (state.kind !== "ready") {
    return <p className="py-16 text-center text-sm text-muted-foreground">{state.kind === "notFound" ? tp("publicNotFound") : tp("publicError")}</p>;
  }

  const { report } = state;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div id="report-print" className="space-y-6">
        {report.snapshot.doc?.demo && <p className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">MODELO COM NÚMEROS FICTÍCIOS: não é um resultado real.</p>}
        {report.snapshot.doc ? (
          <DocBody
            doc={report.snapshot.doc}
            title={report.title}
            clientName={report.clientName}
            logoUrl={report.logoUrl ?? null}
            generatedText={`Relatório gerado dos dados analisados entre ${showDate(report.snapshot.period.since)} e ${showDate(report.snapshot.period.until)}${report.snapshot.compare ? ` comparado com os dados coletados entre ${showDate(report.snapshot.compare.since)} e ${showDate(report.snapshot.compare.until)}` : ""}.`}
            editable={false}
          />
        ) : (
        <ReportView title={report.title} subtitle={report.subtitle} clientName={report.clientName} createdAt={report.createdAt} snapshot={report.snapshot} />
        )}
        {report.notes && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{tp("notesTitle")}</h2>
            <p className="whitespace-pre-wrap text-sm text-foreground">{report.notes}</p>
          </section>
        )}
      </div>
      <div className="no-print flex justify-end border-t border-border pt-4">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" />
          {tp("publicPrint")}
        </Button>
      </div>
    </>
  );
}
