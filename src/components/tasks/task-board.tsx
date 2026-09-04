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
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface TaskBoardProps {
  stages: BoardStage[];
  tasks: Task[];
  onTaskMoved: (taskId: string, newStageId: string) => void;
  onAddTask: (stageId: string) => void;
  onOpenTask: (taskId: string) => void;
}

export function TaskBoard({ stages, tasks, onTaskMoved, onAddTask, onOpenTask }: TaskBoardProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

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
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {sortedStages.map((stage) => {
          const stageTasks = tasksByStage.get(stage.id) ?? [];
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              tasks={stageTasks}
              onAddTask={onAddTask}
              onOpenTask={onOpenTask}
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
}: {
  stage: BoardStage;
  tasks: Task[];
  onAddTask: (stageId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const t = useTranslations("Operational.tasks.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      <div className="-mx-4 -mt-4 h-[3px] rounded-t-xl" style={{ backgroundColor: stage.color ?? "#94a3b8" }} />
      <div className="flex items-center justify-between pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">{stage.name}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2" : ""
        }`}
      >
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropTaskHere")}
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableTaskCard key={task.id} task={task} stage={stage} onOpen={onOpenTask} />
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
}: {
  task: Task;
  stage: BoardStage;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      data-dnd-card="true"
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <TaskCard task={task} stage={stage} onOpen={onOpen} />
    </div>
  );
}
