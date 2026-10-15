import { OfficeConfigurationError } from "@/lib/office/access";
import { createOfficeGatewayClient, type OfficeGatewayClient } from "../gateway/client";
import { decodeOfficeGatewayKey } from "../gateway/protocol";

let gateway: { url: string; key: Buffer; client: OfficeGatewayClient } | undefined;

/** Deployment choice is explicit. A missing/failed gateway never falls back to a local process. */
export function getOfficeTransport(): "local" | "gateway" {
  if (process.env.AUREON_OFFICE_ENABLED !== "true") throw new OfficeConfigurationError();
  const transport = process.env.AUREON_OFFICE_TRANSPORT;
  if (transport !== "local" && transport !== "gateway") throw new OfficeConfigurationError();
  return transport;
}

/** Server configuration only. Browser input cannot choose a URL, key, or transport. */
export function getOfficeGatewayClient(): OfficeGatewayClient {
  if (getOfficeTransport() !== "gateway") throw new OfficeConfigurationError();
  try {
    const url = process.env.AUREON_OFFICE_GATEWAY_URL?.trim();
    if (!url) throw new OfficeConfigurationError();
    const key = decodeOfficeGatewayKey(process.env.AUREON_OFFICE_GATEWAY_KEY);
    if (!gateway || gateway.url !== url || !gateway.key.equals(key)) {
      gateway = { url, key, client: createOfficeGatewayClient({ url, key }) };
    }
    return gateway.client;
  } catch {
    throw new OfficeConfigurationError();
  }
}
