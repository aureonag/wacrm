"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, BoardStage } from "@/types";
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
import { Trash2, Plus, GripVertical, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const STAGE_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
];

interface BoardSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  stages: BoardStage[];
  onBoardChanged: () => void;
  onStagesChanged: () => void;
  onBoardDeleted: () => void;
}

export function BoardSettings({
  open,
  onOpenChange,
  board,
  stages,
  onBoardChanged,
  onStagesChanged,
  onBoardDeleted,
}: BoardSettingsProps) {
  const t = useTranslations("Operational.boardSettings");

  const [name, setName] = useState(board.name);
  const [localStages, setLocalStages] = useState<BoardStage[]>(stages);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(board.name);
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setShowDeleteConfirm(false);
  }, [open, board, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);
    const [renameRes, reorderRes] = await Promise.all([
      fetch(`/api/operational/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }),
      fetch(`/api/operational/boards/${board.id}/stages/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: localStages.map((s) => s.id) }),
      }),
    ]);
    setSaving(false);

    if (!renameRes.ok || !reorderRes.ok) {
      toast.error(t("toastFailedSave"));
      return;
    }

    onOpenChange(false);
    onBoardChanged();
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/operational/boards/${board.id}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, color: newStageColor }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    setLocalStages([
      ...localStages,
      {
        id: body.id,
        board_id: board.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
        requires_file: false,
        requires_checklist_complete: false,
        requires_approval: false,
        created_at: new Date().toISOString(),
      },
    ]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  async function handleRemoveStage(stageId: string) {
    const res = await fetch(`/api/operational/boards/${board.id}/stages/${stageId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error === undefined ? t("toastFailedDeleteStage") : body.error);
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleRenameOrRecolorStage(
    stageId: string,
    patch: {
      name?: string;
      color?: string;
      requires_file?: boolean;
      requires_checklist_complete?: boolean;
      requires_approval?: boolean;
    },
  ) {
    setLocalStages(localStages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
    await fetch(`/api/operational/boards/${board.id}/stages/${stageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function handleDeleteBoard() {
    setDeleting(true);
    const res = await fetch(`/api/operational/boards/${board.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      toast.error(t("toastFailedDeleteBoard"));
      return;
    }
    onOpenChange(false);
    onBoardDeleted();
    toast.success(t("toastDeleted"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("manageBoard")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">{t("deleteBoard")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("deleteBoardDesc")}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button onClick={handleDeleteBoard} disabled={deleting} className="bg-red-600 text-white hover:bg-red-700">
                {deleting ? t("deleting") : t("deleteBoardBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("boardName")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="border-border bg-muted text-foreground" />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
                  <SortableContext items={localStages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {localStages.map((stage) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => handleRenameOrRecolorStage(stage.id, { name: v })}
                          onColorChange={(v) => handleRenameOrRecolorStage(stage.id, { color: v })}
                          onRequirementChange={(field, v) => handleRenameOrRecolorStage(stage.id, { [field]: v })}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: color, borderColor: newStageColor === color ? "var(--foreground)" : "transparent" }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button onClick={() => setShowDeleteConfirm(true)} className="mr-auto bg-red-600 text-white hover:bg-red-700">
                {t("deleteBoard")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
                {t("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onRequirementChange,
  onRemove,
  colors,
  t,
}: {
  stage: BoardStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRequirementChange: (
    field: "requires_file" | "requires_checklist_complete" | "requires_approval",
    value: boolean,
  ) => void;
  onRemove: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border bg-muted p-2">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing" aria-label={t("dragToReorder")}>
          <GripVertical className="h-4 w-4" />
        </button>
        <ColorSwatch value={stage.color ?? colors[0]} onChange={onColorChange} colors={colors} t={t} />
        <Input value={stage.name} onChange={(e) => onNameChange(e.target.value)} className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border" />
        <Button variant="ghost" size="icon-xs" onClick={onRemove} className="text-muted-foreground hover:text-red-400">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-6">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Checkbox
            checked={stage.requires_file}
            onCheckedChange={(v) => onRequirementChange("requires_file", v === true)}
          />
          {t("requireFile")}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Checkbox
            checked={stage.requires_checklist_complete}
            onCheckedChange={(v) => onRequirementChange("requires_checklist_complete", v === true)}
          />
          {t("requireChecklist")}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Checkbox
            checked={stage.requires_approval}
            onCheckedChange={(v) => onRequirementChange("requires_approval", v === true)}
          />
          {t("requireApproval")}
        </label>
      </div>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: value }} aria-label={t("changeColor")} />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: c === value ? "var(--foreground)" : "transparent" }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
