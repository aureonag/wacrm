"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BoardStage } from "@/types";

export const STAGE_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STAGE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={color}
          className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{ backgroundColor: color, borderColor: color === value ? "var(--foreground)" : "transparent" }}
        />
      ))}
    </div>
  );
}

/** Name + color of a new stage. The body remounts per opening (key), so it starts clean. */
export function NewStageDialog({
  open,
  onOpenChange,
  title,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  busy?: boolean;
  onSubmit: (name: string, color: string) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        {open && <NewStageBody title={title} busy={busy} onClose={() => onOpenChange(false)} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  );
}

function NewStageBody({
  title,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (name: string, color: string) => void | Promise<void>;
}) {
  const t = useTranslations("Operational.stageMenu");
  const [name, setName] = useState("");
  const [color, setColor] = useState(STAGE_COLORS[0]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-popover-foreground">{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 py-1">
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("stageName")}</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) void onSubmit(name.trim(), color);
            }}
            maxLength={80}
            className="h-9 border-border bg-muted text-sm text-foreground"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("stageColor")}</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
      <DialogFooter className="border-border bg-popover/50">
        <Button variant="outline" onClick={onClose} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
          {t("cancel")}
        </Button>
        <Button disabled={!name.trim() || busy} onClick={() => void onSubmit(name.trim(), color)}>
          {t("create")}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface StagePatch {
  name?: string;
  color?: string;
  requires_file?: boolean;
  requires_checklist_complete?: boolean;
  requires_approval?: boolean;
}

/** "Configurações da etapa": name, color and what a task needs before it can enter the stage. */
export function StageSettingsDialog({
  stage,
  onOpenChange,
  busy,
  onSave,
}: {
  stage: BoardStage | null;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onSave: (patch: StagePatch) => void | Promise<void>;
}) {
  return (
    <Dialog open={stage !== null} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        {stage && <StageSettingsBody key={stage.id} stage={stage} busy={busy} onClose={() => onOpenChange(false)} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function StageSettingsBody({
  stage,
  busy,
  onClose,
  onSave,
}: {
  stage: BoardStage;
  busy?: boolean;
  onClose: () => void;
  onSave: (patch: StagePatch) => void | Promise<void>;
}) {
  const t = useTranslations("Operational.stageMenu");
  const tReq = useTranslations("Operational.boardSettings");
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color ?? STAGE_COLORS[0]);
  const [requiresFile, setRequiresFile] = useState(stage.requires_file);
  const [requiresChecklist, setRequiresChecklist] = useState(stage.requires_checklist_complete);
  const [requiresApproval, setRequiresApproval] = useState(stage.requires_approval);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-popover-foreground">{t("settingsTitle")}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 py-1">
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("stageName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="h-9 border-border bg-muted text-sm text-foreground"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">{t("stageColor")}</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t("requirementsTitle")}</p>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox checked={requiresFile} onCheckedChange={(v) => setRequiresFile(v === true)} />
            {tReq("requireFile")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox checked={requiresChecklist} onCheckedChange={(v) => setRequiresChecklist(v === true)} />
            {tReq("requireChecklist")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox checked={requiresApproval} onCheckedChange={(v) => setRequiresApproval(v === true)} />
            {tReq("requireApproval")}
          </label>
        </div>
      </div>
      <DialogFooter className="border-border bg-popover/50">
        <Button variant="outline" onClick={onClose} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
          {t("cancel")}
        </Button>
        <Button
          disabled={!name.trim() || busy}
          onClick={() =>
            void onSave({
              name: name.trim(),
              color,
              requires_file: requiresFile,
              requires_checklist_complete: requiresChecklist,
              requires_approval: requiresApproval,
            })
          }
        >
          {t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
