"use client";

import {
  ArrowUpToLine,
  Clock,
  Copy,
  FolderInput,
  MessageSquare,
  MoreHorizontal,
  Share2,
  Trash2,
  Users2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TaskMenuAction =
  | "moveToTop"
  | "moveToBoard"
  | "clone"
  | "openComments"
  | "share"
  | "adjustHours"
  | "requestApproval"
  | "delete";

/** What the signed-in person may do with a task (decides which items show). */
export interface TaskMenuPerms {
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canEditTimesheet: boolean;
  canComment: boolean;
}

const ITEM = "gap-2.5 whitespace-nowrap px-2.5 py-2 text-[13px]";

/**
 * The "•••" of a task card: same options as the menu inside the task, one click
 * away from the board. Every click is stopped here so it never opens the card or
 * starts a drag.
 */
export function TaskCardMenu({
  perms,
  onAction,
}: {
  perms: TaskMenuPerms;
  onAction: (action: TaskMenuAction) => void;
}) {
  const t = useTranslations("Operational.cardActions");
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const hasPosition = perms.canEdit;
  const hasTask = perms.canCreate || perms.canComment || perms.canEdit || perms.canEditTimesheet;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("menuLabel")}
        title={t("menuLabel")}
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground data-popup-open:bg-background/60 data-popup-open:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56 p-1.5" onClick={stop} onPointerDown={stop}>
        {perms.canEdit && (
          <>
            <DropdownMenuItem className={ITEM} onClick={() => onAction("moveToTop")}>
              <ArrowUpToLine className="size-4 text-muted-foreground" />
              {t("moveToTop")}
            </DropdownMenuItem>
            <DropdownMenuItem className={ITEM} onClick={() => onAction("moveToBoard")}>
              <FolderInput className="size-4 text-muted-foreground" />
              {t("moveToBoard")}
            </DropdownMenuItem>
          </>
        )}
        {hasPosition && hasTask && <DropdownMenuSeparator />}
        {perms.canCreate && (
          <DropdownMenuItem className={ITEM} onClick={() => onAction("clone")}>
            <Copy className="size-4 text-muted-foreground" />
            {t("clone")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM} onClick={() => onAction("openComments")}>
          <MessageSquare className="size-4 text-muted-foreground" />
          {t("openComments")}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onClick={() => onAction("share")}>
          <Share2 className="size-4 text-muted-foreground" />
          {t("share")}
        </DropdownMenuItem>
        {perms.canEditTimesheet && (
          <DropdownMenuItem className={ITEM} onClick={() => onAction("adjustHours")}>
            <Clock className="size-4 text-muted-foreground" />
            {t("adjustHours")}
          </DropdownMenuItem>
        )}
        {(perms.canEdit || perms.canComment) && (
          <DropdownMenuItem className={ITEM} onClick={() => onAction("requestApproval")}>
            <Users2 className="size-4 text-muted-foreground" />
            {t("requestApproval")}
          </DropdownMenuItem>
        )}
        {perms.canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className={ITEM} onClick={() => onAction("delete")}>
              <Trash2 className="size-4" />
              {t("delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
