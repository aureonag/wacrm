"use client";

import { useCallback, useState } from "react";

// A text box whose content is kept in this browser (localStorage) while it is
// being written: it survives switching tabs inside a task, closing the task to
// look something up in a briefing or another task, and a page reload. Clear it
// when the text is finally sent. Best effort: with storage blocked it still
// works as a normal state, it just isn't remembered.

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: keep working without persistence.
  }
}

export function useDraft(key: string): [string, (value: string) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key) }));

  // The key changed (another task / another comment): load that draft.
  let current = state;
  if (state.key !== key) {
    current = { key, value: read(key) };
    setState(current);
  }

  const set = useCallback(
    (value: string) => {
      write(key, value);
      setState({ key, value });
    },
    [key],
  );

  return [current.value, set];
}
