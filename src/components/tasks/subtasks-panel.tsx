"use client";

import { useState } from "react";
import type { Task } from "@/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface SubtasksPanelProps {
  parentTask: Task;
  subtasks: Task[];
  /** Other tasks on the same board, not already a subtask of anything —
   *  candidates for "converter em subtarefa". */
  convertCandidates: Task[];
  canEdit: boolean;
  onOpenSubtask: (taskId: string) => void;
  onChanged: () => void;
}

export function SubtasksPanel({
  parentTask,
  subtasks,
  convertCandidates,
  canEdit,
  onOpenSubtask,
  onChanged,
}: SubtasksPanelProps) {
  const t = useTranslations("Operational.subtasks");
  const [newTitle, setNewTitle] = useState("");
  const [convertId, setConvertId] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    const res = await fetch("/api/operational/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board_id: parentTask.board_id,
        stage_id: parentTask.stage_id,
        title,
        parent_task_id: parentTask.id,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setNewTitle("");
    onChanged();
  }

  async function handleConvert() {
    if (!convertId) return;
    const res = await fetch(`/api/operational/tasks/${convertId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_task_id: parentTask.id }),
    });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setConvertId("");
    onChanged();
  }

  return (
    <div>
      <div className="space-y-1.5">
        {subtasks.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => onOpenSubtask(sub.id)}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-muted/50"
          >
            <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className={`flex-1 truncate text-sm ${sub.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {sub.title}
            </span>
          </button>
        ))}
        {subtasks.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      </div>

      {canEdit && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t("placeholder")}
              className="h-8 border-border bg-muted text-sm text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <Button size="sm" variant="outline" onClick={handleCreate} disabled={saving || !newTitle.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {convertCandidates.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Select value={convertId || "__none"} onValueChange={(v) => setConvertId(v === "__none" ? "" : (v as string))}>
                <SelectTrigger className="h-8 flex-1 bg-muted border-border text-foreground">
                  <SelectValue>
                    {convertCandidates.find((c) => c.id === convertId)?.title ?? t("convertPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("convertPlaceholder")}</SelectItem>
                  {convertCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={handleConvert} disabled={!convertId}>
                {t("convert")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
