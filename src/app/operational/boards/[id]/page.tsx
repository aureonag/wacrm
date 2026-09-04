"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadBoardStages, loadBoardTasks } from "@/lib/tasks/queries";
import { useHasPermission } from "@/hooks/use-permissions";
import type { Board, BoardStage, Task } from "@/types";
import { TaskBoard } from "@/components/tasks/task-board";
import { BoardSettings } from "@/components/tasks/board-settings";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const canEditBoards = useHasPermission("operational", "tasks", "edit_boards");
  const canCreateTasks = useHasPermission("operational", "tasks", "create_tasks");
  const hasMovePermission = useHasPermission("operational", "tasks", "move_tasks");
  const hasEditPermission = useHasPermission("operational", "tasks", "edit_tasks");
  const canMoveTasks = hasMovePermission || hasEditPermission;

  const [board, setBoard] = useState<Board | null>(null);
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  // Deep-link from the Header's active-timer indicator (`?task=<id>`) —
  // read once as the initial value (not synced via an effect) so the
  // drawer opens on arrival without an extra render/setState pass.
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => searchParams.get("task"));

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
    setOpenTaskId(taskId);
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
    <div className="space-y-5">
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

      {stages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noStages")}</p>
      ) : (
        <TaskBoard
          stages={stages}
          tasks={tasks}
          onTaskMoved={canMoveTasks ? handleTaskMoved : () => {}}
          onAddTask={handleAddTask}
          onOpenTask={handleOpenTask}
        />
      )}

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        boardId={boardId}
        stages={stages}
        defaultStageId={defaultStageId}
        onCreated={reload}
      />

      <TaskDrawer
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
