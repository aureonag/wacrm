"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, Download, FileDown, Loader2, Plus, ReceiptText, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";
import type { Commission, CommissionStatus } from "@/lib/affiliates/commissions";
import { formatPeriod, money } from "./invoice-dialog";
import { useWorkspace } from "./workspace";

export type CommissionsMode = "all" | "invoices" | "payments";

interface Participant {
  id: string;
  name: string;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; commissions: Commission[]; participants: Participant[] };

type Dialogs =
  | { type: "close" }
  | { type: "review"; item: Commission }
  | { type: "payment"; item: Commission }
  | null;

const STATUS_STYLE: Record<CommissionStatus, string> = {
  awaiting_invoice: "bg-amber-500/15 text-amber-500",
  invoice_review: "bg-sky-500/15 text-sky-500",
  invoice_rejected: "bg-destructive/15 text-destructive",
  available: "bg-emerald-500/15 text-emerald-500",
  paid_external: "bg-muted text-muted-foreground",
};

const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

export function CommissionsView({ mode }: { clientId?: string; mode: CommissionsMode }) {
  const t = useTranslations("Operational.affiliates");
  const { apiBase: api, can } = useWorkspace();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([fetch(`${api}/commissions`), fetch(`${api}/affiliates`)]);
    if (!c.ok) return setState({ kind: "error" });
    const commissions = ((await c.json()) as { commissions: Commission[] }).commissions;
    // Participants only feed the "close commission" dialog; without access to the list there are none.
    const memberships = a.ok
      ? ((await a.json()) as { memberships: { status: string; affiliate: Participant | null }[] }).memberships
      : [];
    const seen = new Map<string, Participant>();
    for (const m of memberships) {
      if (m.status === "approved" && m.affiliate) seen.set(m.affiliate.id, { id: m.affiliate.id, name: m.affiliate.name });
    }
    setState({ kind: "ready", commissions, participants: [...seen.values()] });
  }, [api]);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (state.kind !== "ready") return [];
    if (mode === "invoices") return state.commissions.filter((c) => c.status !== "awaiting_invoice");
    if (mode === "payments") return state.commissions.filter((c) => c.status === "available" || c.status === "paid_external");
    return state.commissions;
  }, [state, mode]);

  function failed(res: Response, data: { error?: string } | null) {
    if (res.status === 503 && data?.error === "storage_not_ready") return toast.error(t("commissions.storageNotReady"));
    toast.error(
      res.status === 400 || res.status === 409 ? (data?.error ?? t("saveError")) : t("saveError"),
    );
  }

  async function send(url: string, init: RequestInit, successKey: string): Promise<boolean> {
    setBusy(true);
    const res = await fetch(url, init);
    setBusy(false);
    if (!res.ok) {
      failed(res, (await res.json().catch(() => null)) as { error?: string } | null);
      return false;
    }
    toast.success(t(successKey));
    setDialog(null);
    await load();
    return true;
  }

  async function download(c: Commission, kind: "invoice" | "receipt") {
    const res = await fetch(`${api}/commissions/${c.id}/file?kind=${kind}`);
    if (!res.ok) return toast.error(t("commissions.downloadError"));
    const { url } = (await res.json()) as { url: string };
    window.location.assign(url);
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (state.kind === "error") return <EmptyState title={t("error")} className="min-h-40" />;

  const all = state.commissions;
  const sum = (pred: (c: Commission) => boolean) =>
    all.filter(pred).reduce((n, c) => n + c.gross_cents - c.withholding_cents, 0);
  const metrics = [
    { label: t("commissions.metricWaiting"), value: String(all.filter((c) => c.status === "awaiting_invoice" || c.status === "invoice_rejected").length) },
    { label: t("commissions.metricReview"), value: String(all.filter((c) => c.status === "invoice_review").length) },
    { label: t("commissions.metricAvailable"), value: money(sum((c) => c.status === "available")) },
    { label: t("commissions.metricPaid"), value: money(sum((c) => c.status === "paid_external")) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-2 text-xl font-bold text-foreground">{m.value}</p>
          </div>
        ))}
      </div>

      {mode === "payments" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">{t("commissions.paymentsTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("commissions.paymentsHint")}</p>
            </div>
          </div>
          {(can("payments", "edit") || can("reports", "edit")) && (
            <a href={`${api}/commissions/export`}>
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" />
                {t("commissions.export")}
              </Button>
            </a>
          )}
        </div>
      )}

      {mode === "all" && can("commissions", "edit") && (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ type: "close" })} disabled={state.participants.length === 0}>
            <Plus className="h-4 w-4" />
            {t("commissions.close")}
          </Button>
        </div>
      )}
      {mode === "all" && can("commissions", "edit") && state.participants.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("commissions.needAffiliate")}</p>
      )}

      {rows.length === 0 ? (
        <EmptyState title={t(`commissions.empty_${mode}`)} className="min-h-40" />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{c.affiliate_name || "—"}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[c.status])}>
                    {t(`commissions.status_${c.status}`)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("commissions.period", { period: formatPeriod(c.period) })}
                  {c.invoice_number ? ` · ${t("commissions.invoiceNumber", { n: c.invoice_number })}` : ""}
                </p>
                {c.status === "invoice_rejected" && c.invoice_reason && (
                  <p className="mt-1 text-xs text-destructive">{c.invoice_reason}</p>
                )}
                {(c.status === "awaiting_invoice" || c.status === "invoice_rejected") && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("commissions.awaitingFromAffiliate")}</p>
                )}
                {c.status !== "paid_external" && c.status !== "awaiting_invoice" && <PixLine c={c} />}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground">{money(c.gross_cents)}</p>
                {c.withholding_cents > 0 && (
                  <p className="text-[11px] text-muted-foreground">{t("commissions.net", { value: money(c.gross_cents - c.withholding_cents) })}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {c.invoice_file_name && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("commissions.downloadInvoice")}
                    aria-label={t("commissions.downloadInvoice")}
                    onClick={() => download(c, "invoice")}
                  >
                    <FileDown className="h-4 w-4" />
                  </Button>
                )}
                {c.receipt_file_name && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("commissions.downloadReceipt")}
                    aria-label={t("commissions.downloadReceipt")}
                    onClick={() => download(c, "receipt")}
                  >
                    <ReceiptText className="h-4 w-4" />
                  </Button>
                )}
                {can("invoices", "edit") && c.status === "invoice_review" && (
                  <Button size="sm" onClick={() => setDialog({ type: "review", item: c })}>
                    {t("commissions.review")}
                  </Button>
                )}
                {can("payments", "edit") && c.status === "available" && (
                  <Button size="sm" onClick={() => setDialog({ type: "payment", item: c })}>
                    {t("commissions.registerPayment")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CloseDialog
        open={dialog?.type === "close"}
        busy={busy}
        participants={state.participants}
        onClose={() => setDialog(null)}
        onSubmit={(body) =>
          send(`${api}/commissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "commissions.closed")
        }
      />
      <ReviewDialog
        item={dialog?.type === "review" ? dialog.item : null}
        busy={busy}
        onClose={() => setDialog(null)}
        onDownload={(c) => download(c, "invoice")}
        onSubmit={(c, body) =>
          send(
            `${api}/commissions/${c.id}/review`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
            body.approve ? "commissions.invoiceApproved" : "commissions.invoiceRejected",
          )
        }
      />
      <PaymentDialog
        item={dialog?.type === "payment" ? dialog.item : null}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={(c, form) => send(`${api}/commissions/${c.id}/payment`, { method: "POST", body: form }, "commissions.paymentRegistered")}
      />
    </div>
  );
}

function CloseDialog({
  open,
  busy,
  participants,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  participants: Participant[];
  onClose: () => void;
  onSubmit: (body: { affiliate_id: string; period: string; gross_cents: number }) => Promise<boolean>;
}) {
  const t = useTranslations("Operational.affiliates");
  const [affiliate, setAffiliate] = useState<string>("");
  const [period, setPeriod] = useState(currentMonth());
  const [gross, setGross] = useState("");
  const valid = affiliate && /^\d{4}-\d{2}$/.test(period) && Number(gross) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("commissions.closeTitle")}</DialogTitle>
          <DialogDescription>{t("commissions.closeHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="k-aff">{t("commissions.fieldAffiliate")}</Label>
            <Select value={affiliate || null} onValueChange={(v) => v && setAffiliate(v)}>
              <SelectTrigger id="k-aff" className="w-full">
                <SelectValue>{participants.find((p) => p.id === affiliate)?.name ?? t("editor.select")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="k-period">{t("commissions.fieldPeriod")}</Label>
              <Input id="k-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="k-gross">{t("commissions.fieldGross")}</Label>
              <Input id="k-gross" type="number" min="0.01" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={async () => {
              const ok = await onSubmit({ affiliate_id: affiliate, period, gross_cents: Math.round(Number(gross) * 100) });
              if (ok) {
                setAffiliate("");
                setGross("");
              }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  item,
  busy,
  onClose,
  onDownload,
  onSubmit,
}: {
  item: Commission | null;
  busy: boolean;
  onClose: () => void;
  onDownload: (c: Commission) => void;
  onSubmit: (c: Commission, body: { approve: boolean; reason?: string }) => Promise<boolean>;
}) {
  const t = useTranslations("Operational.affiliates");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !busy && (setReason(""), onClose())}>
      <DialogContent className="sm:max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{t("commissions.reviewTitle")}</DialogTitle>
              <DialogDescription>{t("commissions.reviewHint")}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border p-3 text-sm">
              <dt className="text-muted-foreground">{t("commissions.fieldAffiliate")}</dt>
              <dd className="text-foreground">{item.affiliate_name}</dd>
              <dt className="text-muted-foreground">{t("commissions.fieldGross")}</dt>
              <dd className="text-foreground">{money(item.gross_cents)}</dd>
              <dt className="text-muted-foreground">{t("commissions.fieldInvoiceNumber")}</dt>
              <dd className="break-all text-foreground">{item.invoice_number}</dd>
              <dt className="text-muted-foreground">{t("commissions.fieldIssuer")}</dt>
              <dd className="text-foreground">{item.invoice_issuer}</dd>
              <dt className="text-muted-foreground">{t("commissions.fieldRecipient")}</dt>
              <dd className="text-foreground">{item.invoice_recipient}</dd>
              <dt className="text-muted-foreground">{t("commissions.fieldInvoiceValue")}</dt>
              <dd className="text-foreground">{item.invoice_value_cents !== null ? money(item.invoice_value_cents) : "—"}</dd>
            </dl>
            {item.invoice_value_cents !== null && item.invoice_value_cents !== item.gross_cents && (
              <p className="text-xs text-amber-500">{t("commissions.valueMismatch")}</p>
            )}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => onDownload(item)}>
              <Download className="h-3.5 w-3.5" />
              {t("commissions.downloadInvoice")}
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="rv-reason">{t("commissions.fieldReason")}</Label>
              <Input id="rv-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy || reason.trim().length < 3}
                onClick={async () => {
                  if (await onSubmit(item, { approve: false, reason })) setReason("");
                }}
              >
                <X className="h-4 w-4" />
                {t("commissions.reject")}
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (await onSubmit(item, { approve: true })) setReason("");
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("commissions.approve")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: Commission | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (c: Commission, form: FormData) => Promise<boolean>;
}) {
  const t = useTranslations("Operational.affiliates");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !busy && (setReference(""), setFile(null), onClose())}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle>{t("commissions.paymentTitle")}</DialogTitle>
              <DialogDescription>{t("commissions.paymentHint")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-foreground">{item.affiliate_name}</strong>
                <span className="text-right">
                  <span className="block text-[11px] text-muted-foreground">{t("commissions.amountToPay")}</span>
                  <span className="font-semibold text-foreground">{money(item.gross_cents - item.withholding_cents)}</span>
                </span>
              </div>
              <PixLine c={item} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-ref">{t("commissions.fieldReference")}</Label>
              <Input id="p-ref" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-file">{t("commissions.fieldReceipt")}</Label>
              <Input id="p-file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t("cancel")}
              </Button>
              <Button
                disabled={busy || !reference.trim() || !file}
                onClick={async () => {
                  if (!file) return;
                  const form = new FormData();
                  form.set("reference", reference);
                  form.set("file", file);
                  if (await onSubmit(item, form)) {
                    setReference("");
                    setFile(null);
                  }
                }}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("commissions.registerPayment")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PixLine({ c }: { c: Commission }) {
  const t = useTranslations("Operational.affiliates");
  if (!c.pix_key) {
    return (
      <p className={cn("mt-1 text-xs", c.has_pix ? "text-muted-foreground" : "text-amber-500")}>
        {c.has_pix ? t("commissions.pixHidden") : t("commissions.pixMissing")}
      </p>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(c.pix_key ?? "");
      toast.success(t("commissions.pixCopied"));
    } catch {
      toast.error(t("saveError"));
    }
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>
        {t("commissions.pixLabel")}
        {c.pix_key_type ? ` (${t(`members.pix_${c.pix_key_type}`)})` : ""}:
      </span>
      <span className="break-all font-mono text-foreground">{c.pix_key}</span>
      <Button variant="ghost" size="icon-sm" className="h-6 w-6" title={t("commissions.copyPix")} aria-label={t("commissions.copyPix")} onClick={copy}>
        <Copy className="h-3 w-3" />
      </Button>
    </p>
  );
}
