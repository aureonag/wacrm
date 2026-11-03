"use client";

// Operacional → Reportei → Clientes → one client. The sections (integrations,
// reports, automations) are tabs. Right after "Novo cliente" (?novo=1) the
// page opens on step 2 of the wizard: link the client's ad accounts.

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ClientCode } from "@/components/operational/client-code";
import { cn } from "@/lib/utils";
import type { ClientStatus } from "@/lib/operational/clients-projects";
import { IntegrationsPanel, type Integration } from "../../_components/integrations-panel";
import { WizardProgress } from "../../_components/wizard-progress";

interface Client {
  id: string;
  name: string;
  code: string | null;
  status: ClientStatus;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; client: Client; integrations: Integration[] };
type Tab = "integrations" | "reports" | "automations";

const TABS: Tab[] = ["integrations", "reports", "automations"];

export default function ReporteiClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ novo?: string }>;
}) {
  const { clientId } = use(params);
  const { novo } = use(searchParams);
  const isWizard = novo === "1";
  const t = useTranslations("Operational.reportei");
  const tc = useTranslations("Operational.reportei.clientPage");
  const tw = useTranslations("Operational.reportei.wizard");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tab, setTab] = useState<Tab>("integrations");

  const load = useCallback(async () => {
    const res = await fetch(`/api/operational/reportei/clients/${clientId}`);
    if (res.status === 404) return setState({ kind: "notFound" });
    if (!res.ok) return setState({ kind: "error" });
    const data = (await res.json()) as { client: Client; integrations: Integration[] };
    setState({ kind: "ready", client: data.client, integrations: data.integrations });
  }, [clientId]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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

  const { client, integrations } = state;
  const panel = <IntegrationsPanel clientId={client.id} clientName={client.name} integrations={integrations} onChanged={load} />;

  if (isWizard) {
    return (
      <>
        {back}
        <h1 className="text-2xl font-bold text-foreground">{tw("title")}</h1>
        <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14">
          <WizardProgress current={2} total={2} title={tw("step2Title")} hint={tw("step2Hint", { name: client.name })} />
          <div>{panel}</div>
        </div>
        <div className="flex justify-end">
          <Link
            href={`/operational/reportei/clientes/${client.id}`}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {tw("finish")}
          </Link>
        </div>
      </>
    );
  }

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

      {tab === "integrations" ? panel : <EmptyState title={t("comingSoonTitle")} hint={t("comingSoonHint")} className="min-h-48" />}
    </>
  );
}
