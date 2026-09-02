"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { ContractTemplate } from "@/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SettingsChip } from "./settings-chip";
import {
  Shield,
  FileSignature,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Eye,
  Building2,
  IdCard,
  MapPin,
  User,
  Mail,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ContractDocument } from "@/components/contracts/contract-document";
import { renderTemplate } from "@/lib/contracts/templating";
import { AUREON_PARTY } from "@/lib/contracts/aureon-party";

/** Mirrors the public signing page's party card exactly — see src/app/contracts/[token]/page.tsx. */
function PartyCard({ label, rows }: { label: string; rows: { icon: typeof Building2; text: string }[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</p>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-neutral-900">
            <row.icon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
            <span className="break-words">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings → "Contract templates" card (admin-only, RLS-enforced on
 * `contract_templates`). A template is plain text — the 5 legal
 * `{{variable}}` placeholders (see CONTRACT_TEMPLATE_VARIABLES) are a
 * fixed, always-available convention every template is expected to use,
 * so there's no in-editor reference/picker for them. Selected from the
 * deal-page "Contrato" tab when creating a new contract.
 */
export function ContractTemplatesPanel() {
  const t = useTranslations("Contracts.templates");
  const tPublic = useTranslations("Contracts.public");
  const supabase = createClient();
  const { user, accountId, canEditSettings } = useAuth();

  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ContractTemplate | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ContractTemplate | null>(null);

  const previewContent = previewTemplate
    ? renderTemplate(previewTemplate.content, {
        razao_social_cliente: "—",
        cnpj_cliente: "—",
        endereco_cliente: "—",
        nome_representante_cliente: "—",
        cpf_representante_cliente: "—",
      })
    : "";

  const fetchTemplates = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("contract_templates")
      .select("*")
      .order("name");
    setTemplates((data as ContractTemplate[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchTemplates();
    }
  }, [accountId, fetchTemplates]);

  function openCreate() {
    setEditing(null);
    setName("");
    setContent("");
    setDialogOpen(true);
  }

  function openEdit(template: ContractTemplate) {
    setEditing(template);
    setName(template.name);
    setContent(template.content);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || !trimmedContent) return;
    if (!accountId || !user) {
      toast.error(t("toastNoAccount"));
      return;
    }
    setSaving(true);
    const { error } = editing
      ? await supabase
          .from("contract_templates")
          .update({ name: trimmedName, content: trimmedContent })
          .eq("id", editing.id)
      : await supabase.from("contract_templates").insert({
          account_id: accountId,
          created_by: user.id,
          name: trimmedName,
          content: trimmedContent,
        });
    setSaving(false);
    if (error) {
      toast.error(editing ? t("toastUpdateFailed") : t("toastCreateFailed"));
      return;
    }
    toast.success(editing ? t("toastUpdated") : t("toastCreated"));
    setDialogOpen(false);
    await fetchTemplates();
  }

  async function handleToggleActive(template: ContractTemplate, isActive: boolean) {
    setBusyId(template.id);
    const { error } = await supabase
      .from("contract_templates")
      .update({ is_active: isActive })
      .eq("id", template.id);
    setBusyId(null);
    if (error) {
      toast.error(t("toastUpdateFailed"));
      return;
    }
    setTemplates((prev) =>
      prev.map((tpl) => (tpl.id === template.id ? { ...tpl, is_active: isActive } : tpl)),
    );
  }

  async function handleDelete(template: ContractTemplate) {
    if (!window.confirm(t("deleteConfirm", { name: template.name }))) return;
    setBusyId(template.id);
    const { error } = await supabase.from("contract_templates").delete().eq("id", template.id);
    setBusyId(null);
    if (error) {
      toast.error(t("toastDeleteFailed"));
      return;
    }
    toast.success(t("toastDeleted", { name: template.name }));
    await fetchTemplates();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <FileSignature className="size-4 text-primary" />
          {t("title")}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t("adminRole")}
          </SettingsChip>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEditSettings ? (
          <div className="flex justify-end">
            <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="size-4" />
              {t("newTemplate")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("askAdminHint")}</p>
        )}

        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("loading")}
            </div>
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {templates.map((template) => (
                <li key={template.id} className="flex items-center gap-3 px-3 py-2.5">
                  {canEditSettings ? (
                    <button
                      type="button"
                      onClick={() => openEdit(template)}
                      className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-primary"
                    >
                      {template.name}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{template.name}</span>
                  )}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      checked={template.is_active}
                      onCheckedChange={(checked) => handleToggleActive(template, checked === true)}
                      disabled={!canEditSettings || busyId === template.id}
                      aria-label={t("activeAria", { name: template.name })}
                    />
                    <span className="w-16 text-xs text-muted-foreground">
                      {template.is_active ? t("active") : t("inactive")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPreviewTemplate(template)}
                    title={t("previewTitle")}
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    <Eye className="size-4" />
                  </Button>
                  {canEditSettings && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(template)}
                      title={t("editTitle")}
                      className="shrink-0 text-muted-foreground hover:text-primary"
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                  {canEditSettings && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busyId === template.id}
                      onClick={() => handleDelete(template)}
                      title={t("deleteTitle")}
                      className="shrink-0 text-muted-foreground hover:text-red-400"
                    >
                      {busyId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? t("editTitle") : t("newTemplate")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("nameLabel")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="bg-muted text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t("contentLabel")}</Label>
              {/* The shared Textarea defaults to `field-sizing: content`, which
                  grows the box to fit ALL pasted text instead of scrolling —
                  pasting a full contract would otherwise blow the dialog past
                  the viewport. `field-sizing-fixed` + a capped height keeps the
                  box a fixed size with the text scrolling inside it (same fix
                  as the prospecting paste box). Clipping the scrollbar at this
                  wrapper keeps the rounded corners looking right. */}
              <div className="overflow-hidden rounded-lg border border-input">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("contentPlaceholder")}
                  rows={14}
                  className="field-sizing-fixed h-64 resize-none overflow-y-auto rounded-none border-0 bg-muted font-mono text-sm text-foreground"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || !content.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewTemplate !== null} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("previewSubtitle")}</p>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PartyCard
                label={tPublic("labelContratada")}
                rows={[
                  { icon: Building2, text: AUREON_PARTY.name },
                  { icon: IdCard, text: AUREON_PARTY.cnpj },
                  { icon: User, text: AUREON_PARTY.representative },
                  { icon: Mail, text: AUREON_PARTY.email },
                ]}
              />
              <PartyCard
                label={tPublic("labelContratante")}
                rows={[
                  { icon: Building2, text: "—" },
                  { icon: IdCard, text: "—" },
                  { icon: MapPin, text: "—" },
                  { icon: User, text: "—" },
                  { icon: Mail, text: "—" },
                ]}
              />
            </div>
            <ContractDocument content={previewContent} hideParties theme="paper" />
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setPreviewTemplate(null)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
