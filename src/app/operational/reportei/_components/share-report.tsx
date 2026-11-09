"use client";

// Public read-only link of a saved report: turn it on, copy it, turn it off.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHARE_DAYS, daysLeft, isExpired, type ShareDays } from "@/lib/reportei/share";

export function ShareReport({ reportId, initialToken, initialExpiresAt = null }: { reportId: string; initialToken: string | null; initialExpiresAt?: string | null }) {
  const t = useTranslations("Operational.reportei.reportPage");
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);

  const url = token ? `${window.location.origin}/r/${token}` : "";

  async function enable() {
    setBusy(true);
    try {
      const res = await fetch(`/api/operational/reportei/reports/${reportId}/share`, { method: "POST" });
      if (!res.ok) return toast.error(t("shareError"));
      setToken(((await res.json()) as { token: string }).token);
    } catch {
      toast.error(t("shareError"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm(t("shareOffConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/operational/reportei/reports/${reportId}/share`, { method: "DELETE" });
      if (!res.ok) return toast.error(t("shareError"));
      setToken(null);
      setExpiresAt(null);
      toast.success(t("shareOffDone"));
    } catch {
      toast.error(t("shareError"));
    } finally {
      setBusy(false);
    }
  }

  async function changeValidity(days: ShareDays | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/operational/reportei/reports/${reportId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) return toast.error(t("shareError"));
      setExpiresAt(((await res.json()) as { expiresAt: string | null }).expiresAt);
      toast.success(t("shareValiditySaved"));
    } catch {
      toast.error(t("shareError"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyError"));
    }
  }

  if (!token) {
    return (
      <Button variant="outline" size="sm" disabled={busy} onClick={enable}>
        <Link2 className="mr-1.5 h-4 w-4" />
        {t("share")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 w-72 max-w-full text-xs" aria-label={t("shareLink")} />
      <Button variant="outline" size="sm" onClick={copy}>
        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
        {copied ? t("copied") : t("copy")}
      </Button>
      <select
        aria-label={t("shareValidity")}
        disabled={busy}
        value={expiresAt ? "keep" : ""}
        onChange={(e) => void changeValidity(e.target.value === "" ? null : (Number(e.target.value) as ShareDays))}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground"
      >
        <option value="">{t("shareNeverExpires")}</option>
        {expiresAt && (
          <option value="keep" disabled>
            {isExpired(expiresAt) ? t("shareExpired") : t("shareDaysLeft", { count: daysLeft(expiresAt) ?? 0 })}
          </option>
        )}
        {SHARE_DAYS.map((d) => (
          <option key={d} value={d}>
            {t("shareExpiresIn", { count: d })}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-500" disabled={busy} onClick={disable}>
        <Link2Off className="mr-1.5 h-4 w-4" />
        {t("shareOff")}
      </Button>
    </div>
  );
}
