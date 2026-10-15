"use client";

import { useEffect, type RefObject } from "react";

/**
 * Makes a horizontally scrolling board follow a touchpad swipe (and a side
 * wheel) no matter what is under the pointer.
 *
 * A two-finger swipe is never perfectly horizontal. The browser latches the
 * whole gesture to the first scroller that can take its first movement — over a
 * card that is the column's own vertical scroll (or the page), which then
 * swallows the horizontal part, so the board only moved with the pointer on the
 * scrollbar. Here a gesture that is mostly horizontal is applied to the board
 * directly; a mostly vertical one is left alone (columns and the page scroll
 * as usual).
 */
export function useHorizontalWheelScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch-zoom
      const dx = Math.abs(event.deltaX);
      const dy = Math.abs(event.deltaY);
      if (dx === 0 || dx < dy) return;

      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const canScroll = (event.deltaX < 0 && el.scrollLeft > 0) || (event.deltaX > 0 && el.scrollLeft < max - 0.5);
      if (!canScroll) return;

      // deltaMode 1 = lines, 2 = pages; the usual 0 = pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += event.deltaX * unit;
      event.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
