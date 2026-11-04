"use client";

// Public read-only link of a saved report: turn it on, copy it, turn it off.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ShareReport({ reportId, initialToken }: { reportId: string; initialToken: string | null }) {
  const t = useTranslations("Operational.reportei.reportPage");
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
      toast.success(t("shareOffDone"));
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
      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-500" disabled={busy} onClick={disable}>
        <Link2Off className="mr-1.5 h-4 w-4" />
        {t("shareOff")}
      </Button>
    </div>
  );
}
