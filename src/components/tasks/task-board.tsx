"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { BoardStage, Task } from "@/types";
import { TaskCard } from "./task-card";
import type { TaskMenuAction, TaskMenuPerms } from "./task-card-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useClockTick } from "@/hooks/use-clock-tick";
import { useHorizontalWheelScroll } from "@/hooks/use-horizontal-wheel-scroll";
import { summarizeTaskTime } from "@/lib/tasks/timesheet";
import { Button } from "@/components/ui/button";
import { ChevronsRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { StageMenu, type StageMenuAction } from "./stage-menu";
import { CARD_DROP_PREFIX, resolveDrop, type DropTarget } from "@/lib/ordering/column-order";

/** Dropping a card: prefer the card under the pointer (to place it), else the column. */
const detectCollisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => String(h.id).startsWith(CARD_DROP_PREFIX) && h.id !== `${CARD_DROP_PREFIX}${args.active.id}`);
  if (card) return [card];
  if (hits.length > 0) return hits.filter((h) => !String(h.id).startsWith(CARD_DROP_PREFIX));
  // Nearest card/column, never the card being dragged itself.
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.id !== `${CARD_DROP_PREFIX}${args.active.id}`),
  });
};

interface TaskBoardProps {
  stages: BoardStage[];
  tasks: Task[];
  onTaskMoved: (taskId: string, newStageId: string) => void;
  /** A card was dropped: where (stage + before/after a card). Handles both the stage change and the personal order. */
  onReorder?: (taskId: string, targetStageId: string, target: DropTarget) => void;
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
  /** The "•••" of each column. Absent = no column menu. */
  stageMenu?: {
    canAddTask: boolean;
    canManage: boolean;
    onAction: (stageId: string, action: StageMenuAction) => void;
  };
  /** Where minimized columns are remembered (localStorage key). */
  collapseKey?: string;
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
  onReorder,
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
  stageMenu,
  collapseKey,
}: TaskBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  // Line shown above/below the card the dragged one would land next to.
  const [hint, setHint] = useState<{ cardId: string; where: "before" | "after" } | null>(null);

  // Minimized stages (a thin strip, no cards), remembered on this browser per board.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (!collapseKey || typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(collapseKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  function toggleCollapsed(stageId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      if (collapseKey) {
        try {
          window.localStorage.setItem(collapseKey, JSON.stringify([...next]));
        } catch {
          // Persistence is best-effort.
        }
      }
      return next;
    });
  }

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

  // A touchpad swipe over a card moves the board sideways, not only over the scrollbar.
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef);

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  const stageOfCard = useCallback((cardId: string) => tasks.find((t) => t.id === cardId)?.stage_id ?? null, [tasks]);

  function resolve(event: DragOverEvent | DragEndEvent) {
    const { active, over } = event;
    if (!over) return null;
    return resolveDrop({
      overId: String(over.id),
      stageOfCard,
      overRect: over.rect,
      activeRect: active.rect.current.translated,
      activeId: String(active.id),
    });
  }

  function handleDragOver(event: DragOverEvent) {
    const r = resolve(event);
    if (!r || !r.overCardId || r.target === "top" || r.target === "end") {
      setHint(null);
      return;
    }
    setHint({ cardId: r.overCardId, where: "beforeId" in r.target ? "before" : "after" });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    setHint(null);
    const r = resolve(event);
    if (!r) return;
    const taskId = String(event.active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!sortedStages.some((s) => s.id === r.stageId)) return;

    if (onReorder) {
      onReorder(taskId, r.stageId, r.target);
    } else if (task.stage_id !== r.stageId) {
      onTaskMoved(taskId, r.stageId);
    }
  }

  function handleDragCancel() {
    setActiveTaskId(null);
    setHint(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectCollisions}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Fills the height the page gives it: each column scrolls on its own, so the
          stage titles (and the "Adicionar tarefa" button) stay in view. */}
      <div
        ref={scrollRef}
        className="flex h-full min-h-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:snap-none"
      >
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
              hint={hint}
              collapsed={collapsed.has(stage.id)}
              onToggleCollapsed={() => toggleCollapsed(stage.id)}
              stageMenu={stageMenu}
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
  hint,
  collapsed,
  onToggleCollapsed,
  stageMenu,
}: {
  stage: BoardStage;
  tasks: Task[];
  onAddTask: (stageId: string) => void;
  onOpenTask: (taskId: string) => void;
  timer: CardTimerProps;
  onToggleStage?: (taskIds: string[], select: boolean) => void;
  hint: { cardId: string; where: "before" | "after" } | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  stageMenu?: {
    canAddTask: boolean;
    canManage: boolean;
    onAction: (stageId: string, action: StageMenuAction) => void;
  };
}) {
  const t = useTranslations("Operational.tasks.board");
  const tMenu = useTranslations("Operational.stageMenu");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  // The "select the whole stage" square only shows once something is selected.
  const selecting = !!timer.selectedIds && timer.selectedIds.size > 0;
  const stageIds = tasks.map((task) => task.id);
  const allStageSelected = selecting && stageIds.length > 0 && stageIds.every((id) => timer.selectedIds!.has(id));

  if (collapsed) {
    // A thin strip: the name (vertical), how many tasks, and a click to open it again.
    // It still accepts a dropped card (it goes to the end of the stage).
    return (
      <button
        type="button"
        ref={setNodeRef as unknown as React.Ref<HTMLButtonElement>}
        onClick={onToggleCollapsed}
        title={tMenu("expandStage")}
        aria-label={tMenu("expandStage")}
        className={`flex min-h-0 w-11 shrink-0 flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-1 py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
          isOver ? "border-primary bg-primary/10" : ""
        }`}
        style={{ borderTop: `3px solid ${stage.color ?? "#94a3b8"}` }}
      >
        <ChevronsRight className="h-4 w-4 shrink-0" />
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
        <span className="min-h-0 flex-1 truncate text-sm font-semibold text-foreground [text-orientation:mixed] [writing-mode:vertical-rl]">
          {stage.name}
        </span>
      </button>
    );
  }

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
        {stageMenu && (
          <div className="ml-1 shrink-0">
            <StageMenu
              canAddTask={stageMenu.canAddTask}
              canManage={stageMenu.canManage}
              onMinimize={onToggleCollapsed}
              onAction={(action) => stageMenu.onAction(stage.id, action)}
            />
          </div>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain rounded-lg pr-1 transition-all ${
          isOver ? "bg-primary/5 outline outline-2 outline-dashed outline-primary -outline-offset-2" : ""
        }`}
      >
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropTaskHere")}
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard
              key={task.id}
              task={task}
              stage={stage}
              onOpen={onOpenTask}
              timer={timer}
              hint={hint?.cardId === task.id ? hint.where : null}
            />
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
  hint,
}: {
  task: Task;
  stage: BoardStage;
  onOpen: (taskId: string) => void;
  timer: CardTimerProps;
  hint: "before" | "after" | null;
}) {
  // While something is selected a click selects, so dragging is paused.
  const selecting = !!timer.selectedIds && timer.selectedIds.size > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: selecting });
  // The card is also a drop spot: that is how the position inside a column is chosen.
  const { setNodeRef: setDropRef } = useDroppable({ id: `${CARD_DROP_PREFIX}${task.id}` });
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setDropRef(el);
    },
    [setNodeRef, setDropRef],
  );

  return (
    <div
      ref={setRefs}
      className="relative"
      data-dnd-card="true"
      {...(selecting ? {} : listeners)}
      {...(selecting ? {} : attributes)}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: selecting ? "auto" : "none" }}
    >
      {hint && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1 right-1 z-10 h-0.5 rounded-full bg-primary ${
            hint === "before" ? "-top-1.5" : "-bottom-1.5"
          }`}
        />
      )}
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
