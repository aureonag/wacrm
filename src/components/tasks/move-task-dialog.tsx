"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { loadBoards, loadBoardStages } from "@/lib/tasks/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Board, BoardStage } from "@/types";

interface MoveTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many tasks are being moved (for the title). */
  count: number;
  /** The board the tasks are on: not offered as a target. */
  currentBoardId: string;
  busy?: boolean;
  onConfirm: (boardId: string, stageId: string) => void | Promise<void>;
}

/** Pick another board and the stage the task(s) will land in. */
export function MoveTaskDialog({ open, onOpenChange, count, currentBoardId, busy, onConfirm }: MoveTaskDialogProps) {
  const t = useTranslations("Operational.cardActions");
  const supabase = useMemo(() => createClient(), []);
  const [boards, setBoards] = useState<Board[]>([]);
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [boardId, setBoardId] = useState("");
  const [stageId, setStageId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const rows = await loadBoards(supabase);
      if (!cancelled) setBoards(rows.filter((b) => b.id !== currentBoardId));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, currentBoardId]);

  async function pickBoard(id: string) {
    setBoardId(id);
    setStageId("");
    setStages(await loadBoardStages(supabase, id));
  }

  const boardName = boards.find((b) => b.id === boardId)?.name;
  const stageName = stages.find((s) => s.id === stageId)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("moveTitle", { count })}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("moveBoard")}</Label>
            <Select value={boardId} onValueChange={(v) => v && void pickBoard(v)}>
              <SelectTrigger className="h-9 border-border bg-muted text-sm">
                <SelectValue>{boardName ?? t("movePickBoard")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {stages.length > 0 && (
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{t("moveStage")}</Label>
              <Select value={stageId} onValueChange={(v) => v && setStageId(v)}>
                <SelectTrigger className="h-9 border-border bg-muted text-sm">
                  <SelectValue>{stageName ?? t("movePickStage")}</SelectValue>
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
          )}
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border bg-transparent text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button disabled={!boardId || !stageId || busy} onClick={() => void onConfirm(boardId, stageId)}>
            {t("move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
