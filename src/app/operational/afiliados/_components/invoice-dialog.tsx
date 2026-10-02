"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** What the invoice dialog needs from a commission (staff and portal both). */
export interface InvoiceTarget {
  id: string;
  affiliate_name: string;
  gross_cents: number;
  period: string;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (cents: number) => brl.format(cents / 100);
export const formatPeriod = (p: string) => p.split("-").reverse().join("/");

export function InvoiceDialog({
  item,
  busy,
  clientName,
  onClose,
  onSubmit,
}: {
  item: InvoiceTarget | null;
  busy: boolean;
  clientName: string;
  onClose: () => void;
  onSubmit: (c: InvoiceTarget, form: FormData) => Promise<boolean>;
}) {
  const t = useTranslations("Operational.affiliates");
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {item && <InvoiceForm key={item.id} item={item} busy={busy} clientName={clientName} onClose={onClose} onSubmit={onSubmit} t={t} />}
      </DialogContent>
    </Dialog>
  );
}

function InvoiceForm({
  item,
  busy,
  clientName,
  onClose,
  onSubmit,
  t,
}: {
  item: InvoiceTarget;
  busy: boolean;
  clientName: string;
  onClose: () => void;
  onSubmit: (c: InvoiceTarget, form: FormData) => Promise<boolean>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState(item.affiliate_name);
  const [recipient, setRecipient] = useState(clientName);
  const [value, setValue] = useState((item.gross_cents / 100).toFixed(2));
  const [file, setFile] = useState<File | null>(null);
  const valid = number.trim() && issuer.trim() && recipient.trim() && Number(value) > 0 && file;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("commissions.invoiceTitle")}</DialogTitle>
        <DialogDescription>
          {t("commissions.invoiceHint", { name: item.affiliate_name, value: money(item.gross_cents), period: formatPeriod(item.period) })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="i-number">{t("commissions.fieldInvoiceNumber")}</Label>
          <Input id="i-number" value={number} maxLength={200} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-issuer">{t("commissions.fieldIssuer")}</Label>
          <Input id="i-issuer" value={issuer} maxLength={200} onChange={(e) => setIssuer(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-recipient">{t("commissions.fieldRecipient")}</Label>
          <Input id="i-recipient" value={recipient} maxLength={200} onChange={(e) => setRecipient(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-value">{t("commissions.fieldInvoiceValue")}</Label>
          <Input id="i-value" type="number" min="0.01" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-file">{t("commissions.fieldFile")}</Label>
          <Input id="i-file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button
          disabled={busy || !valid}
          onClick={() => {
            if (!file) return;
            const form = new FormData();
            form.set("number", number);
            form.set("issuer", issuer);
            form.set("recipient", recipient);
            form.set("value_cents", String(Math.round(Number(value) * 100)));
            form.set("file", file);
            void onSubmit(item, form);
          }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("commissions.sendForReview")}
        </Button>
      </DialogFooter>
    </>
  );
}

