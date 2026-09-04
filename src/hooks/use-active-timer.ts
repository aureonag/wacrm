"use client";

import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadActiveTimer } from "@/lib/tasks/queries";
import type { TimesheetEntry } from "@/types";

/**
 * The caller's single account-wide active timer (Etapa 2, Fase 4 —
 * "exatamente um timer ativo por usuário"), live across tabs/pages via
 * Realtime. Same subscribe-then-snapshot shape as usePresence: subscribe
 * first, then fetch the current row, so an event that lands mid-fetch
 * isn't clobbered by a stale snapshot. Also mirrors usePresence in NOT
 * resetting state when there's no user yet — that window is brief
 * (session resolving) and the consumer unmounts on logout anyway.
 *
 * Used by both the persistent Header indicator and the task drawer's
 * Timesheet tab (to know whether "this" task's timer is the active one,
 * or whether a different task is running elsewhere).
 */
export function useActiveTimer() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [entry, setEntry] = useState<TimesheetEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const row = await loadActiveTimer(supabase, userId);
    setEntry(row);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const supabase = createClient();

    const channel: RealtimeChannel = supabase
      .channel(`active-timer:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "timesheet_entries", filter: `user_id=eq.${userId}` },
        () => {
          // Any insert/update on this user's entries can only ever start
          // or stop the one active row — cheapest correct response is
          // just re-fetching it rather than tracking diffs.
          loadActiveTimer(supabase, userId).then((row) => {
            if (!cancelled) setEntry(row);
          });
        },
      )
      .subscribe();

    loadActiveTimer(supabase, userId).then((row) => {
      if (!cancelled) {
        setEntry(row);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return { activeTimer: entry, loading, refresh };
}
