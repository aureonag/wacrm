"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import type { ScopeSection } from "@/lib/contracts/scope";

interface ContractInfo {
  razaoSocial: string;
  cnpj: string;
  signedAt: string | null;
  terminatedAt: string | null;
  terminationEffectiveDate: string | null;
  sections: ScopeSection[];
}

function brDate(value: string | null): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Contract summary for a kickoff task. Deliberately has no price anywhere. */
export function TaskContractCard({ taskId }: { taskId: string }) {
  const t = useTranslations("Operational.taskDrawer.contractCard");
  const [state, setState] = useState<"loading" | "none" | "error" | ContractInfo>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/operational/tasks/${taskId}/contract`);
      if (cancelled) return;
      if (!res.ok) return setState("error");
      const data = (await res.json()) as { contract: ContractInfo | null };
      setState(data.contract ?? "none");
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (state === "loading") return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (state === "error") return <p className="text-sm text-red-400">{t("error")}</p>;
  if (state === "none") return <p className="text-sm text-muted-foreground">{t("none")}</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          {state.razaoSocial}
        </div>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("cnpj")}</dt>
            <dd className="text-foreground">{state.cnpj}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("signedAt")}</dt>
            <dd className="text-foreground">{brDate(state.signedAt)}</dd>
          </div>
          {state.terminatedAt && (
            <div>
              <dt className="text-red-400">{t("terminated")}</dt>
              <dd className="text-red-300">{t("endsOn", { date: brDate(state.terminationEffectiveDate) })}</dd>
            </div>
          )}
        </dl>
      </div>

      {state.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noScope")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {state.sections.map((s) => (
            <section key={s.key} className="rounded-lg border border-border p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.heading}</h4>
              <ul className="space-y-1.5 text-sm text-foreground">
                {s.lines.map((line, i) => (
                  <li key={i} className="leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
