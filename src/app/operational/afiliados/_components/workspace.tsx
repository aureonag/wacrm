"use client";

// Where the Afiliados screens of ONE client live and what the person may do.
// The same screens are used by the Aureon team (Operacional → Afiliados) and
// by the people of a store (Portal da loja); only the base paths and the
// permissions change. Without a provider the staff defaults apply, derived
// from the URL.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { FULL_ACCESS, can as canDo, type StoreAction, type StoreModule, type StorePermissions } from "@/lib/affiliates/store-access";

export interface Workspace {
  clientId: string;
  /** "/api/.../clients/:id" — append /campaigns, /commissions, ... */
  apiBase: string;
  /** Page path of the client's workspace — append /campanhas, ... */
  pageBase: string;
  mode: "staff" | "store";
  can: (module: StoreModule, action: StoreAction) => boolean;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  clientId,
  pageBase,
  permissions,
  children,
}: {
  clientId: string;
  pageBase: string;
  permissions: StorePermissions;
  children: ReactNode;
}) {
  const value = useMemo<Workspace>(
    () => ({
      clientId,
      apiBase: `/api/operational/affiliates/clients/${clientId}`,
      pageBase,
      mode: "store",
      can: (module, action) => canDo(permissions, module, action),
    }),
    [clientId, pageBase, permissions],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const provided = useContext(WorkspaceContext);
  const { clientId } = useParams<{ clientId: string }>();
  return useMemo<Workspace>(
    () =>
      provided ?? {
        clientId,
        apiBase: `/api/operational/affiliates/clients/${clientId}`,
        pageBase: `/operational/afiliados/clientes/${clientId}`,
        mode: "staff",
        can: (module, action) => canDo(FULL_ACCESS, module, action),
      },
    [provided, clientId],
  );
}
