"use client";

// "Esqueci minha senha": asks for the e-mail, mails a 6-digit code, then sends
// the person to /portal/definir-senha to type it with the new password.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PortalForgotPage() {
  const t = useTranslations("Portal.forgot");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/public/portal/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    if (res.ok) return router.push(`/portal/definir-senha?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 429) return setError(t("tooMany"));
    if (res.status === 503) return setError(data?.error === "portal_not_ready" ? t("notReady") : t("noEmail"));
    setError(res.status === 400 ? (data?.error ?? t("error")) : t("error"));
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
      <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-email">{t("email")}</Label>
          <Input id="pf-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t("sending") : t("send")}
        </Button>
        <Link href="/portal/entrar" className="block text-center text-xs text-muted-foreground hover:text-foreground">
          {t("back")}
        </Link>
      </form>
    </div>
  );
}
