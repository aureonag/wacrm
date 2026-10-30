"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `run` whenever the screen could have missed something: the person comes
 * back to the tab or window, the network returns, and every `intervalMs` as a
 * safety net. The live channel (realtime) delivers instantly; this only covers
 * the moments the connection sleeps or drops (laptop lid, background tab, wifi)
 * so nothing stays missing until a manual refresh.
 *
 * The timer only runs while the tab is visible (a tab left open in the
 * background used to keep asking the database every few seconds — with several
 * tabs per person that added up to a good part of the load on 30/10/2026), and
 * coming back to the tab fires once even though `visibilitychange`, `focus` and
 * `online` often arrive together.
 */
export function useNotificationResync(run: () => void, intervalMs = 60_000) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    let lastRunAt = 0;
    const go = () => {
      const now = Date.now();
      if (now - lastRunAt < 2_000) return;
      lastRunAt = now;
      latest.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") go();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", go);
    window.addEventListener("focus", go);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") go();
    }, intervalMs);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", go);
      window.removeEventListener("focus", go);
      clearInterval(id);
    };
  }, [intervalMs]);
}
