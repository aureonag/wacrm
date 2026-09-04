"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { BoardStage, Profile, Sector, TaskPriority } from "@/types";
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
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  stages: BoardStage[];
  defaultStageId?: string;
  onCreated: () => void;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

export function CreateTaskDialog({
  open,
  onOpenChange,
  boardId,
  stages,
  defaultStageId,
  onCreated,
}: CreateTaskDialogProps) {
  const t = useTranslations("Operational.createTaskDialog");
  const tPriority = useTranslations("Operational.tasks.card.priority");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState("");
  const [stageId, setStageId] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [isUrgent, setIsUrgent] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setStageId(defaultStageId || stages[0]?.id || "");
    setAssigneeId(null);
    setSectorId(null);
    setPriority("medium");
    setIsUrgent(false);
    setDueDate("");
  }, [open, defaultStageId, stages]);
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

  async function handleCreate() {
    if (!title.trim()) {
      toast.error(t("toastTitleRequired"));
      return;
    }
    setSaving(true);
    const res = await fetch("/api/operational/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board_id: boardId,
        stage_id: stageId,
        title: title.trim(),
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
    onCreated();
    toast.success(t("toastCreated"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("taskTitle")}</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("taskTitlePlaceholder")}
              className="border-border bg-muted text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
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
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
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
                    <SelectItem key={p} value={p}>
                      {tPriority(p)}
                    </SelectItem>
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
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
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
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("dueDate")}</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox checked={isUrgent} onCheckedChange={(v) => setIsUrgent(v === true)} id="task-urgent" />
              <Label htmlFor="task-urgent" className="text-muted-foreground">{t("urgent")}</Label>
            </div>
          </div>
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
            {t("cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={saving || !title.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? t("saving") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
