"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Reward } from "@/lib/affiliates/campaigns";

interface PublicCampaign {
  id: string;
  store: string;
  name: string;
  description: string;
  policy: string;
  discount_type: "PERCENTAGE" | "CURRENCY";
  discount: number;
  frequency: "RECURRENT" | "PERIODIC";
  start_date: string;
  end_date: string | null;
  rewards: Reward[];
  revision: number;
  open: boolean;
}

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; campaign: PublicCampaign };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (iso: string) => iso.split("-").reverse().join("/");

export default function CampaignSignupPage() {
  const t = useTranslations("Portal.signup");
  const ta = useTranslations("Operational.affiliates");
  const { campaignId } = useParams<{ campaignId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [portalUser, setPortalUser] = useState<{ name: string } | null>(null);
  const [done, setDone] = useState<"registered" | "joined" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", instagram: "", password: "", accept: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/public/affiliates/campaigns/${campaignId}`);
      if (cancelled) return;
      if (res.status === 404) return setState({ kind: "missing" });
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", campaign: ((await res.json()) as { campaign: PublicCampaign }).campaign });

      const { data } = await createClient().auth.getUser();
      if (!cancelled && data.user?.app_metadata?.aff_portal === true) {
        setPortalUser({ name: (data.user.user_metadata?.full_name as string | undefined) ?? data.user.email ?? "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function post(url: string, body: unknown, success: "registered" | "joined") {
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) return setDone(success);
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 503 && data?.error === "portal_not_ready") return setError(t("notReady"));
    setError(res.status === 400 || res.status === 409 ? (data?.error ?? t("error")) : t("error"));
  }

  const typeLabel = (type: Reward["type"]) =>
    type === "PIX" ? ta("editor.typePix") : type === "GIFTBACK" ? ta("editor.typeGiftback") : ta("editor.typeOther");

  if (state.kind === "loading") return <p className="text-sm text-muted-foreground">…</p>;
  if (state.kind === "missing") return <p className="text-sm text-muted-foreground">{t("notFound")}</p>;
  if (state.kind === "error") return <p className="text-sm text-destructive">{t("error")}</p>;
  const c = state.campaign;

  return (
    <section className="w-full max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-primary">{c.store}</p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{c.name}</h1>
        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{c.description}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("discountBuyer")}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {c.discount_type === "CURRENCY" ? brl.format(c.discount) : t("discountPercent", { value: c.discount })}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{ta("editor.periodTitle")}</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {c.frequency === "PERIODIC"
              ? ta("campaigns.periodic", { start: formatDate(c.start_date), end: c.end_date ? formatDate(c.end_date) : "" })
              : ta("campaigns.recurrent", { start: formatDate(c.start_date) })}
          </p>
        </div>
      </div>

      {c.rewards.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">{t("rewards")}</h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {c.rewards.map((r) => (
              <li key={r.month}>
                <strong className="text-foreground">
                  {t("rewardMonthly", { month: formatDate(r.month), type: typeLabel(r.type) })}
                </strong>
                {r.type !== "OTHER" ? ` · ${r.value}%` : ""}
                {r.description ? <span className="block">{r.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t("rules")}</h2>
        <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {c.policy}
        </div>
      </div>

      {!c.open ? (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t("closed")}</p>
      ) : done ? (
        <div role="status" className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="font-semibold text-foreground">{done === "joined" ? t("joined") : t("doneTitle")}</p>
          {done === "registered" && <p className="text-sm text-muted-foreground">{t("doneBody")}</p>}
          <Link href="/portal/entrar" className="inline-block text-sm font-medium text-primary hover:underline">
            {t("goPortal")}
          </Link>
        </div>
      ) : portalUser ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm text-foreground">{t("loggedInTitle", { name: portalUser.name })}</p>
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.accept}
              onChange={(e) => setForm((f) => ({ ...f, accept: e.target.checked }))}
            />
            <span>{t("accept", { n: c.revision })}</span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !form.accept}
            onClick={() => post("/api/portal/affiliate/memberships", { campaign_id: c.id, revision: c.revision, accept: true }, "joined")}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("join")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void post("/api/public/affiliates/register", { ...form, campaign_id: c.id, revision: c.revision }, "registered");
          }}
        >
          <h2 className="text-sm font-semibold text-foreground">{t("formTitle")}</h2>
          <div className="space-y-1.5">
            <Label htmlFor="s-name">{t("name")}</Label>
            <Input id="s-name" required maxLength={200} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-email">{t("email")}</Label>
            <Input
              id="s-email"
              type="email"
              autoComplete="email"
              required
              maxLength={200}
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-ig">{t("instagram")}</Label>
            <Input id="s-ig" maxLength={100} value={form.instagram} onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-pass">{t("password")}</Label>
            <Input
              id="s-pass"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={72}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              required
              checked={form.accept}
              onChange={(e) => setForm((f) => ({ ...f, accept: e.target.checked }))}
            />
            <span>{t("accept", { n: c.revision })}</span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy || !form.accept}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? t("submitting") : t("submit")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/portal/entrar" className="hover:underline">
              {t("haveAccount")}
            </Link>
          </p>
        </form>
      )}
    </section>
  );
}
