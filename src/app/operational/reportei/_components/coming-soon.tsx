"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/dashboard/empty-state";

// Placeholder for Reportei sections whose back-end is not built yet. `section`
// is a key under Operational.reportei.nav (also used as the page heading).
export function ComingSoon({ section }: { section: string }) {
  const t = useTranslations("Operational.reportei");
  return (
    <>
      <h1 className="text-xl font-semibold">{t(`nav.${section}`)}</h1>
      <EmptyState title={t("comingSoonTitle")} hint={t("comingSoonHint")} className="min-h-48" />
    </>
  );
}
