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
import { ContactPicker, type PickedContact } from "./contact-picker";
import { Sparkles, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_TEMPLATES,
  checklistFromText,
  templateBriefingText,
  textToBriefing,
  type TaskTemplate,
} from "@/lib/tasks/templates";

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
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [briefingText, setBriefingText] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

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
    setContact(null);
    setTemplateId(null);
    setEstimatedMinutes(null);
    setBriefingText("");
    setChecklistText("");
    setAiDescription("");
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

  function applyTemplate(tpl: TaskTemplate | null) {
    setTemplateId(tpl?.id ?? null);
    if (!tpl) {
      setEstimatedMinutes(null);
      setBriefingText("");
      setChecklistText("");
      return;
    }
    setPriority(tpl.priority);
    setEstimatedMinutes(tpl.estimatedMinutes);
    setBriefingText(templateBriefingText(tpl));
    setChecklistText(tpl.checklist.join("\n"));
    setTitle((prev) => (prev.trim() ? prev : tpl.titlePrefix));
  }

  async function handleAiFill() {
    if (!aiDescription.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/operational/tasks/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiDescription, template_id: templateId, contact_id: contact?.id ?? null }),
      });
      const data = (await res.json().catch(() => null)) as
        | { draft?: { title: string; briefing: string; checklist: string[] }; error?: string }
        | null;
      if (!res.ok || !data?.draft) {
        toast.error(data?.error === "ai_not_configured" ? t("aiNotConfigured") : t("aiFailed"));
        return;
      }
      const d = data.draft;
      if (d.title) setTitle(d.title);
      if (d.briefing) setBriefingText(d.briefing);
      if (d.checklist.length) setChecklistText(d.checklist.join("\n"));
      toast.success(t("aiFilled"));
    } catch {
      toast.error(t("aiFailed"));
    } finally {
      setAiBusy(false);
    }
  }

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
        contact_id: contact?.id ?? null,
        estimated_minutes: estimatedMinutes,
        briefing: briefingText.trim() ? textToBriefing(briefingText) : null,
        checklist: checklistFromText(checklistText),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("template")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(templateId === tpl.id ? null : tpl)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    templateId === tpl.id
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <Label className="flex items-center gap-1.5 text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("aiLabel")}
            </Label>
            <Textarea
              spellCheck
              lang="pt-BR"
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder={t("aiPlaceholder")}
              className="min-h-16 border-border bg-background text-sm text-foreground"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">{t("aiHint")}</p>
              <Button size="sm" variant="outline" onClick={handleAiFill} disabled={!aiDescription.trim() || aiBusy}>
                {aiBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                {t("aiButton")}
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("taskTitle")}</Label>
            <Input
              autoFocus
              spellCheck
              lang="pt-BR"
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

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("client")}</Label>
            <ContactPicker value={contact} onChange={setContact} />
          </div>

          {(templateId || briefingText || checklistText) && (
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("briefing")}</Label>
                <Textarea
                  spellCheck
                  lang="pt-BR"
                  value={briefingText}
                  onChange={(e) => setBriefingText(e.target.value)}
                  className="min-h-36 border-border bg-muted font-mono text-xs text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("checklist")}</Label>
                <Textarea
                  spellCheck
                  lang="pt-BR"
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  className="min-h-24 border-border bg-muted text-xs text-foreground"
                />
                <p className="text-[11px] text-muted-foreground">{t("checklistHint")}</p>
              </div>
            </div>
          )}

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
