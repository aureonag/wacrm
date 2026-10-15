import path from "node:path";

import { OfficeConfigurationError, type OfficeContext } from "@/lib/office/access";
import { createOfficeAssetLoader, type OfficeAssetLoader } from "./assets";
import { getOfficeGatewayClient, getOfficeTransport } from "./transport";

let loader: OfficeAssetLoader | undefined;

/** Fresh membership precedes both transports; private assets have no public fallback. */
export function getOfficeAssets(identity?: OfficeContext): OfficeAssetLoader {
  if (getOfficeTransport() === "gateway") {
    if (!identity) throw new OfficeConfigurationError();
    const client = getOfficeGatewayClient();
    return { load: (relativePath) => client.asset(identity, relativePath) };
  }
  if (!loader) {
    const directory = process.env.AUREON_OFFICE_RUNTIME_DIR?.trim();
    if (!directory || !path.isAbsolute(directory)) throw new OfficeConfigurationError();
    loader = createOfficeAssetLoader({ directory, requireCrmBootstrap: true });
  }
  return loader;
}
