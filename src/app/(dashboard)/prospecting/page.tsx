"use client";

import { Radar } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ProspectingPage() {
  const t = useTranslations("Prospecting");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
          <Radar className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("comingSoonTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("comingSoonBody")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          {/* Config card (pipeline, responsible, frente, quantity, source
              status) lands in M3/M4 — see plan modular-jingling-quill.md. */}
        </div>
      </div>
    </div>
  );
}
