"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "../../../_components/metric";
import { useWorkspace } from "../../../_components/workspace";

// The store / payment connectors are not built yet: every card says so
// honestly. "CRM Aureon" is the one that is real — the team is using it now.
const CONNECTORS = [
  { key: "nuvemshop", connected: false },
  { key: "tray", connected: false },
  { key: "asaas", connected: false },
  { key: "crm", connected: true },
] as const;

export default function AffiliateIntegrationsPage() {
  const t = useTranslations("Operational.affiliates");
  const { apiBase } = useWorkspace();
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(apiBase);
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { client: { platform: string | null } };
      setPlatform(data.client.platform);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-border bg-card p-5">
        <Plug className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <strong className="text-sm font-semibold text-foreground">{t("integrations.noticeTitle")}</strong>
          <p className="mt-1 text-sm text-muted-foreground">{t("integrations.noticeBody")}</p>
          {platform && platform !== "outra" && (
            <p className="mt-2 text-xs text-muted-foreground">{t("integrations.clientPlatform", { platform: t(`clients.platform_${platform}`) })}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CONNECTORS.map(({ key, connected }) => (
          <section key={key} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <Plug className="h-6 w-6 text-primary" />
              <Badge tone={connected ? "good" : "muted"}>
                {connected ? t("integrations.connected") : t("integrations.notConnected")}
              </Badge>
            </div>
            <h2 className="mt-3 text-base font-semibold text-foreground">{t(`integrations.${key}.name`)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(`integrations.${key}.description`)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => toast.info(t(`integrations.${key}.status`))}
            >
              {t("integrations.viewStatus")}
            </Button>
          </section>
        ))}
      </div>
    </div>
  );
}
