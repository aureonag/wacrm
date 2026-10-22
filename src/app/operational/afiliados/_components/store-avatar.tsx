"use client";

// Photo of a person of a store: the round picture (initials when there is none)
// and the dialog to change or remove it. Used by the store portal (own photo,
// top bar) and by the team screen (anyone's photo, for those who manage the team).

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function StoreAvatar({
  name,
  url,
  size = 32,
  className,
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const dim = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        style={dim}
        className={cn("shrink-0 rounded-full border border-border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-label={name}
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary", className)}
    >
      {initials(name)}
    </span>
  );
}

/** Centered square crop at 512 px, as JPEG — phone photos are small enough to upload and look the same everywhere. */
async function toSquareJpeg(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.9),
  );
}

export function AvatarEditorDialog({
  open,
  onOpenChange,
  apiBase,
  userRowId,
  name,
  currentUrl,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "/api/operational/affiliates/clients/:id" */
  apiBase: string;
  userRowId: string;
  name: string;
  currentUrl: string | null;
  onChanged: (url: string | null) => void;
}) {
  const t = useTranslations("Operational.affiliates.avatar");
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the dialog opens
    setPicked(null);
    setPreview(null);
  }, [open]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error(t("notImage"));
    try {
      const blob = await toSquareJpeg(file);
      setPicked(blob);
      setPreview(URL.createObjectURL(blob));
    } catch {
      toast.error(t("notImage"));
    }
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", picked, "foto.jpg");
    const res = await fetch(`${apiBase}/users/${userRowId}/avatar`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return toast.error(res.status === 400 ? (data?.error ?? t("failed")) : t("failed"));
    }
    const data = (await res.json()) as { avatar_url: string | null };
    toast.success(t("saved"));
    onChanged(data.avatar_url);
    onOpenChange(false);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`${apiBase}/users/${userRowId}/avatar`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error(t("failed"));
    toast.success(t("removed"));
    onChanged(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title", { name })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <StoreAvatar name={name} url={preview ?? currentUrl} size={112} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Camera className="h-4 w-4" />
            {picked ? t("chooseAnother") : t("choose")}
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          {currentUrl ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>
              <Trash2 className="h-4 w-4" />
              {t("remove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={busy || !picked} onClick={save}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
