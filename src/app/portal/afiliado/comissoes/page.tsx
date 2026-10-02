"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";
import type { Commission, CommissionStatus } from "@/lib/affiliates/commissions";
import {
  InvoiceDialog,
  formatPeriod,
  money,
  type InvoiceTarget,
} from "@/app/operational/afiliados/_components/invoice-dialog";

type Row = Commission & { store: string };
type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: Row[]; name: string };

const STATUS_STYLE: Record<CommissionStatus, string> = {
  awaiting_invoice: "bg-amber-500/15 text-amber-500",
  invoice_review: "bg-sky-500/15 text-sky-500",
  invoice_rejected: "bg-destructive/15 text-destructive",
  available: "bg-emerald-500/15 text-emerald-500",
  paid_external: "bg-muted text-muted-foreground",
};

export default function PortalCommissionsPage() {
  const t = useTranslations("Portal.commissions");
  const ta = useTranslations("Operational.affiliates");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [target, setTarget] = useState<(InvoiceTarget & { store: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, me] = await Promise.all([fetch("/api/portal/affiliate/commissions"), fetch("/api/portal/affiliate/me")]);
    if (!c.ok || !me.ok) return setState({ kind: "error" });
    const rows = ((await c.json()) as { commissions: Row[] }).commissions;
    const name = ((await me.json()) as { profile: { name: string } }).profile.name;
    setState({ kind: "ready", rows, name });
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function submit(c: InvoiceTarget, form: FormData): Promise<boolean> {
    setBusy(true);
    const res = await fetch(`/api/portal/affiliate/commissions/${c.id}/invoice`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.status === 503 && data?.error === "storage_not_ready") toast.error(ta("commissions.storageNotReady"));
      else toast.error(res.status === 400 || res.status === 409 ? (data?.error ?? ta("saveError")) : ta("saveError"));
      return false;
    }
    toast.success(ta("commissions.invoiceSent"));
    setTarget(null);
    await load();
    return true;
  }

  async function download(id: string, kind: "invoice" | "receipt") {
    const res = await fetch(`/api/portal/affiliate/commissions/${id}/file?kind=${kind}`);
    if (!res.ok) return toast.error(ta("commissions.downloadError"));
    const { url } = (await res.json()) as { url: string };
    window.location.assign(url);
  }

  if (state.kind === "loading") return <Skeleton className="h-32" />;
  if (state.kind === "error") return <EmptyState title={ta("error")} className="min-h-40" />;

  return (
    <>
      <div>
        <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {state.rows.length === 0 ? (
        <EmptyState title={t("empty")} className="min-h-40" />
      ) : (
        <ul className="space-y-2">
          {state.rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{ta("commissions.period", { period: formatPeriod(c.period) })}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[c.status])}>
                    {ta(`commissions.status_${c.status}`)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("storeLabel", { store: c.store })}</p>
                {c.status === "invoice_rejected" && c.invoice_reason && (
                  <p className="mt-1 text-xs text-destructive">{c.invoice_reason}</p>
                )}
                {c.status === "awaiting_invoice" && <p className="mt-1 text-xs text-amber-500">{t("sendInvoiceHint")}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground">{money(c.gross_cents)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {c.invoice_file_name && (
                  <Button variant="ghost" size="sm" onClick={() => download(c.id, "invoice")}>
                    <FileText className="h-3.5 w-3.5" />
                    {ta("commissions.invoice")}
                  </Button>
                )}
                {c.receipt_file_name && (
                  <Button variant="ghost" size="sm" onClick={() => download(c.id, "receipt")}>
                    <ReceiptText className="h-3.5 w-3.5" />
                    {ta("commissions.receipt")}
                  </Button>
                )}
                {(c.status === "awaiting_invoice" || c.status === "invoice_rejected") && (
                  <Button
                    size="sm"
                    onClick={() => setTarget({ id: c.id, affiliate_name: state.name, gross_cents: c.gross_cents, period: c.period, store: c.store })}
                  >
                    {ta("commissions.sendInvoice")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <InvoiceDialog
        item={target}
        busy={busy}
        clientName={target?.store ?? ""}
        onClose={() => setTarget(null)}
        onSubmit={(c, form) => submit(c, form)}
      />
    </>
  );
}
