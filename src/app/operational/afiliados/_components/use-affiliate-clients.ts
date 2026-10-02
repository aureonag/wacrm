"use client";

import { useCallback, useEffect, useState } from "react";

export interface AffiliateClient {
  id: string;
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  platform: "nuvemshop" | "tray" | "outra" | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  status: "active" | "suspended" | "removed";
  created_at: string;
  users: number;
  campaigns: number;
  affiliates: number;
}

export type ClientsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_ready" }
  | { kind: "ready"; clients: AffiliateClient[] };

/** Loads every client of the Afiliados SaaS (staff-only endpoint). */
export function useAffiliateClients() {
  const [state, setState] = useState<ClientsState>({ kind: "loading" });

  const reload = useCallback(async () => {
    const res = await fetch("/api/operational/affiliates/clients");
    if (res.status === 503) return setState({ kind: "not_ready" });
    if (!res.ok) return setState({ kind: "error" });
    const data = (await res.json()) as { clients: AffiliateClient[] };
    setState({ kind: "ready", clients: data.clients });
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { state, reload };
}
