"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { BoardStage, Profile, Sector, Task, TaskPriority } from "@/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface EditTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  stages: BoardStage[];
  onSaved: () => void;
  onDeleted: () => void;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

export function EditTaskDialog({ open, onOpenChange, task, stages, onSaved, onDeleted }: EditTaskDialogProps) {
  const t = useTranslations("Operational.createTaskDialog");
  const tPriority = useTranslations("Operational.tasks.card.priority");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState(task.title);
  const [stageId, setStageId] = useState(task.stage_id);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assignee_id ?? null);
  const [sectorId, setSectorId] = useState<string | null>(task.sector_id ?? null);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [isUrgent, setIsUrgent] = useState(task.is_urgent);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setStageId(task.stage_id);
    setAssigneeId(task.assignee_id ?? null);
    setSectorId(task.sector_id ?? null);
    setPriority(task.priority);
    setIsUrgent(task.is_urgent);
    setDueDate(task.due_date ?? "");
    setShowDeleteConfirm(false);
  }, [open, task]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const [{ data: profileRows }, { data: sectorRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
        supabase.from("sectors").select("*").eq("account_id", accountId).order("name"),
      ]);
      if (!cancelled) {
        setProfiles((profileRows ?? []) as Profile[]);
        setSectors((sectorRows ?? []) as Sector[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error(t("toastTitleRequired"));
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/operational/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        stage_id: stageId,
        assignee_id: assigneeId,
        sector_id: sectorId,
        priority,
        is_urgent: isUrgent,
        due_date: dueDate || null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }

    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/operational/tasks/${task.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onOpenChange(false);
    onDeleted();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("editTitle")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <p className="text-sm text-red-400">{t("deleteConfirm")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
                {t("cancel")}
              </Button>
              <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 text-white hover:bg-red-700">
                {deleting ? t("deleting") : t("deleteBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("taskTitle")}</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="border-border bg-muted text-foreground" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("stage")}</Label>
                  <Select value={stageId} onValueChange={(v) => setStageId(v as string)}>
                    <SelectTrigger className="w-full bg-muted border-border text-foreground">
                      <SelectValue>{stages.find((s) => s.id === stageId)?.name ?? ""}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("priority")}</Label>
                  <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                    <SelectTrigger className="w-full bg-muted border-border text-foreground">
                      <SelectValue>{tPriority(priority)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{tPriority(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("assignee")}</Label>
                  <Select value={assigneeId ?? "__none"} onValueChange={(v) => setAssigneeId(v === "__none" ? null : (v as string))}>
                    <SelectTrigger className="w-full bg-muted border-border text-foreground">
                      <SelectValue>{profiles.find((p) => p.id === assigneeId)?.full_name ?? t("none")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("none")}</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("sector")}</Label>
                  <Select value={sectorId ?? "__none"} onValueChange={(v) => setSectorId(v === "__none" ? null : (v as string))}>
                    <SelectTrigger className="w-full bg-muted border-border text-foreground">
                      <SelectValue>{sectors.find((s) => s.id === sectorId)?.name ?? t("none")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("none")}</SelectItem>
                      {sectors.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("dueDate")}</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border-border bg-muted text-foreground" />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Checkbox checked={isUrgent} onCheckedChange={(v) => setIsUrgent(v === true)} id="task-urgent-edit" />
                  <Label htmlFor="task-urgent-edit" className="text-muted-foreground">{t("urgent")}</Label>
                </div>
              </div>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto text-red-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("deleteBtn")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
                {t("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || !title.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
