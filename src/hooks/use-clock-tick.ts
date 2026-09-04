"use client";

import { useEffect, useState } from "react";

/** Re-renders the caller once a second while `active`. Used to tick a
 *  live-elapsed-time display (Header badge, running timer row) without
 *  each consumer wiring its own interval/cleanup. */
export function useClockTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return now;
}
