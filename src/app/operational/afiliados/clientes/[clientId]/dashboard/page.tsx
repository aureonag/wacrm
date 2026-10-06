"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Activity, AlertCircle, ArrowUpRight, ChevronRight, FileText, Gift, Plug, Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import type { CommissionStatus } from "@/lib/affiliates/commissions";
import { Badge, Metric, Panel, formatPeriod, money } from "../../../_components/metric";
import { useWorkspace } from "../../../_components/workspace";

interface Dashboard {
  client: { id: string; name: string; status: string };
  attention: { awaiting_invoice: number; invoice_review: number; available: number; pending_affiliates: number };
  results: { paid_sales_cents: number; paid_orders: number; affiliates: number };
  commissions: { accrued_cents: number; available_cents: number; paid_cents: number };
  partners: { affiliate_id: string; name: string; sales_cents: number }[];
  recent: {
    id: string;
    affiliate_name: string;
    code: string | null;
    period: string;
    gross_cents: number;
    status: CommissionStatus;
    invoice_number: string | null;
  }[];
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "not_ready" } | { kind: "ready"; data: Dashboard };

const TONE: Record<CommissionStatus, "warn" | "info" | "bad" | "good"> = {
  awaiting_invoice: "warn",
  invoice_review: "info",
  invoice_rejected: "bad",
  available: "good",
  paid_external: "good",
};

export default function AffiliateDashboardPage() {
  const t = useTranslations("Operational.affiliates");
  const { apiBase, pageBase: base } = useWorkspace();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${apiBase}/dashboard`);
      if (cancelled) return;
      if (res.status === 503) return setState({ kind: "not_ready" });
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", data: (await res.json()) as Dashboard });
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  if (state.kind === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-32" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (state.kind === "not_ready") return <EmptyState title={t("notReadyTitle")} hint={t("notReadyHint")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const d = state.data;
  const topSales = Math.max(1, ...d.partners.map((p) => p.sales_cents));
  const next = [
    { href: `${base}/notas-fiscais`, icon: FileText, key: "invoices" },
    { href: `${base}/afiliados`, icon: Users, key: "affiliates" },
    { href: `${base}/integracoes`, icon: Plug, key: "integrations" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <span className="font-medium">{d.client.name}</span>
        <Badge tone={d.client.status === "active" ? "good" : "warn"}>
          {d.client.status === "active" ? t("clients.active") : t("clients.suspended")}
        </Badge>
      </div>

      <Panel title={t("dashboard.attentionTitle")} icon={AlertCircle} hint={t("dashboard.attentionHint")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={t("dashboard.awaitingInvoice")} value={d.attention.awaiting_invoice} />
          <Metric label={t("dashboard.invoiceReview")} value={d.attention.invoice_review} />
          <Metric label={t("dashboard.availablePayments")} value={d.attention.available} />
          <Metric label={t("dashboard.pendingAffiliates")} value={d.attention.pending_affiliates} />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("dashboard.resultsTitle")} icon={Activity}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label={t("dashboard.paidSales")} value={money(d.results.paid_sales_cents)} />
            <Metric label={t("dashboard.paidOrders")} value={d.results.paid_orders} />
            <Metric label={t("dashboard.affiliates")} value={d.results.affiliates} />
          </div>
        </Panel>
        <Panel title={t("dashboard.commissionsTitle")} icon={Gift}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label={t("dashboard.accrued")} value={money(d.commissions.accrued_cents)} />
            <Metric label={t("dashboard.available")} value={money(d.commissions.available_cents)} />
            <Metric label={t("dashboard.paid")} value={money(d.commissions.paid_cents)} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("dashboard.partnersTitle")} hint={t("dashboard.partnersHint")}>
          {d.partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.partnersEmpty")}</p>
          ) : (
            <ul className="space-y-4">
              {d.partners.map((p) => (
                <li key={p.affiliate_id}>
                  <div className="flex items-center justify-between text-sm">
                    <strong className="font-medium text-foreground">{p.name}</strong>
                    <span className="text-muted-foreground">{money(p.sales_cents)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, Math.round((p.sales_cents / topSales) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("dashboard.nextTitle")}>
          <ul className="divide-y divide-border">
            {next.map(({ href, icon: Icon, key }) => (
              <li key={key}>
                <Link href={href} className="flex items-center gap-3 py-3 transition-colors hover:text-primary">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium text-foreground">{t(`dashboard.next.${key}.title`)}</strong>
                    <small className="text-xs text-muted-foreground">{t(`dashboard.next.${key}.hint`)}</small>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t("dashboard.recentTitle")}</h2>
          <Link href={`${base}/comissoes`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("dashboard.seeAll")}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {d.recent.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("dashboard.recentEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">{t("dashboard.colAffiliate")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("dashboard.colPeriod")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("dashboard.colCommission")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("dashboard.colInvoice")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("dashboard.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <strong className="block font-medium text-foreground">{c.affiliate_name}</strong>
                      {c.code && <small className="text-xs text-muted-foreground">{c.code}</small>}
                    </td>
                    <td className="px-3 py-3 text-foreground">{formatPeriod(c.period)}</td>
                    <td className="px-3 py-3 font-medium text-foreground">{money(c.gross_cents)}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.invoice_number ? t("commissions.invoiceNumber", { n: c.invoice_number }) : t("dashboard.invoiceNotSent")}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE[c.status]}>{t(`commissions.status_${c.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
