import { createClient } from "@supabase/supabase-js";

import { OfficeConfigurationError } from "@/lib/office/access";
import { createCrmInterfaceService, type CrmInterfaceService } from "./service.cjs";
import { createSupabaseOfficeStore } from "./store";
import { getOfficeGatewayClient, getOfficeTransport } from "./transport";
import approvedSeed from "./seeds/approved-map.json";

let service: CrmInterfaceService | undefined;

export function isOfficeEnabled(): boolean {
  return process.env.AUREON_OFFICE_ENABLED === "true";
}

/** Call only after getOfficeContext. Identity is passed per request, never cached. */
export function getOfficeService(): CrmInterfaceService {
  if (getOfficeTransport() === "gateway") {
    const client = getOfficeGatewayClient();
    return {
      async requestAsCrm(identity, method, pathname, body, query) {
        if (!pathname.startsWith("/") || !/^[a-z][a-z0-9-]{0,63}$/.test(pathname.slice(1))) throw new OfficeConfigurationError();
        if (method === "GET" && pathname === "/bootstrap") {
          const data = await client.bootstrap(identity);
          return { map: data.map, clientState: data.clientState };
        }
        return client.interface(identity, method, pathname.slice(1), body, query);
      },
    };
  }
  if (!service) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new OfficeConfigurationError();
    const backend = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    service = createCrmInterfaceService({
      store: createSupabaseOfficeStore(backend),
      approvedMap: approvedSeed.map,
    });
  }
  return service;
}
