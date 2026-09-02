"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Contact, ContractTemplate, DealContract, ContractSigningMethod } from "@/types";
import { CONTRACT_TEMPLATE_VARIABLES, renderTemplate } from "@/lib/contracts/templating";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContractDocument } from "@/components/contracts/contract-document";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FileSignature,
  Plus,
  Loader2,
  Copy,
  Link2,
  MessageCircle,
  Mail,
  X,
  Clock,
  Eye,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import { useTranslations } from "next-intl";

const STATUS_META: Record<
  DealContract["status"],
  { icon: typeof Clock; className: string }
> = {
  draft: { icon: Clock, className: "text-muted-foreground" },
  sent: { icon: Clock, className: "text-amber-400" },
  viewed: { icon: Eye, className: "text-amber-400" },
  signed: { icon: CheckCircle2, className: "text-emerald-400" },
  declined: { icon: XCircle, className: "text-red-400" },
  expired: { icon: XCircle, className: "text-muted-foreground" },
  cancelled: { icon: Ban, className: "text-muted-foreground" },
};

interface ContractTabProps {
  dealId: string;
  accountId: string | null;
  contact?: Contact;
  canEdit: boolean;
}

interface FormState {
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  nomeRepresentante: string;
  cpfRepresentante: string;
  clientEmail: string;
  templateId: string;
  signingMethod: ContractSigningMethod;
}

function emptyForm(contact?: Contact): FormState {
  return {
    razaoSocial: contact?.company ?? "",
    cnpj: "",
    endereco: "",
    nomeRepresentante: contact?.name ?? "",
    cpfRepresentante: "",
    clientEmail: contact?.email ?? "",
    templateId: "",
    signingMethod: "virtual",
  };
}

export function ContractTab({ dealId, accountId, contact, canEdit }: ContractTabProps) {
  const t = useTranslations("Contracts.tab");
  const supabase = createClient();

  const [contracts, setContracts] = useState<DealContract[]>([]);
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(contact));
  const [submitting, setSubmitting] = useState(false);
  const [resultLink, setResultLink] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data: contractRows }, { data: templateRows }] = await Promise.all([
      supabase
        .from("deal_contracts")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }),
      supabase.from("contract_templates").select("*").eq("is_active", true).order("name"),
    ]);
    setContracts((contractRows as DealContract[] | null) ?? []);
    setTemplates((templateRows as ContractTemplate[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId, dealId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(emptyForm(contact));
    setResultLink(null);
    setDialogOpen(true);
  }

  const selectedTemplate = templates.find((tpl) => tpl.id === form.templateId);
  const preview = selectedTemplate
    ? renderTemplate(selectedTemplate.content, {
        razao_social_cliente: form.razaoSocial || "—",
        cnpj_cliente: form.cnpj || "—",
        endereco_cliente: form.endereco || "—",
        nome_representante_cliente: form.nomeRepresentante || "—",
        cpf_representante_cliente: form.cpfRepresentante || "—",
      })
    : "";

  const canSubmit =
    form.razaoSocial.trim() &&
    form.cnpj.trim() &&
    form.endereco.trim() &&
    form.nomeRepresentante.trim() &&
    form.cpfRepresentante.trim() &&
    form.clientEmail.trim() &&
    form.templateId;

  async function handleGenerate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const createRes = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: dealId,
          template_id: form.templateId,
          razao_social: form.razaoSocial.trim(),
          cnpj: form.cnpj.trim(),
          endereco: form.endereco.trim(),
          nome_representante: form.nomeRepresentante.trim(),
          cpf_representante: form.cpfRepresentante.trim(),
          client_email: form.clientEmail.trim(),
          signing_method: form.signingMethod,
        }),
      });
      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        toast.error(createJson?.error ?? t("toastFailedCreate"));
        return;
      }

      const sendRes = await fetch(`/api/contracts/${createJson.contract.id}/send`, { method: "POST" });
      const sendJson = await sendRes.json().catch(() => null);
      if (!sendRes.ok) {
        toast.error(sendJson?.error ?? t("toastFailedSend"));
        await load();
        return;
      }

      setResultLink(sendJson.link);
      toast.success(t("toastSent"));
      await load();
    } catch {
      toast.error(t("toastFailedCreate"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(contract: DealContract) {
    if (!window.confirm(t("cancelConfirm"))) return;
    setCancellingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        toast.error(json?.error ?? t("toastFailedCancel"));
        return;
      }
      toast.success(t("toastCancelled"));
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  async function handleCopyExistingLink(contract: DealContract) {
    setCopyingId(contract.id);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/regenerate-link`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? t("toastFailedRegenerate"));
        return;
      }
      try {
        await navigator.clipboard.writeText(json.link);
        toast.success(t("toastLinkCopied"));
      } catch {
        toast.success(t("toastLinkRegenerated"));
      }
      await load();
    } finally {
      setCopyingId(null);
    }
  }

  async function copyLink() {
    if (!resultLink) return;
    try {
      await navigator.clipboard.writeText(resultLink);
      toast.success(t("toastLinkCopied"));
    } catch {
      // Clipboard can fail silently (permissions) — the link is still on screen to select manually.
    }
  }

  function sendWhatsapp() {
    if (!resultLink || !contact?.phone) return;
    const message = t("whatsappMessage", { link: resultLink });
    window.open(`https://wa.me/${normalizePhone(contact.phone)}?text=${encodeURIComponent(message)}`, "_blank");
  }

  function sendEmailLink() {
    if (!resultLink) return;
    const subject = encodeURIComponent(t("emailSubject"));
    const body = encodeURIComponent(t("emailBody", { link: resultLink }));
    window.open(`mailto:${form.clientEmail}?subject=${subject}&body=${body}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileSignature className="h-4 w-4 text-primary" />
            {t("title")}
          </h3>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              {t("newContract")}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : contracts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {contracts.map((contract) => {
              const meta = STATUS_META[contract.status];
              const Icon = meta.icon;
              return (
                <li
                  key={contract.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{contract.razao_social}</p>
                    <p className="text-xs text-muted-foreground">
                      {contract.signing_method === "clicksign" ? "Clicksign" : t("methodVirtual")} ·{" "}
                      {new Date(contract.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.className)}>
                      <Icon className="h-3.5 w-3.5" />
                      {t(`status.${contract.status}`)}
                    </span>
                    {canEdit &&
                      contract.signing_method === "virtual" &&
                      ["sent", "viewed", "expired"].includes(contract.status) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={copyingId === contract.id}
                          onClick={() => handleCopyExistingLink(contract)}
                          title={t("copyLinkRowButton")}
                          className="text-muted-foreground hover:text-primary"
                        >
                          {copyingId === contract.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    {canEdit && (contract.status === "draft" || contract.status === "sent" || contract.status === "viewed") && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={cancellingId === contract.id}
                        onClick={() => handleCancel(contract)}
                        title={t("cancelButton")}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        {cancellingId === contract.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newContract")}</DialogTitle>
          </DialogHeader>

          {resultLink ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("linkReadyDesc")}</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2">
                <code className="min-w-0 flex-1 truncate text-xs text-foreground">{resultLink}</code>
                <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0 border-border">
                  <Copy className="h-3.5 w-3.5" />
                  {t("copyLink")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendWhatsapp}
                  disabled={!contact?.phone}
                  className="border-border"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {t("sendWhatsapp")}
                </Button>
                <Button variant="outline" size="sm" onClick={sendEmailLink} className="border-border">
                  <Mail className="h-3.5 w-3.5" />
                  {t("sendEmail")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("fieldRazaoSocial")}</Label>
                  <Input
                    value={form.razaoSocial}
                    onChange={(e) => setForm((f) => ({ ...f, razaoSocial: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("fieldCnpj")}</Label>
                  <Input
                    value={form.cnpj}
                    onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-muted-foreground">{t("fieldEndereco")}</Label>
                  <Input
                    value={form.endereco}
                    onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("fieldNomeRepresentante")}</Label>
                  <Input
                    value={form.nomeRepresentante}
                    onChange={(e) => setForm((f) => ({ ...f, nomeRepresentante: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("fieldCpf")}</Label>
                  <Input
                    value={form.cpfRepresentante}
                    onChange={(e) => setForm((f) => ({ ...f, cpfRepresentante: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-muted-foreground">{t("fieldEmail")}</Label>
                  <Input
                    type="email"
                    value={form.clientEmail}
                    onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))}
                    className="bg-muted text-foreground"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t("templateLabel")}</Label>
                <Select
                  value={form.templateId}
                  onValueChange={(v) => setForm((f) => ({ ...f, templateId: v as string }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("templatePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 && (
                      <SelectItem value="__none" disabled>
                        {t("noTemplates")}
                      </SelectItem>
                    )}
                    {templates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t("methodLabel")}</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, signingMethod: "virtual" }))}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      form.signingMethod === "virtual"
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t("methodVirtual")}
                  </button>
                  <button
                    type="button"
                    title={t("clicksignComingSoon")}
                    onClick={() => setForm((f) => ({ ...f, signingMethod: "clicksign" }))}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      form.signingMethod === "clicksign"
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Clicksign
                    <span className="ml-1 text-[10px] text-muted-foreground">({t("comingSoon")})</span>
                  </button>
                </div>
              </div>

              {selectedTemplate && (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("previewLabel")}</Label>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                    <ContractDocument content={preview} />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="border-border bg-popover/50">
            {resultLink ? (
              <Button onClick={() => setDialogOpen(false)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {t("close")}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="border-border bg-transparent text-muted-foreground hover:bg-muted"
                >
                  {t("cancel")}
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={!canSubmit || submitting}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {submitting ? t("generating") : t("generateLink")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Exposed so a future template-preview surface (e.g. Settings) can reuse
// the exact same variable list without re-importing from lib/contracts.
export { CONTRACT_TEMPLATE_VARIABLES };
