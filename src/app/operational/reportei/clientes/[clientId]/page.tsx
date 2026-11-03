"use client";

// Operacional → Reportei → Clientes → one client. The sections (integrations,
// reports, automations) are tabs; their content comes in later steps.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { cn } from "@/lib/utils";
import type { ClientStatus } from "@/lib/operational/clients-projects";

interface Client {
  id: string;
  name: string;
  code: string | null;
  status: ClientStatus;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; client: Client };
type Tab = "integrations" | "reports" | "automations";

const TABS: Tab[] = ["integrations", "reports", "automations"];

export default function ReporteiClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const t = useTranslations("Operational.reportei");
  const tc = useTranslations("Operational.reportei.clientPage");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tab, setTab] = useState<Tab>("integrations");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/operational/ops-clients/${clientId}`);
      if (cancelled) return;
      if (res.status === 404) return setState({ kind: "notFound" });
      if (!res.ok) return setState({ kind: "error" });
      const data = (await res.json()) as { client: Client };
      if (!cancelled) setState({ kind: "ready", client: data.client });
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const back = (
    <Link href="/operational/reportei/clientes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      {tc("back")}
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <>
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40" />
      </>
    );
  }
  if (state.kind !== "ready") {
    return (
      <>
        {back}
        <EmptyState title={state.kind === "notFound" ? tc("notFound") : tc("error")} className="min-h-40" />
      </>
    );
  }

  const { client } = state;
  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-2">
        <ClientCode code={client.code} />
        <h1 className="text-2xl font-bold text-foreground">{client.name}</h1>
        {client.status === "inactive" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tc("inactive")}</span>
        )}
      </div>

      <nav className="flex gap-1 border-b border-border" aria-label={client.name}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`nav.${key}`)}
          </button>
        ))}
      </nav>

      <EmptyState title={t("comingSoonTitle")} hint={t("comingSoonHint")} className="min-h-48" />
    </>
  );
}
