// /integracoes/nuvemshop/instalado — where a merchant lands after installing the
// Aureon app from the Nuvemshop's own admin (no CRM session, no sign-in).
// It only says what happened; nothing here reads or changes data.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, XCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Aureon · Nuvemshop",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const FAILURES: Record<string, "deniedBody" | "errorBody" | "notConfiguredBody" | "otherStoreBody"> = {
  denied: "deniedBody",
  error: "errorBody",
  not_configured: "notConfiguredBody",
  other_store: "otherStoreBody",
};

export default async function NuvemshopInstalledPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const t = await getTranslations("NuvemshopInstall");
  const ok = status === "installed" || status === "connected";
  const failure = FAILURES[status ?? ""] ?? "errorBody";

  return (
    <div className="flex min-h-screen flex-col items-center gap-8 bg-background px-4 py-14">
      <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
      <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        {ok ? <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" /> : <XCircle className="mx-auto h-10 w-10 text-red-500" />}
        <h1 className="mt-4 text-lg font-semibold text-foreground">{ok ? t("installed") : t("problem")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{ok ? (status === "connected" ? t("connectedBody") : t("installedBody")) : t(failure)}</p>
      </div>
    </div>
  );
}
