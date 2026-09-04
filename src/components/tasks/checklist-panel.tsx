"use client";

import { useState } from "react";
import type { TaskChecklistItem } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface ChecklistPanelProps {
  taskId: string;
  items: TaskChecklistItem[];
  canEdit: boolean;
  onChanged: () => void;
}

export function ChecklistPanel({ taskId, items, canEdit, onChanged }: ChecklistPanelProps) {
  const t = useTranslations("Operational.checklist");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const done = items.filter((i) => i.done).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${taskId}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setNewLabel("");
    onChanged();
  }

  async function handleToggle(item: TaskChecklistItem) {
    const res = await fetch(`/api/operational/tasks/${taskId}/checklist/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !item.done }),
    });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onChanged();
  }

  async function handleDelete(itemId: string) {
    const res = await fetch(`/api/operational/tasks/${taskId}/checklist/${itemId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onChanged();
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("progress", { done, total: items.length })}</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
            <Checkbox
              checked={item.done}
              onCheckedChange={() => handleToggle(item)}
              disabled={!canEdit}
            />
            <span className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {item.label}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="shrink-0 text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
                aria-label={t("delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      </div>

      {canEdit && (
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t("placeholder")}
            className="h-8 border-border bg-muted text-sm text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={saving || !newLabel.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
