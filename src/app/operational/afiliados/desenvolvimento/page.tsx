"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Code2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Badge, Panel } from "../_components/metric";

interface System {
  environment: "production" | "development";
  checks: { database: boolean; portal_users: boolean; storage: boolean; signup_codes: boolean; email: boolean };
  providers: { nuvemshop: boolean; tray: boolean; asaas: boolean };
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: System };

const CHECKS = ["database", "portal_users", "storage", "signup_codes", "email"] as const;
const PROVIDERS = ["nuvemshop", "tray", "asaas"] as const;

export default function AffiliateDevelopmentPage() {
  const t = useTranslations("Operational.affiliates");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/operational/affiliates/system");
      if (cancelled) return;
      if (!res.ok) return setState({ kind: "error" });
      setState({ kind: "ready", data: (await res.json()) as System });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("headings.development.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("headings.development.description")}</p>
      </div>

      {state.kind === "loading" && (
        <div className="space-y-4">
          <Skeleton className="h-52" />
          <Skeleton className="h-28" />
        </div>
      )}
      {state.kind === "error" && <EmptyState title={t("error")} className="min-h-40" />}
      {state.kind === "ready" && (
        <>
          <Panel
            title={t("development.title")}
            icon={Code2}
            hint={t("development.environment", { env: t(`development.env_${state.data.environment}`) })}
          >
            <ul className="divide-y divide-border">
              {CHECKS.map((key) => {
                const ok = state.data.checks[key];
                return (
                  <li key={key} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <strong className="block text-sm font-medium text-foreground">{t(`development.checks.${key}.title`)}</strong>
                      <p className="text-xs text-muted-foreground">{t(`development.checks.${key}.${ok ? "ok" : "fail"}`)}</p>
                    </div>
                    <Badge tone={ok ? "good" : "warn"}>{ok ? t("development.ok") : t("development.attention")}</Badge>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="grid gap-4 md:grid-cols-3">
            {PROVIDERS.map((key) => (
              <Panel key={key} title={t(`integrations.${key}.name`)}>
                <Badge tone={state.data.providers[key] ? "good" : "muted"}>
                  {state.data.providers[key] ? t("integrations.connected") : t("integrations.notConnected")}
                </Badge>
                <p className="mt-3 text-xs text-muted-foreground">{t("development.providerNote")}</p>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
