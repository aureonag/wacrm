"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { HighlightColorPicker } from "./highlight-color-picker";
import { DEFAULT_HIGHLIGHT, normalizeHex, readableTextColor } from "@/lib/tasks/color";
import type { TaskLabel, TaskTag } from "@/types";

// Labels of a task, Trello style: each label is created once (name + color) in
// a library shared by the whole account, then ticked on/off per task. Editing a
// label changes it everywhere it is used.

const NEW_LABEL_COLOR = "#22C55E";

/** A label as a solid colored pill. An empty name still renders as a colored bar. */
export function LabelPill({
  name,
  color,
  className = "",
}: {
  name: string;
  color: string;
  className?: string;
}) {
  const safe = normalizeHex(color) ?? NEW_LABEL_COLOR;
  return (
    <span
      className={`inline-flex min-h-5 min-w-9 items-center justify-center rounded-md px-2 text-[10.5px] font-semibold leading-5 ${className}`}
      style={{ backgroundColor: safe, color: readableTextColor(safe) }}
    >
      {name}
    </span>
  );
}

interface TaskLabelsFieldProps {
  taskId: string;
  accountId: string | null;
  tags: TaskTag[];
  canEdit: boolean;
  /** Called after any change so the task (and its tags) can be reloaded. */
  onChanged: () => void | Promise<void>;
}

type View = { kind: "list" } | { kind: "edit"; label: TaskLabel | null };

export function TaskLabelsField({ taskId, accountId, tags, canEdit, onChanged }: TaskLabelsFieldProps) {
  const t = useTranslations("Operational.labels");
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [query, setQuery] = useState("");

  async function loadLabels() {
    const { data } = await supabase.from("task_labels").select("*").order("created_at", { ascending: true });
    setLabels((data ?? []) as TaskLabel[]);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setView({ kind: "list" });
      setQuery("");
      void loadLabels();
    }
  }

  const tagByLabel = useMemo(() => {
    const m = new Map<string, TaskTag>();
    for (const tag of tags) if (tag.label_id) m.set(tag.label_id, tag);
    return m;
  }, [tags]);

  async function attach(label: TaskLabel) {
    if (!accountId) return;
    const { error } = await supabase
      .from("task_tags")
      .insert({ task_id: taskId, account_id: accountId, label_id: label.id, label: label.name, color: label.color });
    if (error) {
      toast.error(t("errorSave"));
      return;
    }
    await onChanged();
  }

  async function toggle(label: TaskLabel) {
    const current = tagByLabel.get(label.id);
    if (current) {
      const { error } = await supabase.from("task_tags").delete().eq("id", current.id);
      if (error) {
        toast.error(t("errorSave"));
        return;
      }
      await onChanged();
    } else {
      await attach(label);
    }
  }

  async function saveLabel(existing: TaskLabel | null, name: string, color: string) {
    if (existing) {
      const { error } = await supabase.from("task_labels").update({ name, color }).eq("id", existing.id);
      if (error) {
        toast.error(t("errorSave"));
        return;
      }
      await loadLabels();
      await onChanged();
    } else {
      if (!accountId) return;
      const { data, error } = await supabase
        .from("task_labels")
        .insert({ account_id: accountId, name, color })
        .select("*")
        .single();
      if (error || !data) {
        toast.error(t("errorSave"));
        return;
      }
      await loadLabels();
      // Created from inside a task: it goes on this task right away.
      await attach(data as TaskLabel);
    }
    setView({ kind: "list" });
  }

  async function deleteLabel(label: TaskLabel) {
    const { error } = await supabase.from("task_labels").delete().eq("id", label.id);
    if (error) {
      toast.error(t("errorSave"));
      return;
    }
    await loadLabels();
    await onChanged();
    setView({ kind: "list" });
  }

  const shown = labels.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <LabelPill key={tag.id} name={tag.label} color={tag.color} />
      ))}
      {canEdit && (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            aria-label={t("add")}
            title={t("add")}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground data-popup-open:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-80 gap-3 p-3">
            {view.kind === "list" ? (
              <ListView
                labels={shown}
                total={labels.length}
                query={query}
                onQuery={setQuery}
                checked={(l) => tagByLabel.has(l.id)}
                onToggle={toggle}
                onEdit={(label) => setView({ kind: "edit", label })}
                onCreate={() => setView({ kind: "edit", label: null })}
                onClose={() => setOpen(false)}
              />
            ) : (
              <EditView
                key={view.label?.id ?? "new"}
                label={view.label}
                onBack={() => setView({ kind: "list" })}
                onClose={() => setOpen(false)}
                onSave={(name, color) => saveLabel(view.label, name, color)}
                onDelete={view.label ? () => deleteLabel(view.label as TaskLabel) : undefined}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function PanelHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Operational.labels");
  return (
    <div className="relative flex items-center justify-center">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="absolute left-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="absolute right-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function ListView({
  labels,
  total,
  query,
  onQuery,
  checked,
  onToggle,
  onEdit,
  onCreate,
  onClose,
}: {
  labels: TaskLabel[];
  total: number;
  query: string;
  onQuery: (q: string) => void;
  checked: (label: TaskLabel) => boolean;
  onToggle: (label: TaskLabel) => void;
  onEdit: (label: TaskLabel) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Operational.labels");
  return (
    <>
      <PanelHeader title={t("title")} onClose={onClose} />
      <input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t("search")}
        className="h-8 w-full rounded-md border border-border bg-muted px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {labels.length === 0 && (
          <p className="py-3 text-center text-xs text-muted-foreground">{total === 0 ? t("empty") : t("noMatch")}</p>
        )}
        {labels.map((label) => (
          <div key={label.id} className="flex items-center gap-2">
            <Checkbox checked={checked(label)} onCheckedChange={() => onToggle(label)} aria-label={label.name} />
            <button
              type="button"
              onClick={() => onToggle(label)}
              className="min-w-0 flex-1 text-left"
              title={label.name}
            >
              <LabelPill name={label.name} color={label.color} className="!min-h-8 w-full justify-start !px-3 text-xs" />
            </button>
            <button
              type="button"
              onClick={() => onEdit(label)}
              aria-label={t("editAria", { name: label.name })}
              title={t("editTitle")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="rounded-md border border-border bg-muted px-2 py-2 text-xs font-medium text-foreground hover:bg-muted/70"
      >
        {t("create")}
      </button>
    </>
  );
}

function EditView({
  label,
  onBack,
  onClose,
  onSave,
  onDelete,
}: {
  label: TaskLabel | null;
  onBack: () => void;
  onClose: () => void;
  onSave: (name: string, color: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const t = useTranslations("Operational.labels");
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState(normalizeHex(label?.color) ?? NEW_LABEL_COLOR);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    setSaving(true);
    await onSave(name.trim(), color);
    setSaving(false);
  }

  return (
    <>
      <PanelHeader title={label ? t("editTitle") : t("newTitle")} onBack={onBack} onClose={onClose} />
      <div className="flex items-center justify-center rounded-md bg-muted/60 px-3 py-4">
        <LabelPill name={name.trim()} color={color} className="!min-h-8 w-full justify-start !px-3 text-xs" />
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {t("name")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          maxLength={60}
          className="h-8 w-full rounded-md border border-border bg-muted px-2.5 text-xs font-normal text-foreground outline-none focus:border-primary"
        />
      </label>

      <HighlightColorPicker color={color || DEFAULT_HIGHLIGHT} onPick={setColor} onPreview={setColor} hideApply />

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
          <p className="text-xs text-foreground">{t("deleteConfirm")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void onDelete?.()}
              className="flex-1 rounded-md bg-destructive px-2 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
            >
              {t("deleteYes")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {label ? t("save") : t("createConfirm")}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-destructive px-4 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
            >
              {t("delete")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
