"use client";

// Operacional → Reportei → Templates: the models that decide what a report
// shows. Used when generating a report by hand and by the automations.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useHasPermission } from "@/hooks/use-permissions";
import type { Template } from "@/lib/reportei/template";
import { TemplateDialog } from "../_components/template-dialog";
import { useTemplates } from "../_components/use-templates";

export default function ReporteiTemplatesPage() {
  const t = useTranslations("Operational.reportei.templatesPage");
  const tm = useTranslations("Operational.reportei.reports");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const { templates, failed, reload } = useTemplates();
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  async function remove(template: Template) {
    if (!window.confirm(t("deleteConfirm", { name: template.name }))) return;
    const res = await fetch(`/api/operational/reportei/templates/${template.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error(t("deleteError"));
    toast.success(t("deleted"));
    void reload();
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("new")}
          </Button>
        )}
      </div>

      <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t("defaultNote")}</p>

      {templates === null && <Skeleton className="h-40" />}
      {failed && <p className="text-sm text-red-500">{t("error")}</p>}
      {templates !== null && templates.length === 0 && !failed && <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} className="min-h-40" />}
      {templates !== null && templates.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {templates.map((tpl) => (
            <li key={tpl.id} className="flex items-center gap-3 px-4 py-3">
              <LayoutTemplate className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{tpl.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {tpl.metrics.map((m) => tm(`metric_${m}`)).join(", ")}
                  {` · ${tpl.chart ? t("withChart") : t("noChart")} · ${tpl.compare ? t("withCompare") : t("noCompare")}`}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={t("edit")} title={t("edit")} onClick={() => setEditing(tpl)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("delete")} title={t("delete")} onClick={() => remove(tpl)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
