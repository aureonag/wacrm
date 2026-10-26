"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOST_REASON_KEYS } from "@/lib/deals/lost-reason";

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Asks WHY a deal was lost before it goes to the "Perdido" stage — the same pop-up
 * whether the person clicks "Marcar como perdido" on the deal or drops the card in
 * the Perdido column of the board.
 */
export function LostReasonDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string, note: string | null) => void | Promise<void>;
}) {
  const t = useTranslations("Pipelines.detail");
  const [reasonKey, setReasonKey] = useState<(typeof LOST_REASON_KEYS)[number]>("price");
  const [otherText, setOtherText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the dialog opens
    setReasonKey("price");
    setOtherText("");
    setNote("");
    setBusy(false);
  }, [open]);

  async function confirm() {
    const reason = reasonKey === "other" ? otherText.trim() : reasonKey;
    if (!reason) return;
    setBusy(true);
    await onConfirm(reason, note.trim() || null);
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("lostReasonTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex flex-wrap gap-2">
            {LOST_REASON_KEYS.map((key) => (
              <Chip key={key} selected={reasonKey === key} onClick={() => setReasonKey(key)}>
                {t(`lostReason_${key}` as Parameters<typeof t>[0])}
              </Chip>
            ))}
          </div>
          {reasonKey === "other" && (
            <Input
              autoFocus
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder={t("lostReasonOtherPlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          )}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("lostReasonNoteLabel")}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("lostReasonNotePlaceholder")}
              rows={3}
              className="border-border bg-muted text-foreground"
            />
          </div>
        </div>
        <DialogFooter className="bg-popover/50 border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || (reasonKey === "other" && !otherText.trim())}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("markAsLost")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
