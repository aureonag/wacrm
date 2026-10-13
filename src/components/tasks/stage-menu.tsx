"use client";

import {
  ArrowDownAZ,
  ChevronsLeftRight,
  Minimize2,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskSortKey } from "@/lib/ordering/task-sort";

export type StageMenuAction =
  | { type: "addTask" }
  | { type: "sort"; key: TaskSortKey }
  | { type: "createStage"; where: "before" | "after" }
  | { type: "settings" }
  | { type: "deleteStage" };

const SORT_KEYS: TaskSortKey[] = ["startDate", "dueDate", "createdAt", "client", "project", "title"];
const ITEM = "gap-2.5 whitespace-nowrap px-2.5 py-2 text-[13px]";

/** The "•••" of a board column: add a task, sort, minimize and manage the stage. */
export function StageMenu({
  canAddTask,
  canManage,
  onAction,
  onMinimize,
}: {
  canAddTask: boolean;
  canManage: boolean;
  onAction: (action: StageMenuAction) => void;
  onMinimize: () => void;
}) {
  const t = useTranslations("Operational.stageMenu");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("menuLabel")}
        title={t("menuLabel")}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-60 p-1.5">
        {canAddTask && (
          <>
            <DropdownMenuItem className={ITEM} onClick={() => onAction({ type: "addTask" })}>
              <Plus className="size-4 text-muted-foreground" />
              {t("addTask")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM}>
            <ArrowDownAZ className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("sortBy")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 p-1.5">
            {SORT_KEYS.map((key) => (
              <DropdownMenuItem key={key} className={ITEM} onClick={() => onAction({ type: "sort", key })}>
                {t(`sort.${key}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem className={ITEM} onClick={onMinimize}>
          <Minimize2 className="size-4 text-muted-foreground" />
          {t("minimize")}
        </DropdownMenuItem>

        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={ITEM}>
                <ChevronsLeftRight className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("createStage")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52 p-1.5">
                <DropdownMenuItem className={ITEM} onClick={() => onAction({ type: "createStage", where: "before" })}>
                  {t("createBefore")}
                </DropdownMenuItem>
                <DropdownMenuItem className={ITEM} onClick={() => onAction({ type: "createStage", where: "after" })}>
                  {t("createAfter")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem className={ITEM} onClick={() => onAction({ type: "settings" })}>
              <Settings className="size-4 text-muted-foreground" />
              {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" className={ITEM} onClick={() => onAction({ type: "deleteStage" })}>
              <Trash2 className="size-4" />
              {t("deleteStage")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
