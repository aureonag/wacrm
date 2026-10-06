"use client";

// Profile of one participant: contact, campaigns and coupons, sales and
// commissions. The Pix key only comes from the server for people who may see
// payments; everyone else just sees whether one was given.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/dashboard/skeleton";
import type { CommissionStatus } from "@/lib/affiliates/commissions";
import { Badge, formatPeriod, money } from "./metric";
import { useWorkspace } from "./workspace";

interface Profile {
  membership: { id: string; code: string; status: string; created_at: string; campaign_name: string };
  affiliate: {
    name: string;
    email: string;
    phone: string | null;
    instagram: string | null;
    city: string | null;
    state: string | null;
    created_at: string;
    has_pix: boolean;
    pix_key_type: string | null;
    pix_key: string | null;
  };
  memberships: { id: string; code: string; status: string; campaign_name: string }[];
  totals: { sales_cents: number; orders: number; cancelled: number; commissions_cents: number; paid_cents: number };
  commissions: { id: string; period: string; gross_cents: number; status: CommissionStatus }[];
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; profile: Profile };

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "muted"> = {
  approved: "good",
  pending: "warn",
  rejected: "bad",
  inactive: "muted",
};
const COMMISSION_TONE: Record<CommissionStatus, "warn" | "info" | "bad" | "good"> = {
  awaiting_invoice: "warn",
  invoice_review: "info",
  invoice_rejected: "bad",
  available: "good",
  paid_external: "good",
};
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export function AffiliateProfileDialog({ membershipId, onClose }: { membershipId: string | null; onClose: () => void }) {
  const t = useTranslations("Operational.affiliates");
  const { apiBase } = useWorkspace();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!membershipId) return;
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      const res = await fetch(`${apiBase}/affiliates/${membershipId}`);
      if (cancelled) return;
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", profile: (await res.json()) as Profile });
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, membershipId]);

  const p = state.kind === "ready" ? state.profile : null;
  const place = p ? [p.affiliate.city, p.affiliate.state].filter(Boolean).join(" / ") : "";
  const contact: [string, string | null][] = p
    ? [
        [t("profile.email"), p.affiliate.email],
        [t("profile.phone"), p.affiliate.phone],
        [t("profile.instagram"), p.affiliate.instagram],
        [t("profile.place"), place || null],
        [t("profile.since"), date.format(new Date(p.affiliate.created_at))],
      ]
    : [];

  return (
    <Dialog open={membershipId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p?.affiliate.name ?? t("profile.title")}</DialogTitle>
          <DialogDescription>{t("profile.hint")}</DialogDescription>
        </DialogHeader>

        {state.kind === "loading" && (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-20" />
          </div>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{t("error")}</p>}

        {p && (
          <div className="space-y-5">
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {contact.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="truncate text-foreground">{value || "—"}</dd>
                </div>
              ))}
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("profile.pix")}</dt>
                <dd className="truncate text-foreground">
                  {p.affiliate.pix_key
                    ? `${p.affiliate.pix_key_type ? `${t(`profile.pixType_${p.affiliate.pix_key_type}`)}: ` : ""}${p.affiliate.pix_key}`
                    : p.affiliate.has_pix
                      ? t("profile.pixGiven")
                      : t("profile.pixMissing")}
                </dd>
              </div>
            </dl>

            <section>
              <h3 className="text-sm font-semibold text-foreground">{t("profile.campaigns")}</h3>
              <ul className="mt-2 space-y-1.5">
                {p.memberships.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-foreground">{m.campaign_name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground">{m.code}</code>
                      <Badge tone={STATUS_TONE[m.status] ?? "muted"}>{t(`members.status_${m.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground">{t("profile.results")}</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  [t("profile.sales"), money(p.totals.sales_cents)],
                  [t("profile.orders"), String(p.totals.orders)],
                  [t("profile.cancelled"), String(p.totals.cancelled)],
                  [t("profile.commissionsTotal"), money(p.totals.commissions_cents)],
                  [t("profile.commissionsPaid"), money(p.totals.paid_cents)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-muted/40 p-2.5">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                    <strong className="mt-1 block text-base font-bold text-foreground">{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground">{t("profile.commissions")}</h3>
              {p.commissions.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("profile.noCommissions")}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {p.commissions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-foreground">{formatPeriod(c.period)}</span>
                      <span className="flex items-center gap-2">
                        <strong className="font-medium text-foreground">{money(c.gross_cents)}</strong>
                        <Badge tone={COMMISSION_TONE[c.status]}>{t(`commissions.status_${c.status}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
