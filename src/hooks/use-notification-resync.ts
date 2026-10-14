"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `run` whenever the screen could have missed something: the person comes
 * back to the tab or window, the network returns, and every `intervalMs` as a
 * safety net. The live channel (realtime) delivers instantly; this only covers
 * the moments the connection sleeps or drops (laptop lid, background tab, wifi)
 * so nothing stays missing until a manual refresh.
 */
export function useNotificationResync(run: () => void, intervalMs = 20_000) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    const go = () => latest.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") go();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", go);
    window.addEventListener("focus", go);
    const id = setInterval(go, intervalMs);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", go);
      window.removeEventListener("focus", go);
      clearInterval(id);
    };
  }, [intervalMs]);
}
