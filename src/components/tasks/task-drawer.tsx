"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useHasPermission } from "@/hooks/use-permissions";
import {
  loadAccountProfiles,
  loadBoards,
  loadBoardStages,
  loadSubtasks,
  loadTaskActivity,
  loadTaskApprovals,
  loadTaskChecklist,
  loadTaskComments,
  loadTaskRecurrenceRule,
  loadTaskTimesheet,
} from "@/lib/tasks/queries";
import { DEAL_TAG_COLORS } from "@/lib/deals/tag-colors";
import type {
  Board,
  BoardStage,
  Profile,
  Sector,
  Task,
  TaskActivity,
  TaskApproval,
  TaskChecklistItem,
  TaskComment,
  TaskPriority,
  TaskRecurrenceRule,
  TaskRecurrenceRuleType,
  TaskTag,
  TimesheetEntry,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BriefingEditor } from "./briefing-editor";
import { CommentThread } from "./comment-thread";
import { ChecklistPanel } from "./checklist-panel";
import { ApprovalsPanel } from "./approvals-panel";
import { SubtasksPanel } from "./subtasks-panel";
import { HistoryPanel } from "./history-panel";
import { TimesheetPanel } from "./timesheet-panel";
import {
  MoreVertical,
  Flag,
  Trash2,
  Copy,
  ArrowUpToLine,
  FolderInput,
  CornerDownRight,
  Users2,
  X,
  Clock,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { JSONContent } from "@tiptap/react";

interface TaskDrawerProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any change that should refresh the kanban board behind
   *  the drawer (title/stage/assignee/priority/urgency edits, delete). */
  onChanged: () => void;
  /** Open a different task in this same drawer (subtask row click, or
   *  after "converter em subtarefa" navigates back to the parent). */
  onNavigate: (taskId: string) => void;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

export function TaskDrawer({ taskId, open, onOpenChange, onChanged, onNavigate }: TaskDrawerProps) {
  const t = useTranslations("Operational.taskDrawer");
  const tPriority = useTranslations("Operational.tasks.card.priority");
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEdit = useHasPermission("operational", "tasks", "edit_tasks");
  const canComment = useHasPermission("operational", "tasks", "comment");
  const canDelete = useHasPermission("operational", "tasks", "delete_tasks");
  const canCreateTasks = useHasPermission("operational", "tasks", "create_tasks");
  const canTrackTime = useHasPermission("operational", "timesheet", "track");
  const canLogManualTime = useHasPermission("operational", "timesheet", "log_manual");
  const canEditTimesheet = useHasPermission("operational", "timesheet", "edit_entries");

  const [task, setTask] = useState<Task | null>(null);
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [boardsList, setBoardsList] = useState<Board[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [approvals, setApprovals] = useState<TaskApproval[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [convertCandidates, setConvertCandidates] = useState<Task[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([]);
  const [recurrenceRule, setRecurrenceRule] = useState<TaskRecurrenceRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [activeTab, setActiveTab] = useState("briefing");
  const [showMoveBoard, setShowMoveBoard] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<"__none" | TaskRecurrenceRuleType>("__none");
  const [recurrenceWeekday, setRecurrenceWeekday] = useState("1");
  const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState("1");
  const [moveTargetBoard, setMoveTargetBoard] = useState("");
  const [moveTargetStage, setMoveTargetStage] = useState("");
  const [moveTargetStages, setMoveTargetStages] = useState<BoardStage[]>([]);

  const reloadAll = useCallback(async () => {
    if (!taskId) return;
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("*, assignee:profiles!tasks_assignee_id_fkey(*), contact:contacts(*)")
      .eq("id", taskId)
      .maybeSingle();
    if (!taskRow) {
      setTask(null);
      setLoading(false);
      return;
    }
    const { data: tagRows } = await supabase.from("task_tags").select("*").eq("task_id", taskId);
    const loadedTask = { ...(taskRow as Task), tags: (tagRows ?? []) as TaskTag[] };

    const [stageRows, comms, check, appr, subs, act, ts, recurrence] = await Promise.all([
      loadBoardStages(supabase, loadedTask.board_id),
      loadTaskComments(supabase, taskId),
      loadTaskChecklist(supabase, taskId),
      loadTaskApprovals(supabase, taskId),
      loadSubtasks(supabase, taskId),
      loadTaskActivity(supabase, taskId),
      loadTaskTimesheet(supabase, taskId),
      loadTaskRecurrenceRule(supabase, taskId),
    ]);

    let candidates: Task[] = [];
    if (!loadedTask.parent_task_id) {
      const { data: siblingRows } = await supabase
        .from("tasks")
        .select("id, title")
        .eq("board_id", loadedTask.board_id)
        .is("parent_task_id", null)
        .neq("id", taskId);
      candidates = (siblingRows ?? []) as Task[];
    }

    setTask(loadedTask);
    setTitle(loadedTask.title);
    setStages(stageRows);
    setComments(comms);
    setChecklist(check);
    setApprovals(appr);
    setSubtasks(subs);
    setConvertCandidates(candidates);
    setActivity(act);
    setTimesheet(ts);
    setRecurrenceRule(recurrence);
    setLoading(false);
  }, [supabase, taskId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !taskId) return;
    setLoading(true);
    setActiveTab("briefing");
    let cancelled = false;
    (async () => {
      await reloadAll();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, taskId, reloadAll]);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const [profileRows, sectorRows, boardRows] = await Promise.all([
        loadAccountProfiles(supabase, accountId),
        supabase.from("sectors").select("*").eq("account_id", accountId).order("name"),
        loadBoards(supabase),
      ]);
      if (cancelled) return;
      setProfiles(profileRows);
      setSectors((sectorRows.data ?? []) as Sector[]);
      setBoardsList(boardRows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function patchTask(fields: Record<string, unknown>) {
    if (!task) return;
    const res = await fetch(`/api/operational/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { unmet?: string[] } | null;
      if (body?.unmet && body.unmet.length > 0) {
        toast.error(t("toastStageRequirements", { items: body.unmet.map((k) => t(`stageRequirement_${k}`)).join(", ") }));
      } else {
        toast.error(t("toastFailed"));
      }
      return false;
    }
    await reloadAll();
    onChanged();
    return true;
  }

  async function handleTitleBlur() {
    if (!task || title.trim() === task.title || !title.trim()) return;
    await patchTask({ title: title.trim() });
  }

  async function handleMoveToTop() {
    if (!task) return;
    const { data: rows } = await supabase
      .from("tasks")
      .select("position")
      .eq("stage_id", task.stage_id)
      .order("position", { ascending: true })
      .limit(1);
    const minPosition = rows && rows.length > 0 ? rows[0].position : 0;
    const ok = await patchTask({ position: minPosition - 1 });
    if (ok) toast.success(t("toastMovedToTop"));
  }

  async function handleClone() {
    if (!task) return;
    const res = await fetch(`/api/operational/tasks/${task.id}/clone`, { method: "POST" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    toast.success(t("toastCloned"));
    onChanged();
  }

  async function handleDelete() {
    if (!task) return;
    const res = await fetch(`/api/operational/tasks/${task.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    onOpenChange(false);
    onChanged();
    toast.success(t("toastDeleted"));
  }

  async function handleMoveToBoard() {
    if (!task || !moveTargetBoard || !moveTargetStage) return;
    const ok = await patchTask({ board_id: moveTargetBoard, stage_id: moveTargetStage });
    if (ok) {
      setShowMoveBoard(false);
      toast.success(t("toastMovedBoard"));
    }
  }

  async function loadMoveTargetStages(boardId: string) {
    setMoveTargetBoard(boardId);
    setMoveTargetStage("");
    const rows = await loadBoardStages(supabase, boardId);
    setMoveTargetStages(rows);
  }

  async function handleAddTag(label: string, color: string) {
    if (!task || !accountId) return;
    await supabase.from("task_tags").insert({ task_id: task.id, account_id: accountId, label, color });
    await reloadAll();
  }

  async function handleRemoveTag(tagId: string) {
    await supabase.from("task_tags").delete().eq("id", tagId);
    await reloadAll();
  }

  async function handleSaveRecurrence() {
    if (!task) return;
    if (recurrenceType === "__none") {
      await handleRemoveRecurrence();
      return;
    }
    const res = await fetch(`/api/operational/tasks/${task.id}/recurrence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        recurrenceType === "weekly"
          ? { rule_type: recurrenceType, weekday: Number(recurrenceWeekday) }
          : recurrenceType === "monthly_day"
            ? { rule_type: recurrenceType, day_of_month: Number(recurrenceDayOfMonth) }
            : { rule_type: recurrenceType },
      ),
    });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setShowRecurrence(false);
    await reloadAll();
  }

  async function handleRemoveRecurrence() {
    if (!task) return;
    const res = await fetch(`/api/operational/tasks/${task.id}/recurrence`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("toastFailed"));
      return;
    }
    setShowRecurrence(false);
    await reloadAll();
  }

  function recurrenceSummary(): string {
    if (!recurrenceRule) return t("recurrenceNone");
    if (recurrenceRule.rule_type === "weekly") {
      return t("recurrenceWeeklySummary", { weekday: t(`weekday${recurrenceRule.weekday}`) });
    }
    if (recurrenceRule.rule_type === "monthly_day") {
      return t("recurrenceMonthlyDaySummary", { day: recurrenceRule.day_of_month ?? 0 });
    }
    return t("recurrenceMonthlyFirstBusinessDaySummary");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {loading || !task ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {loading ? t("loading") : t("notFound")}
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-border pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  {task.parent_task_id && (
                    <button
                      type="button"
                      onClick={() => onNavigate(task.parent_task_id!)}
                      className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <CornerDownRight className="h-3 w-3 rotate-180" />
                      {t("backToParent")}
                    </button>
                  )}
                  {canEdit ? (
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={handleTitleBlur}
                      className="border-transparent bg-transparent px-0 text-lg font-semibold text-foreground focus:border-border focus:bg-muted focus:px-2"
                    />
                  ) : (
                    <SheetTitle>{task.title}</SheetTitle>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 pr-8">
                  <button
                    type="button"
                    onClick={() => canEdit && patchTask({ is_urgent: !task.is_urgent })}
                    disabled={!canEdit}
                    aria-label={t("toggleUrgent")}
                    className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                  >
                    <Flag className={`h-4 w-4 ${task.is_urgent ? "fill-red-500 text-red-500" : "text-muted-foreground/50"}`} />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && (
                        <DropdownMenuItem onClick={handleMoveToTop}>
                          <ArrowUpToLine className="size-4" />
                          {t("moveToTop")}
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <DropdownMenuItem onClick={() => setShowMoveBoard(true)}>
                          <FolderInput className="size-4" />
                          {t("moveToBoard")}
                        </DropdownMenuItem>
                      )}
                      {canCreateTasks && (
                        <DropdownMenuItem onClick={handleClone}>
                          <Copy className="size-4" />
                          {t("clone")}
                        </DropdownMenuItem>
                      )}
                      {canEditTimesheet && (
                        <DropdownMenuItem onClick={() => setActiveTab("timesheet")}>
                          <Clock className="size-4" />
                          {t("adjustHours")}
                        </DropdownMenuItem>
                      )}
                      {(canEdit || canComment) && (
                        <DropdownMenuItem onClick={() => setActiveTab("approvals")}>
                          <Users2 className="size-4" />
                          {t("requestApproval")}
                        </DropdownMenuItem>
                      )}
                      {canDelete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setShowDeleteConfirm(true)}
                            className="text-red-400 focus:text-red-400"
                          >
                            <Trash2 className="size-4" />
                            {t("delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
              <FieldSelect
                label={t("stage")}
                value={task.stage_id}
                onChange={(v) => patchTask({ stage_id: v })}
                disabled={!canEdit}
                options={stages.map((s) => ({ value: s.id, label: s.name }))}
              />
              <FieldSelect
                label={t("priority")}
                value={task.priority}
                onChange={(v) => patchTask({ priority: v })}
                disabled={!canEdit}
                options={PRIORITIES.map((p) => ({ value: p, label: tPriority(p) }))}
              />
              <FieldSelect
                label={t("assignee")}
                value={task.assignee_id ?? "__none"}
                onChange={(v) => patchTask({ assignee_id: v === "__none" ? null : v })}
                disabled={!canEdit}
                options={[{ value: "__none", label: t("none") }, ...profiles.map((p) => ({ value: p.id, label: p.full_name }))]}
              />
              <FieldSelect
                label={t("sector")}
                value={task.sector_id ?? "__none"}
                onChange={(v) => patchTask({ sector_id: v === "__none" ? null : v })}
                disabled={!canEdit}
                options={[{ value: "__none", label: t("none") }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("startDate")}</Label>
                <Input
                  type="date"
                  disabled={!canEdit}
                  defaultValue={task.start_date ?? ""}
                  onBlur={(e) => patchTask({ start_date: e.target.value || null })}
                  className="h-8 border-border bg-muted text-xs text-foreground"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("dueDate")}</Label>
                <Input
                  type="date"
                  disabled={!canEdit}
                  defaultValue={task.due_date ?? ""}
                  onBlur={(e) => patchTask({ due_date: e.target.value || null })}
                  className="h-8 border-border bg-muted text-xs text-foreground"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("estimatedMinutes")}</Label>
                <Input
                  type="number"
                  min={0}
                  disabled={!canEdit}
                  defaultValue={task.estimated_minutes ?? ""}
                  onBlur={(e) => patchTask({ estimated_minutes: e.target.value ? Number(e.target.value) : null })}
                  className="h-8 border-border bg-muted text-xs text-foreground"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("recurrence")}</Label>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    setRecurrenceType(recurrenceRule?.rule_type ?? "__none");
                    setRecurrenceWeekday(String(recurrenceRule?.weekday ?? 1));
                    setRecurrenceDayOfMonth(String(recurrenceRule?.day_of_month ?? 1));
                    setShowRecurrence(true);
                  }}
                  className="flex h-8 items-center rounded-md border border-border bg-muted px-2 text-left text-xs text-foreground disabled:opacity-50"
                >
                  {recurrenceSummary()}
                </button>
              </div>
              <div className="col-span-2 grid gap-1 sm:col-span-3">
                <Label className="text-[11px] text-muted-foreground">{t("driveFolder")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="url"
                    disabled={!canEdit}
                    defaultValue={task.drive_folder_url ?? ""}
                    placeholder={t("driveFolderPlaceholder")}
                    onBlur={(e) => patchTask({ drive_folder_url: e.target.value.trim() || null })}
                    className="h-8 flex-1 border-border bg-muted text-xs text-foreground"
                  />
                  {task.drive_folder_url && (
                    <a
                      href={task.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t("driveFolderOpen")}
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-4">
              {(task.tags ?? []).map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                  style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                >
                  {tag.label}
                  {canEdit && (
                    <button type="button" onClick={() => handleRemoveTag(tag.id)} aria-label={t("removeTag")}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && <TagAdder onAdd={handleAddTag} />}
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)} className="flex-1 px-4">
              <TabsList variant="line">
                <TabsTrigger value="briefing">{t("tabBriefing")}</TabsTrigger>
                <TabsTrigger value="comments">{t("tabComments", { count: comments.length })}</TabsTrigger>
                <TabsTrigger value="checklist">{t("tabChecklist", { count: checklist.length })}</TabsTrigger>
                <TabsTrigger value="approvals">{t("tabApprovals", { count: approvals.length })}</TabsTrigger>
                <TabsTrigger value="subtasks">{t("tabSubtasks", { count: subtasks.length })}</TabsTrigger>
                <TabsTrigger value="timesheet">{t("tabTimesheet")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="briefing" className="pt-3">
                <BriefingEditor
                  content={task.briefing as JSONContent | null}
                  editable={canEdit}
                  onSave={(json) => patchTask({ briefing: json })}
                />
              </TabsContent>
              <TabsContent value="comments" className="pt-3">
                <CommentThread
                  taskId={task.id}
                  comments={comments}
                  currentUserId={user?.id}
                  canComment={canComment}
                  onChanged={reloadAll}
                />
              </TabsContent>
              <TabsContent value="checklist" className="pt-3">
                <ChecklistPanel taskId={task.id} items={checklist} canEdit={canEdit} onChanged={reloadAll} />
              </TabsContent>
              <TabsContent value="approvals" className="pt-3">
                <ApprovalsPanel
                  taskId={task.id}
                  approvals={approvals}
                  profiles={profiles}
                  currentUserId={user?.id}
                  canRequest={canEdit || canComment}
                  onChanged={reloadAll}
                />
              </TabsContent>
              <TabsContent value="subtasks" className="pt-3">
                {task.parent_task_id ? (
                  <p className="text-sm text-muted-foreground">{t("isSubtask")}</p>
                ) : (
                  <SubtasksPanel
                    parentTask={task}
                    subtasks={subtasks}
                    convertCandidates={convertCandidates}
                    canEdit={canEdit}
                    onOpenSubtask={onNavigate}
                    onChanged={async () => {
                      await reloadAll();
                      onChanged();
                    }}
                  />
                )}
              </TabsContent>
              <TabsContent value="timesheet" className="pt-3">
                <TimesheetPanel
                  taskId={task.id}
                  entries={timesheet}
                  estimatedMinutes={task.estimated_minutes ?? null}
                  currentUserId={user?.id}
                  canTrack={canTrackTime}
                  canLogManual={canLogManualTime}
                  canEditEntries={canEditTimesheet}
                  onChanged={reloadAll}
                />
              </TabsContent>
              <TabsContent value="history" className="pt-3">
                <HistoryPanel activity={activity} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>

      <Dialog open={showMoveBoard} onOpenChange={setShowMoveBoard}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("moveToBoard")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <FieldSelect
              label={t("board")}
              value={moveTargetBoard || "__none"}
              onChange={(v) => v !== "__none" && loadMoveTargetStages(v)}
              disabled={false}
              options={[{ value: "__none", label: t("none") }, ...boardsList.filter((b) => b.id !== task?.board_id).map((b) => ({ value: b.id, label: b.name }))]}
            />
            {moveTargetStages.length > 0 && (
              <FieldSelect
                label={t("stage")}
                value={moveTargetStage || "__none"}
                onChange={(v) => setMoveTargetStage(v === "__none" ? "" : v)}
                disabled={false}
                options={[{ value: "__none", label: t("none") }, ...moveTargetStages.map((s) => ({ value: s.id, label: s.name }))]}
              />
            )}
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setShowMoveBoard(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleMoveToBoard} disabled={!moveTargetBoard || !moveTargetStage}>
              {t("move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRecurrence} onOpenChange={setShowRecurrence}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("recurrence")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <FieldSelect
              label={t("recurrenceType")}
              value={recurrenceType}
              onChange={(v) => setRecurrenceType(v as "__none" | TaskRecurrenceRuleType)}
              disabled={false}
              options={[
                { value: "__none", label: t("recurrenceOptionNone") },
                { value: "weekly", label: t("recurrenceOptionWeekly") },
                { value: "monthly_day", label: t("recurrenceOptionMonthlyDay") },
                { value: "monthly_first_business_day", label: t("recurrenceOptionMonthlyFirstBusinessDay") },
              ]}
            />
            {recurrenceType === "weekly" && (
              <FieldSelect
                label={t("recurrenceWeekday")}
                value={recurrenceWeekday}
                onChange={setRecurrenceWeekday}
                disabled={false}
                options={["0", "1", "2", "3", "4", "5", "6"].map((n) => ({ value: n, label: t(`weekday${n}`) }))}
              />
            )}
            {recurrenceType === "monthly_day" && (
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">{t("recurrenceDayOfMonth")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={recurrenceDayOfMonth}
                  onChange={(e) => setRecurrenceDayOfMonth(e.target.value)}
                  className="h-8 border-border bg-muted text-xs text-foreground"
                />
              </div>
            )}
            {recurrenceRule && (
              <p className="text-xs text-muted-foreground">
                {t("recurrenceNextRun", { date: new Date(`${recurrenceRule.next_run_at}T00:00:00`).toLocaleDateString() })}
              </p>
            )}
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setShowRecurrence(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleSaveRecurrence}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("delete")}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-red-400">{t("deleteConfirm")}</p>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleDelete} className="bg-red-600 text-white hover:bg-red-700">
              {t("deleteBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  disabled,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as string)} disabled={disabled}>
        <SelectTrigger className="h-8 w-full bg-muted border-border text-xs text-foreground">
          <SelectValue>{options.find((o) => o.value === value)?.label ?? ""}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TagAdder({ onAdd }: { onAdd: (label: string, color: string) => void }) {
  const t = useTranslations("Operational.taskDrawer");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [color, setColor] = useState<string>(DEAL_TAG_COLORS[0].value);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] text-muted-foreground hover:border-border hover:text-foreground"
      >
        + {t("addTag")}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1.5">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("tagPlaceholder")}
        className="h-6 w-24 rounded-md border border-border bg-muted px-1.5 text-xs text-foreground outline-none focus:border-primary"
      />
      {DEAL_TAG_COLORS.slice(0, 5).map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => setColor(c.value)}
          className={`h-3.5 w-3.5 rounded-full ${color === c.value ? "outline outline-2 outline-offset-1 outline-foreground" : ""}`}
          style={{ backgroundColor: c.value }}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          if (text.trim()) onAdd(text.trim(), color);
          setText("");
          setOpen(false);
        }}
        className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
      >
        {t("add")}
      </button>
    </div>
  );
}
