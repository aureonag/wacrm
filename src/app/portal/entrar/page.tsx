"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function PortalLoginPage() {
  const t = useTranslations("Portal.login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError || !data.user) {
      setBusy(false);
      setError(t("error"));
      return;
    }
    if (data.user.app_metadata?.aff_portal !== true) {
      await supabase.auth.signOut();
      setBusy(false);
      setError(t("notAffiliate"));
      return;
    }
    router.replace("/portal");
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
          <Label htmlFor="pl-email">{t("email")}</Label>
          <Input id="pl-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-pass">{t("password")}</Label>
          <Input
            id="pl-pass"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t("submitting") : t("submit")}
        </Button>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          <Link href="/portal/esqueci-senha" className="shrink-0 text-xs font-medium text-primary hover:underline">
            {t("forgot")}
          </Link>
        </div>
      </form>
    </div>
  );
}
