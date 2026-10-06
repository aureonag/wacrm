"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Badge, Panel, money } from "../../../_components/metric";
import { useWorkspace } from "../../../_components/workspace";

interface Reports {
  orders: {
    id: string;
    code: string | null;
    affiliate_name: string;
    coupon: string | null;
    total_cents: number;
    status: "paid" | "cancelled" | "pending";
    ordered_at: string;
  }[];
  audit: { id: string; action: string; actor_name: string | null; actor_kind: string | null; created_at: string }[];
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "not_ready" } | { kind: "ready"; data: Reports };

const ORDER_TONE = { paid: "good", cancelled: "bad", pending: "warn" } as const;
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function AffiliateReportsPage() {
  const t = useTranslations("Operational.affiliates");
  const { apiBase: api, can } = useWorkspace();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${api}/reports`);
      if (cancelled) return;
      if (res.status === 503) return setState({ kind: "not_ready" });
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", data: (await res.json()) as Reports });
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (state.kind === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (state.kind === "not_ready") return <EmptyState title={t("notReadyTitle")} hint={t("notReadyHint")} className="min-h-40" />;
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const { orders, audit } = state.data;

  return (
    <div className="space-y-4">
      {can("reports", "edit") && (
        <Panel title={t("reports.exportTitle")} hint={t("reports.exportHint")}>
          <a href={`${api}/commissions/export`}>
            <Button type="button">
              <Download className="h-4 w-4" />
              {t("reports.exportCsv")}
            </Button>
          </a>
        </Panel>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <h2 className="px-5 py-4 text-sm font-semibold text-foreground">{t("reports.ordersTitle")}</h2>
        {orders.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("reports.ordersEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">{t("reports.colOrder")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("reports.colAffiliate")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("reports.colCoupon")}</th>
                  <th className="px-3 py-2.5 font-medium">{t("reports.colTotal")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("reports.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-foreground">{o.code ? `#${o.code}` : "—"}</td>
                    <td className="px-3 py-3 text-foreground">{o.affiliate_name}</td>
                    <td className="px-3 py-3 text-muted-foreground">{o.coupon ?? "—"}</td>
                    <td className="px-3 py-3 font-medium text-foreground">{money(o.total_cents)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={ORDER_TONE[o.status]}>{t(`reports.order_${o.status}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Panel title={t("reports.auditTitle")}>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reports.auditEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {audit.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-foreground">
                  {a.action}
                  <small className="block text-xs text-muted-foreground">
                    {[a.actor_name, dateTime.format(new Date(a.created_at))].filter(Boolean).join(" · ")}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
