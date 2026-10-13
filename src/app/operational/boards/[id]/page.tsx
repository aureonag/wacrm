"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadBoardStages, loadBoardTasks } from "@/lib/tasks/queries";
import { useHasPermission } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import {
  PipelineOwnerFilter,
  OWNER_FILTER_ALL,
  OWNER_FILTER_MINE,
  type OwnerFilterMember,
} from "@/components/pipelines/pipeline-owner-filter";
import { loadEnvironmentMembers } from "@/lib/auth/environment-members";
import type { Board, BoardStage, Task } from "@/types";
import { TaskBoard } from "@/components/tasks/task-board";
import { BoardSettings } from "@/components/tasks/board-settings";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, FolderInput, Loader2, Plus, Search, Settings, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { matchesTaskQuery } from "@/lib/tasks/search";
import { Input } from "@/components/ui/input";
import { TaskShareDialog } from "@/components/tasks/task-share-dialog";
import { MoveTaskDialog } from "@/components/tasks/move-task-dialog";
import type { TaskMenuAction, TaskMenuPerms } from "@/components/tasks/task-card-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function BoardKanbanPage(props: { params: Promise<{ id: string }> }) {
  // useSearchParams (for the Header active-timer's `?task=` deep link)
  // requires a Suspense boundary around any caller that could be
  // prerendered — see node_modules/next/dist/docs's use-search-params.md.
  return (
    <Suspense fallback={null}>
      <BoardKanbanPageInner {...props} />
    </Suspense>
  );
}

function BoardKanbanPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id: boardId } = use(params);
  const t = useTranslations("Operational.boards");
  const tc = useTranslations("Operational.cardActions");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const canEditBoards = useHasPermission("operational", "tasks", "edit_boards");
  const canCreateTasks = useHasPermission("operational", "tasks", "create_tasks");
  const hasMovePermission = useHasPermission("operational", "tasks", "move_tasks");
  const hasEditPermission = useHasPermission("operational", "tasks", "edit_tasks");
  const canMoveTasks = hasMovePermission || hasEditPermission;
  const canTrackTime = useHasPermission("operational", "timesheet", "track");
  const canDeleteTasks = useHasPermission("operational", "tasks", "delete_tasks");
  const canCommentTasks = useHasPermission("operational", "tasks", "comment");
  const canEditTimesheet = useHasPermission("operational", "timesheet", "edit_entries");
  const { user, profile } = useAuth();
  const [timerBusyTaskId, setTimerBusyTaskId] = useState<string | null>(null);
  // tasks.assignee_id stores the PROFILE id (not the login id).
  const myProfileId = profile?.id ?? null;

  const [board, setBoard] = useState<Board | null>(null);
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  const [query, setQuery] = useState("");
  // All tasks / mine / one person. The people are those with access to
  // Operacional; the choice is remembered per board on this browser.
  const [assigneeFilter, setAssigneeFilter] = useState<string>(OWNER_FILTER_ALL);
  const [members, setMembers] = useState<OwnerFilterMember[]>([]);
  const filterKey = `wacrm:operational:board-filter:${boardId}`;
  const effectiveFilter =
    assigneeFilter === OWNER_FILTER_ALL || assigneeFilter === OWNER_FILTER_MINE
      ? assigneeFilter
      : members.some((m) => m.id === assigneeFilter)
        ? assigneeFilter
        : OWNER_FILTER_ALL;
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (!matchesTaskQuery(task, query)) return false;
        if (effectiveFilter === OWNER_FILTER_ALL) return true;
        return task.assignee_id === (effectiveFilter === OWNER_FILTER_MINE ? myProfileId : effectiveFilter);
      }),
    [tasks, query, effectiveFilter, myProfileId],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(filterKey);
      setAssigneeFilter(stored ?? OWNER_FILTER_ALL);
    } catch {
      // Persistence is best-effort.
    }
  }, [filterKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadEnvironmentMembers(supabase, "operational");
      if (!cancelled) setMembers(list.filter((p) => p.id !== myProfileId));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, myProfileId]);

  function handleFilterChange(value: string) {
    setAssigneeFilter(value);
    try {
      localStorage.setItem(filterKey, value);
    } catch {
      // Persistence is best-effort.
    }
  }
  // Deep-link from the Header's active-timer indicator (`?task=<id>`) —
  // read once as the initial value (not synced via an effect) so the
  // drawer opens on arrival without an extra render/setState pass.
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => searchParams.get("task"));
  // Tab the panel opens on (from the card menu: comments / timesheet / approvals).
  const [openTaskTab, setOpenTaskTab] = useState<string | null>(null);

  // Selection (square on each card) and the actions on it.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareTaskId, setShareTaskId] = useState<string | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = useCallback(async () => {
    const [{ data: boardRow }, stageRows, taskRows] = await Promise.all([
      supabase.from("boards").select("*").eq("id", boardId).maybeSingle(),
      loadBoardStages(supabase, boardId),
      loadBoardTasks(supabase, boardId),
    ]);
    setBoard((boardRow as Board) ?? null);
    setStages(stageRows);
    setTasks(taskRows);
    setLoading(false);
  }, [supabase, boardId]);

  // Inline IIFE (not a bare call to `reload`) with a `cancelled` guard —
  // same idiom as PipelinesPage's initial-load effect; a plain
  // `reload()`/`void reload()` call here trips the set-state-in-effect
  // lint rule even though the setState itself happens after an await.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: boardRow }, stageRows, taskRows] = await Promise.all([
        supabase.from("boards").select("*").eq("id", boardId).maybeSingle(),
        loadBoardStages(supabase, boardId),
        loadBoardTasks(supabase, boardId),
      ]);
      if (cancelled) return;
      setBoard((boardRow as Board) ?? null);
      setStages(stageRows);
      setTasks(taskRows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, boardId]);

  // Time tracked by other people (or in another tab/the drawer) shows up on
  // the cards without a reload: any change to timesheet_entries refreshes the
  // tasks of this board.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase
      .channel(`board-timesheet:${boardId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "timesheet_entries" }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const rows = await loadBoardTasks(supabase, boardId);
          if (!cancelled) setTasks(rows);
        }, 400);
      })
      .subscribe();
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [supabase, boardId]);

  // Play/pause on a card. Time is saved in the database (timesheet_entries),
  // one row per work period and person, so nothing is lost on reload and each
  // person keeps their own total. Starting another task pauses the running one.
  async function handleToggleTimer(taskId: string, runningByMe: boolean) {
    setTimerBusyTaskId(taskId);
    try {
      const res = runningByMe
        ? await fetch("/api/operational/timesheet/stop", { method: "POST" })
        : await fetch("/api/operational/timesheet/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: taskId, switch: true }),
          });
      if (!res.ok) {
        toast.error(t("timerFailed"));
      } else if (!runningByMe) {
        const data = (await res.json().catch(() => null)) as { paused_task_title?: string | null } | null;
        if (data?.paused_task_title) toast.info(t("timerSwitched", { title: data.paused_task_title }));
      }
    } finally {
      setTimerBusyTaskId(null);
      await reload();
    }
  }

  async function handleTaskMoved(taskId: string, newStageId: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, stage_id: newStageId } : t)));
    const res = await fetch(`/api/operational/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: newStageId }),
    });
    if (!res.ok) {
      toast.error(t("toastFailedMove"));
      reload();
    }
  }

  function handleAddTask(stageId: string) {
    setDefaultStageId(stageId);
    setCreateOpen(true);
  }

  function handleOpenTask(taskId: string) {
    setOpenTaskTab(null);
    setOpenTaskId(taskId);
  }

  // ---- selection ----
  // Only tasks still on the board (and visible with the current filter) count.
  const selectedList = useMemo(
    () => visibleTasks.filter((task) => selectedIds.has(task.id)).map((task) => task.id),
    [visibleTasks, selectedIds],
  );

  function toggleSelect(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleStageSelect(taskIds: string[], select: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const menuPerms: TaskMenuPerms = {
    canEdit: hasEditPermission,
    canCreate: canCreateTasks,
    canDelete: canDeleteTasks,
    canEditTimesheet,
    canComment: canCommentTasks,
  };

  /** Runs one request per task, one after the other; returns how many worked. */
  async function runForEach(ids: string[], request: (id: string) => Promise<Response>): Promise<number> {
    let ok = 0;
    for (const id of ids) {
      try {
        const res = await request(id);
        if (res.ok) ok += 1;
      } catch {
        // counted as failed
      }
    }
    return ok;
  }

  function reportBulk(done: number, total: number, okKey: "toastCloned" | "toastMoved" | "toastDeleted") {
    if (done === total) toast.success(tc(okKey, { count: done }));
    else if (done === 0) toast.error(tc("toastFailed"));
    else toast.warning(tc("toastPartial", { done, total }));
  }

  async function cloneTasks(ids: string[]) {
    setBulkBusy(true);
    const done = await runForEach(ids, (id) => fetch(`/api/operational/tasks/${id}/clone`, { method: "POST" }));
    setBulkBusy(false);
    reportBulk(done, ids.length, "toastCloned");
    setSelectedIds(new Set());
    await reload();
  }

  async function moveTasksToBoard(ids: string[], targetBoardId: string, targetStageId: string) {
    setBulkBusy(true);
    const done = await runForEach(ids, (id) =>
      fetch(`/api/operational/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: targetBoardId, stage_id: targetStageId }),
      }),
    );
    setBulkBusy(false);
    setMoveIds(null);
    reportBulk(done, ids.length, "toastMoved");
    setSelectedIds(new Set());
    await reload();
  }

  async function deleteTasks(ids: string[]) {
    setBulkBusy(true);
    const done = await runForEach(ids, (id) => fetch(`/api/operational/tasks/${id}`, { method: "DELETE" }));
    setBulkBusy(false);
    setDeleteIds(null);
    reportBulk(done, ids.length, "toastDeleted");
    setSelectedIds(new Set());
    await reload();
  }

  async function moveToTop(taskId: string) {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    const positions = tasks.filter((x) => x.stage_id === task.stage_id).map((x) => x.position);
    const minPosition = positions.length > 0 ? Math.min(...positions) : 0;
    const res = await fetch(`/api/operational/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: minPosition - 1 }),
    });
    if (res.ok) toast.success(tc("toastMovedToTop"));
    else toast.error(tc("toastFailed"));
    await reload();
  }

  function handleMenuAction(taskId: string, action: TaskMenuAction) {
    switch (action) {
      case "moveToTop":
        void moveToTop(taskId);
        break;
      case "moveToBoard":
        setMoveIds([taskId]);
        break;
      case "clone":
        void cloneTasks([taskId]);
        break;
      case "openComments":
        setOpenTaskTab("comments");
        setOpenTaskId(taskId);
        break;
      case "adjustHours":
        setOpenTaskTab("timesheet");
        setOpenTaskId(taskId);
        break;
      case "requestApproval":
        setOpenTaskTab("approvals");
        setOpenTaskId(taskId);
        break;
      case "share":
        setShareTaskId(taskId);
        break;
      case "delete":
        setDeleteIds([taskId]);
        break;
    }
  }

  if (loading) return null;
  if (!board) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/operational/boards")}>
          {t("backToBoards")}
        </Button>
      </div>
    );
  }

  return (
    // The board fills the height of the page: header and filters stay put and
    // each stage column scrolls by itself (see TaskBoard).
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/operational/boards" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="truncate text-2xl font-bold text-foreground">{board.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canCreateTasks && (
            <Button onClick={() => handleAddTask(stages[0]?.id ?? "")} disabled={stages.length === 0}>
              <Plus className="mr-1 h-4 w-4" />
              {t("newTask")}
            </Button>
          )}
          {canEditBoards && (
            <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} aria-label={t("manageBoard")}>
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <PipelineOwnerFilter
          value={effectiveFilter}
          onChange={handleFilterChange}
          members={members}
          allLabel={t("filterAll")}
          mineLabel={t("filterMine")}
          membersLabel={t("filterMembers")}
        />
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 border-border bg-muted pl-8 text-sm text-foreground"
          />
        </div>
        {(query.trim() || effectiveFilter !== OWNER_FILTER_ALL) && (
          <p className="text-xs text-muted-foreground">
            {t("searchCount", { shown: visibleTasks.length, total: tasks.length })}
          </p>
        )}
      </div>

      {selectedList.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              aria-label={tc("clearSelection")}
              title={tc("clearSelection")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-foreground">{tc("selectedCount", { count: selectedList.length })}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreateTasks && (
              <Button
                variant="outline"
                disabled={bulkBusy}
                onClick={() => void cloneTasks(selectedList)}
                className="border-border bg-card text-foreground hover:bg-muted"
              >
                {bulkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Copy className="mr-1 h-4 w-4" />}
                {tc("bulkClone")}
              </Button>
            )}
            {hasEditPermission && (
              <Button
                variant="outline"
                disabled={bulkBusy}
                onClick={() => setMoveIds(selectedList)}
                className="border-border bg-card text-foreground hover:bg-muted"
              >
                <FolderInput className="mr-1 h-4 w-4" />
                {tc("moveToBoard")}
              </Button>
            )}
            {canDeleteTasks && (
              <Button disabled={bulkBusy} onClick={() => setDeleteIds(selectedList)} className="bg-red-600 text-white hover:bg-red-700">
                <Trash2 className="mr-1 h-4 w-4" />
                {tc("bulkDelete")}
              </Button>
            )}
          </div>
        </div>
      )}

      {stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noStages")}</p>
      ) : (
        <div className="min-h-0 flex-1">
          <TaskBoard
            stages={stages}
            tasks={visibleTasks}
            onTaskMoved={canMoveTasks ? handleTaskMoved : () => {}}
            onAddTask={handleAddTask}
            onOpenTask={handleOpenTask}
            currentUserId={user?.id}
            canTrack={canTrackTime}
            onToggleTimer={handleToggleTimer}
            timerBusyTaskId={timerBusyTaskId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleStage={toggleStageSelect}
            menuPerms={menuPerms}
            onMenuAction={handleMenuAction}
          />
        </div>
      )}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        boardId={boardId}
        stages={stages}
        defaultStageId={defaultStageId}
        onCreated={reload}
      />

      <TaskShareDialog
        open={!!shareTaskId}
        onOpenChange={(open) => !open && setShareTaskId(null)}
        task={tasks.find((x) => x.id === shareTaskId) ?? null}
      />

      <MoveTaskDialog
        open={moveIds !== null}
        onOpenChange={(open) => !open && setMoveIds(null)}
        count={moveIds?.length ?? 0}
        currentBoardId={boardId}
        busy={bulkBusy}
        onConfirm={(targetBoardId, targetStageId) => moveTasksToBoard(moveIds ?? [], targetBoardId, targetStageId)}
      />

      <Dialog open={deleteIds !== null} onOpenChange={(open) => !open && !bulkBusy && setDeleteIds(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{tc("deleteTitle", { count: deleteIds?.length ?? 0 })}</DialogTitle>
          </DialogHeader>
          <p className="py-1 text-sm text-red-400">{tc("deleteDesc")}</p>
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              disabled={bulkBusy}
              onClick={() => setDeleteIds(null)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {tc("cancel")}
            </Button>
            <Button
              disabled={bulkBusy}
              onClick={() => void deleteTasks(deleteIds ?? [])}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {bulkBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              {tc("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDrawer
        key={openTaskTab ?? "default"}
        initialTab={openTaskTab ?? undefined}
        taskId={openTaskId}
        open={!!openTaskId}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
        onChanged={reload}
        onNavigate={setOpenTaskId}
      />

      {board && (
        <BoardSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          board={board}
          stages={stages}
          onBoardChanged={reload}
          onStagesChanged={reload}
          onBoardDeleted={() => router.push("/operational/boards")}
        />
      )}
    </div>
  );
}
