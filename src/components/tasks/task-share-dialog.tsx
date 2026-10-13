"use client";

import { useRef } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTaskCode } from "@/lib/tasks/code";
import { taskShareUrl, whatsappShareUrl } from "@/lib/tasks/share";
import type { Task } from "@/types";

interface TaskShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Pick<Task, "id" | "board_id" | "title" | "task_number"> | null;
}

/** "Compartilhar": the task's own link, copy button and WhatsApp. Internal link (login required). */
export function TaskShareDialog({ open, onOpenChange, task }: TaskShareDialogProps) {
  const t = useTranslations("Operational.cardActions");
  const inputRef = useRef<HTMLInputElement>(null);

  const link = task && typeof window !== "undefined" ? taskShareUrl(window.location.origin, task) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("shareCopied"));
    } catch {
      // Clipboard blocked: select the text so the person can copy by hand.
      inputRef.current?.select();
      toast.info(t("shareCopyManual"));
    }
  }

  function sendWhatsapp() {
    if (!task) return;
    const code = formatTaskCode(task.task_number);
    const message = t("shareWhatsappMessage", { title: code ? `${code} · ${task.title}` : task.title, link });
    window.open(whatsappShareUrl(message), "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("shareTitle")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("shareDesc")}</DialogDescription>
        </DialogHeader>

        {task && <p className="truncate text-sm font-medium text-foreground">{task.title}</p>}

        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={link}
            onClick={(e) => e.currentTarget.select()}
            className="h-9 border-border bg-muted text-xs text-foreground"
            aria-label={t("shareLinkLabel")}
          />
          <Button onClick={copy} className="shrink-0">
            <Copy className="mr-1 h-4 w-4" />
            {t("shareCopy")}
          </Button>
        </div>

        <Button
          variant="outline"
          onClick={sendWhatsapp}
          className="w-full border-border bg-transparent text-foreground hover:bg-muted"
        >
          <MessageCircle className="mr-1.5 h-4 w-4 text-emerald-500" />
          {t("shareWhatsapp")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
