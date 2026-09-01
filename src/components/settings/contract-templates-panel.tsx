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
import { Shield, FileSignature, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

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
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("contentPlaceholder")}
                rows={14}
                className="bg-muted font-mono text-sm text-foreground"
              />
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
    </Card>
  );
}
