"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { DealContract } from "@/types";
import { extractScopeSections } from "@/lib/contracts/scope";
import { terminationEmailSubject, terminationEmailText } from "@/lib/contracts/email-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface TerminateContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: DealContract | null;
  onTerminated: () => void;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TerminateContractDialog({ open, onOpenChange, contract, onTerminated }: TerminateContractDialogProps) {
  const t = useTranslations("Contracts.terminate");
  const [step, setStep] = useState<1 | 2>(1);
  const [effectiveDate, setEffectiveDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setEffectiveDate(todayLocal());
    setNote("");
    setConfirmText("");
  }, [open]);

  const preview = useMemo(() => {
    if (!contract) return null;
    const serviceLines = (
      extractScopeSections(contract.rendered_content ?? null).find((s) => s.key === "service")?.lines ?? []
    ).map((l) => l.replace(/^[-*•]\s+/, ""));
    const args = {
      razaoSocial: contract.razao_social,
      cnpj: contract.cnpj,
      representante: contract.nome_representante,
      signedAt: contract.signed_at ?? null,
      serviceLines,
      effectiveDate,
      note: note.trim() || null,
      contractRef: contract.id.slice(0, 8),
    };
    return { subject: terminationEmailSubject(args.razaoSocial), text: terminationEmailText(args) };
  }, [contract, effectiveDate, note]);

  const minDate = contract?.signed_at ? contract.signed_at.slice(0, 10) : undefined;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && (!minDate || effectiveDate >= minDate);
  const confirmed = confirmText.trim().toLowerCase() === "sim";

  async function handleSubmit() {
    if (!contract || !dateOk || !confirmed || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/terminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveDate, note, confirm: confirmText }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; emailSent?: boolean } | null;
      if (!res.ok) {
        toast.error(data?.error ?? t("toastError"));
        return;
      }
      if (data?.emailSent) toast.success(t("toastDone"));
      else toast.warning(t("toastDoneNoEmail"));
      onOpenChange(false);
      onTerminated();
    } catch {
      toast.error(t("toastError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t("stepOf", { n: step })} · {step === 1 ? t("stepReview") : t("stepConfirm")}
          </p>
        </DialogHeader>

        {contract && step === 1 && (
          <div className="max-h-[62vh] space-y-4 overflow-y-auto py-2 pr-1">
            <p className="text-sm text-muted-foreground">
              {t("intro", { name: contract.razao_social })}
            </p>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">
                {t("effectiveLabel")} <span className="text-red-400">*</span>
              </Label>
              <Input
                type="date"
                min={minDate}
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full border-border bg-muted text-foreground sm:w-56"
              />
              <p className="text-xs text-muted-foreground">{t("effectiveHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("noteLabel")}</Label>
              <Textarea
                spellCheck
                lang="pt-BR"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("notePlaceholder")}
                className="min-h-16 border-border bg-muted text-sm text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("previewTitle")}</Label>
              <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs">
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground">{t("previewTo")}</span> {contract.client_email}
                </p>
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground">{t("previewCc")}</span> {t("previewCcWho")}
                </p>
                <p className="mb-2 text-muted-foreground">
                  <span className="font-semibold text-foreground">{t("previewSubject")}</span> {preview?.subject}
                </p>
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-border pt-2 font-sans text-muted-foreground">
                  {preview?.text}
                </pre>
              </div>
            </div>
          </div>
        )}

        {contract && step === 2 && (
          <div className="space-y-4 py-2">
            <div className="flex gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">{t("warningTitle")}</p>
                <p className="mt-1 text-red-200/90">
                  {t("warningBody", { email: contract.client_email })}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("confirmLabel")}</Label>
              <Input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t("confirmPlaceholder")}
                autoComplete="off"
                className="w-full border-border bg-muted text-foreground sm:w-40"
              />
            </div>
          </div>
        )}

        <DialogFooter className="bg-popover/50 border-border sm:items-center">
          {step === 1 && !dateOk && <p className="mr-auto text-xs text-muted-foreground">{t("dateHint")}</p>}
          {step === 2 ? (
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              disabled={submitting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              {t("back")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("dismiss")}
            </Button>
          )}
          {step === 1 ? (
            <Button
              onClick={() => setStep(2)}
              disabled={!dateOk}
              className="bg-red-600 text-white hover:bg-red-600/90"
            >
              {t("next")}
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!confirmed || submitting}
              className="bg-red-600 text-white hover:bg-red-600/90 disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
