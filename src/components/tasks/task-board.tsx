"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { BoardStage, Task } from "@/types";
import { TaskCard } from "./task-card";
import type { TaskMenuAction, TaskMenuPerms } from "./task-card-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useClockTick } from "@/hooks/use-clock-tick";
import { summarizeTaskTime } from "@/lib/tasks/timesheet";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface TaskBoardProps {
  stages: BoardStage[];
  tasks: Task[];
  onTaskMoved: (taskId: string, newStageId: string) => void;
  onAddTask: (stageId: string) => void;
  onOpenTask: (taskId: string) => void;
  /** Timer on the card (play/pause + time per person). */
  currentUserId?: string;
  canTrack?: boolean;
  onToggleTimer?: (taskId: string, runningByMe: boolean) => void;
  timerBusyTaskId?: string | null;
  /** Selection of tasks (square on each card). */
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  onToggleStage?: (taskIds: string[], select: boolean) => void;
  /** The "•••" menu of each card. */
  menuPerms?: TaskMenuPerms;
  onMenuAction?: (taskId: string, action: TaskMenuAction) => void;
}

/** What every card needs to show and drive its timer. */
interface CardTimerProps {
  now: number;
  currentUserId?: string;
  canTrack?: boolean;
  onToggleTimer?: (taskId: string, runningByMe: boolean) => void;
  timerBusyTaskId?: string | null;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  menuPerms?: TaskMenuPerms;
  onMenuAction?: (taskId: string, action: TaskMenuAction) => void;
}

export function TaskBoard({
  stages,
  tasks,
  onTaskMoved,
  onAddTask,
  onOpenTask,
  currentUserId,
  canTrack,
  onToggleTimer,
  timerBusyTaskId,
  selectedIds,
  onToggleSelect,
  onToggleStage,
  menuPerms,
  onMenuAction,
}: TaskBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // One shared clock for every card: ticks once a second only while some
  // task on the board has a running timer.
  const anyRunning = useMemo(
    () => tasks.some((task) => summarizeTaskTime(task.time_entries, 0).running),
    [tasks],
  );
  const now = useClockTick(anyRunning);
  const timer: CardTimerProps = {
    now,
    currentUserId,
    canTrack,
    onToggleTimer,
    timerBusyTaskId,
    selectedIds,
    onToggleSelect,
    menuPerms,
    onMenuAction,
  };

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  const tasksByStage = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const task of tasks) {
      const bucket = map.get(task.stage_id);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [sortedStages, tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const targetStageId = String(over.id);

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onTaskMoved(taskId, targetStageId);
  }

  function handleDragCancel() {
    setActiveTaskId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Fills the height the page gives it: each column scrolls on its own, so the
          stage titles (and the "Adicionar tarefa" button) stay in view. */}
      <div className="flex h-full min-h-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:snap-none">
        {sortedStages.map((stage) => {
          const stageTasks = tasksByStage.get(stage.id) ?? [];
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              tasks={stageTasks}
              onAddTask={onAddTask}
              onOpenTask={onOpenTask}
              timer={timer}
              onToggleStage={onToggleStage}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTask ? (
          <div className="opacity-90">
            <TaskCard
              task={activeTask}
              stage={sortedStages.find((s) => s.id === activeTask.stage_id) ?? null}
              isOverlay
              now={now}
              currentUserId={currentUserId}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function StageColumn({
  stage,
  tasks,
  onAddTask,
  onOpenTask,
  timer,
  onToggleStage,
}: {
  stage: BoardStage;
  tasks: Task[];
  onAddTask: (stageId: string) => void;
  onOpenTask: (taskId: string) => void;
  timer: CardTimerProps;
  onToggleStage?: (taskIds: string[], select: boolean) => void;
}) {
  const t = useTranslations("Operational.tasks.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  // The "select the whole stage" square only shows once something is selected.
  const selecting = !!timer.selectedIds && timer.selectedIds.size > 0;
  const stageIds = tasks.map((task) => task.id);
  const allStageSelected = selecting && stageIds.length > 0 && stageIds.every((id) => timer.selectedIds!.has(id));

  return (
    <div className="flex min-h-0 w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: stage.color ?? "#94a3b8" }} />
      <div className="flex items-center justify-between pt-3">
        {selecting && onToggleStage && (
          <Checkbox
            className="mr-2 shrink-0"
            checked={allStageSelected}
            disabled={stageIds.length === 0}
            aria-label={stage.name}
            onCheckedChange={(checked) => onToggleStage(stageIds, checked === true)}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{stage.name}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg pr-1 transition-all ${
          isOver ? "bg-primary/5 outline outline-2 outline-dashed outline-primary -outline-offset-2" : ""
        }`}
      >
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropTaskHere")}
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard key={task.id} task={task} stage={stage} onOpen={onOpenTask} timer={timer} />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddTask(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addTask")}
      </Button>
    </div>
  );
}

function DraggableTaskCard({
  task,
  stage,
  onOpen,
  timer,
}: {
  task: Task;
  stage: BoardStage;
  onOpen: (taskId: string) => void;
  timer: CardTimerProps;
}) {
  // While something is selected a click selects, so dragging is paused.
  const selecting = !!timer.selectedIds && timer.selectedIds.size > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: selecting });

  return (
    <div
      ref={setNodeRef}
      data-dnd-card="true"
      {...(selecting ? {} : listeners)}
      {...(selecting ? {} : attributes)}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: selecting ? "auto" : "none" }}
    >
      <TaskCard
        task={task}
        stage={stage}
        onOpen={onOpen}
        now={timer.now}
        currentUserId={timer.currentUserId}
        canTrack={timer.canTrack}
        onToggleTimer={timer.onToggleTimer}
        timerBusy={timer.timerBusyTaskId === task.id}
        selection={
          timer.selectedIds && timer.onToggleSelect
            ? {
                selected: timer.selectedIds.has(task.id),
                active: selecting,
                onToggle: () => timer.onToggleSelect!(task.id),
              }
            : undefined
        }
        menu={
          timer.menuPerms && timer.onMenuAction
            ? { perms: timer.menuPerms, onAction: (action) => timer.onMenuAction!(task.id, action) }
            : undefined
        }
      />
    </div>
  );
}
