"use client";

// /portal — sends each person to the right place: an affiliate to their
// portal, a person of one store to that store; someone with more than one
// role / store picks.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface Me {
  kind: "portal" | "staff";
  is_affiliate: boolean;
  stores: { client_id: string; client_name: string }[];
}

export default function PortalIndex() {
  const t = useTranslations("Portal.chooser");
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/portal/store/me");
      if (cancelled) return;
      if (!res.ok) return setFailed(true);
      const data = (await res.json()) as Me;
      if (data.kind === "staff") return router.replace("/operational/afiliados");
      if (data.stores.length === 0 && data.is_affiliate) return router.replace("/portal/afiliado");
      if (data.stores.length === 1 && !data.is_affiliate) return router.replace(`/portal/loja/${data.stores[0].client_id}/dashboard`);
      setMe(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/portal/entrar");
  }

  if (!me && !failed) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{t("loading")}</div>;

  const empty = failed || (me && me.stores.length === 0 && !me.is_affiliate);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
      <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-bold text-foreground">{empty ? t("noAccessTitle") : t("title")}</h1>
        <p className="text-sm text-muted-foreground">{empty ? t("noAccessHint") : t("subtitle")}</p>
        {!empty && me && (
          <ul className="space-y-2 pt-1">
            {me.stores.map((s) => (
              <li key={s.client_id}>
                <Link
                  href={`/portal/loja/${s.client_id}/dashboard`}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <Building2 className="h-4 w-4 text-primary" />
                  {s.client_name}
                </Link>
              </li>
            ))}
            {me.is_affiliate && (
              <li>
                <Link
                  href="/portal/afiliado"
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <UserRound className="h-4 w-4 text-primary" />
                  {t("asAffiliate")}
                </Link>
              </li>
            )}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="w-full" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          {t("signOut")}
        </Button>
      </div>
    </div>
  );
}
