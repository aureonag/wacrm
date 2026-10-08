"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Timers are stamped by the database clock (started_at DEFAULT now(), and
// migration 107 stamps the end too). A computer whose own clock is a couple of
// minutes off would show every timer that many minutes ahead/behind, so the
// ticking "now" is corrected by how far this browser is from the database.
// Measured once per page load; without the migration it quietly stays at 0.
let serverOffsetMs = 0;
let offsetRequested = false;
const offsetListeners = new Set<(offset: number) => void>();

async function loadServerOffset() {
  if (offsetRequested) return;
  offsetRequested = true;
  try {
    const t0 = Date.now();
    const { data, error } = await createClient().rpc("server_now");
    const t1 = Date.now();
    if (error || typeof data !== "string") return;
    const serverMs = new Date(data).getTime();
    if (Number.isNaN(serverMs)) return;
    // The server answered about half a round trip ago.
    serverOffsetMs = serverMs - (t0 + t1) / 2;
    for (const notify of offsetListeners) notify(serverOffsetMs);
  } catch {
    // Not fatal: the clock just stays uncorrected.
  }
}

/** How far this browser's clock is from the database clock (ms; add it to Date.now()).
 *  Anything compared against a database timestamp (presence, "last seen") must use
 *  this, or a PC that is a couple of minutes off reads everyone as stale. */
export function useServerOffset(): number {
  const [offset, setOffset] = useState(serverOffsetMs);
  useEffect(() => {
    offsetListeners.add(setOffset);
    void loadServerOffset();
    return () => {
      offsetListeners.delete(setOffset);
    };
  }, []);
  return offset;
}

/** Re-renders the caller once a second while `active` and returns the
 *  current time in ms, corrected to the database clock. Used to tick a
 *  live-elapsed-time display (Header badge, task cards, running timer row)
 *  without each consumer wiring its own interval/cleanup. */
export function useClockTick(active: boolean): number {
  const [offset, setOffset] = useState(serverOffsetMs);
  const [now, setNow] = useState(() => Date.now() + serverOffsetMs);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    offsetListeners.add(setOffset);
    void loadServerOffset();
    return () => {
      offsetListeners.delete(setOffset);
    };
  }, []);

  useEffect(() => {
    setNow(Date.now() + offset);
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [active, offset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return now;
}
