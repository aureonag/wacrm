"use client";

// ============================================================
// ResetPasswordDialog
//
// Sets a new password directly for an existing member — no email
// round trip. This is the companion to "Criar acesso agora": once
// someone already has a login (including a former member who was
// removed, since removal never deletes the login — see
// remove_account_member, migration 018), this is the way back in
// instead of hitting "already registered" trying to recreate them.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Dices, KeyRound, Loader2, MessageCircle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { generatePassword } from "@/lib/auth/generate-password";

const MIN_PASSWORD_LEN = 6;

interface ResetPasswordMember {
  user_id: string;
  full_name: string;
  email: string | null;
}

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: ResetPasswordMember | null;
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  member,
}: ResetPasswordDialogProps) {
  const t = useTranslations("Settings.resetPassword");

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setPassword("");
    setSubmitting(false);
    setDone(false);
  }

  async function handleSubmit() {
    if (!member) return;
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(t("tooShort", { min: MIN_PASSWORD_LEN }));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/account/members/${member.user_id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t("failed"));
        return;
      }
      setDone(true);
    } catch (err) {
      console.error("[ResetPasswordDialog] error:", err);
      toast.error("Could not reach the server. Try again?");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(password);
      toast.success(t("copied"));
    } catch {
      toast.error(t("clipboardBlocked"));
    }
  }

  function whatsappShareUrl(): string {
    if (!member) return "#";
    const message = t("whatsappMessage", {
      email: member.email ?? "",
      password,
    });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  const displayName = member?.full_name || member?.email || "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <KeyRound className="size-4 text-primary" />
                {t("doneTitle")}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t("doneDesc", { name: displayName })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label className="text-muted-foreground">
                {t("newPasswordLabel")}
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={password}
                  className="bg-muted border-border text-foreground font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  onClick={copyToClipboard}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                >
                  <Copy className="size-4" />
                </Button>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">
                  {t("saveNow")}
                </strong>{" "}
                {t("saveHint")}
              </div>

              <a
                href={whatsappShareUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: "outline",
                  className:
                    "w-full border-border text-muted-foreground hover:bg-muted",
                })}
              >
                <MessageCircle className="size-4" />
                {t("sendViaWhatsApp")}
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t("done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t("desc", { name: displayName })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label className="text-muted-foreground">
                {t("newPasswordLabel")}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder={t("passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPassword(generatePassword())}
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                  title={t("generatePassword")}
                >
                  <Dices className="size-4" />
                </Button>
              </div>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("saving")}
                  </>
                ) : (
                  t("confirmBtn")
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
