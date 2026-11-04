"use client";

// Operacional → Reportei → Relatórios: every saved report, newest first, with
// search by title or client. Reports are generated from a client's Reports tab.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { showDate, showDateTime } from "@/lib/reportei/format";

interface Row {
  id: string;
  clientId: string;
  clientName: string;
  clientCode: string | null;
  title: string;
  periodStart: string;
  periodEnd: string;
  compared: boolean;
  createdAt: string;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Row[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function ReporteiReportsPage() {
  const t = useTranslations("Operational.reportei.reportsPage");
  const tr = useTranslations("Operational.reportei.reports");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    const res = await fetch("/api/operational/reportei/reports");
    if (!res.ok) return setState({ kind: "error" });
    setState({ kind: "ready", rows: ((await res.json()) as { reports: Row[] }).reports });
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    return q ? state.rows.filter((r) => norm(`${r.title} ${r.clientName} ${r.clientCode ?? ""}`).includes(q)) : state.rows;
  }, [state, query]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="pl-8" />
      </div>

      {state.kind === "loading" && <Skeleton className="h-40" />}
      {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state.kind === "ready" && rows.length === 0 && (
        <EmptyState title={state.rows.length === 0 ? t("emptyTitle") : t("noMatch")} hint={state.rows.length === 0 ? t("emptyHint") : undefined} className="min-h-40" />
      )}
      {state.kind === "ready" && rows.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/operational/reportei/relatorios/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <ClientCode code={r.clientCode} />
                    <span>{r.clientName}</span>
                    <span>·</span>
                    <span>{tr("range", { since: showDate(r.periodStart), until: showDate(r.periodEnd) })}</span>
                    <span>·</span>
                    <span>{showDateTime(r.createdAt)}</span>
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
