"use client";

// The client (loja) the Aureon team is looking at in Operacional → Afiliados.
// The URL is the source of truth (/operational/afiliados/clientes/:id/...); the
// last one visited is remembered so the sidebar links keep working from pages
// that are not tied to a client (Contas de clientes, Desenvolvimento).

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const KEY = "aff:selected-client";
const URL_RE = /^\/operational\/afiliados\/clientes\/([0-9a-f-]{36})(?:\/|$)/i;

export function clientIdFromPath(pathname: string): string | null {
  return URL_RE.exec(pathname)?.[1] ?? null;
}

export function rememberClient(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Storage can be blocked; the URL still carries the selection.
  }
}

function recall(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Current client: from the URL when present, otherwise the last remembered one. */
export function useSelectedClientId(): string | null {
  const pathname = usePathname();
  const fromUrl = clientIdFromPath(pathname);
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    if (fromUrl) rememberClient(fromUrl);
    // Read after mount (no localStorage during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(fromUrl ?? recall());
  }, [fromUrl]);

  return fromUrl ?? stored;
}
