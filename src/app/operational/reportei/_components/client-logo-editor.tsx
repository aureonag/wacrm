"use client";

// The client's photo in the header of its Reportei page, with "Trocar foto" and
// "Remover" for whoever can edit boards. The photo is what the client card shows.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/use-permissions";
import { LOGO_MAX_BYTES } from "@/lib/reportei/client-card";
import { ClientAvatar } from "./client-avatar";

export function ClientLogoEditor({ clientId, name, logoUrl, onChanged }: { clientId: string; name: string; logoUrl: string | null; onChanged: (url: string | null) => void }) {
  const t = useTranslations("Operational.reportei.clientPage");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (file.size > LOGO_MAX_BYTES) return toast.error(t("logoTooBig"));
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/logo`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { logoUrl?: string; error?: string };
      if (!res.ok || !body.logoUrl) return toast.error(body.error ?? t("logoError"));
      onChanged(body.logoUrl);
      toast.success(t("logoSaved"));
    } catch {
      toast.error(t("logoError"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/logo`, { method: "DELETE" });
      if (!res.ok) return toast.error(t("logoError"));
      onChanged(null);
    } catch {
      toast.error(t("logoError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <ClientAvatar name={name} logoUrl={logoUrl} size={56} />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {logoUrl ? t("logoChange") : t("logoAdd")}
          </Button>
          {logoUrl && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={remove} aria-label={t("logoRemove")} title={t("logoRemove")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
