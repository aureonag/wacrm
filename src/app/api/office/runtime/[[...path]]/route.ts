import { NextResponse } from "next/server";

import { getOfficeContext } from "@/lib/office/access";
import { officeError, officeJson, OFFICE_PRIVATE_HEADERS } from "@/lib/office/http";
import { getOfficeAssets } from "@/lib/office/runtime/asset-server";
import { OfficeAssetError } from "@/lib/office/runtime/assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function respond(request: Request, head: boolean) {
  try {
    const identity = await getOfficeContext();
    const prefix = "/api/office/runtime";
    const pathname = new URL(request.url).pathname;
    // Keep the raw URL path. Percent escapes and backslashes are rejected by the loader.
    const relative = pathname === prefix || pathname === prefix + "/"
      ? "index.html" : pathname.slice(prefix.length + 1);
    if (!pathname.startsWith(prefix + "/") && pathname !== prefix) return officeJson({ error: "Arquivo não encontrado." }, 404);
    const asset = await getOfficeAssets(identity).load(relative);
    return new NextResponse(head ? null : new Uint8Array(asset.bytes), {
      headers: {
        ...OFFICE_PRIVATE_HEADERS, "Content-Type": asset.contentType,
        "Content-Length": String(asset.size), ETag: asset.etag,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof OfficeAssetError) {
      return officeJson({ error: error.status === 404 ? "Arquivo não encontrado." : "O escritório está indisponível." }, error.status);
    }
    return officeError(error);
  }
}

export function GET(request: Request) { return respond(request, false); }
export function HEAD(request: Request) { return respond(request, true); }
