"use client";

// Sets the password with a code: the 6 digits from "esqueci minha senha", or
// the token that comes inside the invite link (?email=...&code=...).

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN = 10;

function SetPasswordForm() {
  const t = useTranslations("Portal.setPassword");
  const router = useRouter();
  const params = useSearchParams();
  const fromLink = params.get("code") ?? "";
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState(fromLink);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm !== "" && confirm !== password;
  const valid = email.trim() && code.trim() && password.length >= MIN && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/public/portal/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setTimeout(() => router.replace("/portal/entrar"), 1800);
      return;
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 429) return setError(t("tooMany"));
    if (res.status === 503) return setError(t("notReady"));
    setError(res.status === 400 || res.status === 409 ? (data?.error ?? t("error")) : t("error"));
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
      <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{fromLink ? t("subtitleInvite") : t("subtitleCode")}</p>
        </div>
        {done ? (
          <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
            {t("done")}
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="sp-email">{t("email")}</Label>
              <Input id="sp-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {!fromLink && (
              <div className="space-y-1.5">
                <Label htmlFor="sp-code">{t("code")}</Label>
                <Input
                  id="sp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="sp-pass">{t("password")}</Label>
              <Input
                id="sp-pass"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">{t("passwordHint", { min: MIN })}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-confirm">{t("confirm")}</Label>
              <Input
                id="sp-confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && <p className="text-[11px] text-destructive">{t("mismatch")}</p>}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !valid}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t("saving") : t("submit")}
            </Button>
          </>
        )}
        <Link href="/portal/entrar" className="block text-center text-xs text-muted-foreground hover:text-foreground">
          {t("back")}
        </Link>
      </form>
    </div>
  );
}

export default function PortalSetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
