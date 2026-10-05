"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { loadPipelines } from "@/lib/pipelines/queries";
import type { Pipeline } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { ProspectingExternalImport } from "@/components/prospecting/prospecting-external-import";
import {
  ProspectingConfigCard,
  type ProspectingSelections,
} from "@/components/prospecting/prospecting-config-card";
import { ProspectingRunProgress } from "@/components/prospecting/prospecting-run-progress";
import {
  ProspectingResultsTable,
  type ProspectingCandidate,
} from "@/components/prospecting/prospecting-results-table";
import { useProspectingRunPolling } from "@/hooks/use-prospecting-run-polling";
import { PROSPECTING_DEFAULT_QUANTITY } from "@/lib/prospecting/constants";

export default function ProspectingPage() {
  const t = useTranslations("Prospecting");
  const { user, accountId } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ProspectingCandidate[]>([]);
  const [selections, setSelections] = useState<ProspectingSelections>({
    pipelineId: "",
    ownerId: "",
    frenteLeadgen: false,
    frenteAvr: false,
    quantity: PROSPECTING_DEFAULT_QUANTITY,
  });

  const { run, refresh } = useProspectingRunPolling(activeRunId);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const rows = await loadPipelines(createClient());
      if (!cancelled) setPipelines(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // "Começar nova lista" hides the last list for good (until a new one is
  // uploaded): remember its id so the reload-rehydration below skips it.
  const DISMISSED_KEY = "prospecting:dismissed-run";
  function startNewList() {
    try {
      if (activeRunId) window.localStorage.setItem(DISMISSED_KEY, activeRunId);
    } catch {
      // storage unavailable — the list just comes back on the next reload
    }
    setActiveRunId(null);
    setCandidates([]);
  }

  async function retargetRun(pipelineId: string): Promise<boolean> {
    if (!activeRunId) return false;
    const res = await fetch(`/api/prospecting/runs/${activeRunId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retarget", pipeline_id: pipelineId }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      toast.error(json?.error ?? t("results.retargetFailed"));
      return false;
    }
    await refresh();
    return true;
  }

  const loadCandidates = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}/candidates`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok) setCandidates((json?.candidates as ProspectingCandidate[]) ?? []);
    } catch {
      // The results table just stays empty — the run progress line still
      // shows status, and the user can retry by reopening the run.
    }
  }, []);

  // Rehydrate the user's most recent run on mount/reload — without this,
  // uploading a list and then simply reloading the page (or coming back to
  // it later while enrichment finishes) makes the results/import UI vanish
  // even though the run and its candidates are still there server-side.
  useEffect(() => {
    if (!user?.id || activeRunId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("prospecting_runs")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let dismissed: string | null = null;
      try {
        dismissed = window.localStorage.getItem(DISMISSED_KEY);
      } catch {
        // ignore
      }
      if (!cancelled && data?.id && data.id !== dismissed) setActiveRunId(data.id as string);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Fetch candidates once the run reaches a state where there's something
  // to review, and again whenever counts change (new candidates enriched).
  useEffect(() => {
    if (!activeRunId || !run) return;
    if (run.status === "queued") return;
    void loadCandidates(activeRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, run?.status, run?.found_count, run?.validated_count, run?.duplicate_count, run?.imported_count]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          {run && <ProspectingRunProgress run={run} />}

          <ProspectingExternalImport selections={selections} onRunStarted={setActiveRunId} />

          {activeRunId && candidates.length > 0 && (
            <ProspectingResultsTable
              runId={activeRunId}
              listLabel={run?.prompt ?? null}
              destinationPipelineId={run?.pipeline_id ?? null}
              pipelines={pipelines}
              selectedPipelineId={selections.pipelineId}
              onRetarget={retargetRun}
              onNewList={startNewList}
              candidates={candidates}
              onCandidatesChange={setCandidates}
              onImported={() => void loadCandidates(activeRunId)}
            />
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <ProspectingConfigCard selections={selections} onChange={setSelections} pipelines={pipelines} />
        </div>
      </div>
    </div>
  );
}
