"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type ColumnOrderScope = "task" | "deal";

/**
 * The signed-in person's own order of the cards of each column (migration 119).
 * `orders[stageId]` = ids in the order they chose; a failure to load or save
 * leaves the board in its natural order (it never blocks the board).
 */
export function useColumnOrder(scope: ColumnOrderScope, stageIds: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const { user, accountId } = useAuth();
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const key = useMemo(() => [...stageIds].sort().join(","), [stageIds]);

  const load = useCallback(async () => {
    if (!user || !key) return null;
    const { data, error } = await supabase
      .from("user_column_order")
      .select("stage_id, item_ids")
      .eq("user_id", user.id)
      .in("stage_id", key.split(","));
    if (error || !data) return null;
    const next: Record<string, string[]> = {};
    for (const row of data as { stage_id: string; item_ids: string[] }[]) next[row.stage_id] = row.item_ids;
    return next;
  }, [supabase, user, key]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await load();
      if (!cancelled && next) setOrders(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Reloads the saved orders (after something else changed them). */
  const refresh = useCallback(async () => {
    const next = await load();
    if (next) setOrders(next);
  }, [load]);

  /** Saves the order of one column (updates the screen right away). */
  const save = useCallback(
    async (stageId: string, itemIds: string[]) => {
      setOrders((prev) => ({ ...prev, [stageId]: itemIds }));
      if (!user || !accountId) return;
      const { error } = await supabase.from("user_column_order").upsert(
        {
          user_id: user.id,
          account_id: accountId,
          scope,
          stage_id: stageId,
          item_ids: itemIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,stage_id" },
      );
      if (error) console.error("[column-order] save failed:", error.message);
    },
    [supabase, user, accountId, scope],
  );

  return { orders, save, refresh };
}
