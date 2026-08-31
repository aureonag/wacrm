"use client";

import { useEffect, useState } from "react";
import { PROSPECTING_TERMINAL_STATUSES } from "@/lib/prospecting/constants";

// Same conditional-polling idiom as `src/app/(dashboard)/broadcasts/page.tsx`:
// poll only while something is actually in progress, pause when the tab is
// hidden, refetch on refocus. A run is "settled" once it reaches a terminal
// status OR `awaiting_review` — nothing advances either without a human, so
// polling further would just be wasted requests.
const POLL_INTERVAL_MS = 4000;

export interface ProspectingRunSnapshot {
  id: string;
  status: string;
  found_count: number;
  validated_count: number;
  duplicate_count: number;
  imported_count: number;
  error: string | null;
}

function isSettled(status: string): boolean {
  return status === "awaiting_review" || (PROSPECTING_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function useProspectingRunPolling(runId: string | null) {
  const [run, setRun] = useState<ProspectingRunSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchRun(id: string) {
    try {
      const res = await fetch(`/api/prospecting/runs/${id}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.run) setRun(json.run as ProspectingRunSnapshot);
    } catch {
      // Transient network error — the next poll (or the next effect run) tries again.
    }
  }

  // Reset + fetch once whenever the target run changes.
  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    setLoading(true);
    void fetchRun(runId).finally(() => setLoading(false));
  }, [runId]);

  // Conditional polling, keyed on the run's current status.
  useEffect(() => {
    if (!runId || (run && isSettled(run.status))) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    function start() {
      if (!timer) timer = setInterval(() => void fetchRun(runId!), POLL_INTERVAL_MS);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") stop();
      else {
        void fetchRun(runId!);
        start();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, run?.status]);

  return { run, loading, isSettled: run ? isSettled(run.status) : false };
}
