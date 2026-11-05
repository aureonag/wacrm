"use client";

// The account's report templates, loaded once per screen that needs them.

import { useCallback, useEffect, useState } from "react";
import type { Template } from "@/lib/reportei/template";

export function useTemplates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/operational/reportei/templates");
      if (!res.ok) throw new Error("load");
      setTemplates(((await res.json()) as { templates: Template[] }).templates);
      setFailed(false);
    } catch {
      setFailed(true);
      setTemplates((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    void reload();
  }, [reload]);

  return { templates, failed, reload };
}
