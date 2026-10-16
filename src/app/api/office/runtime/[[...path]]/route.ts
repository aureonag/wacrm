import { NextResponse } from "next/server";

import { getOfficeContext } from "@/lib/office/access";
import { officeError, officeJson, OFFICE_PRIVATE_HEADERS } from "@/lib/office/http";
import { getOfficeAssets } from "@/lib/office/runtime/asset-server";
import { OfficeAssetError } from "@/lib/office/runtime/assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestTiming() {
  const started = performance.now();
  const metrics: string[] = [];
  const duration = (since: number) => {
    const elapsed = performance.now() - since;
    // Fixed names and bounded decimal numbers only: no request, identity or error
    // data can enter Server-Timing, even if a clock returns an invalid value.
    return Math.min(3_600_000, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0)).toFixed(1);
  };
  return {
    async measure<T>(name: "office_auth" | "office_asset", operation: () => Promise<T>): Promise<T> {
      const begin = performance.now();
      try { return await operation(); }
      finally { metrics.push(`${name};dur=${duration(begin)}`); }
    },
    finish(response: NextResponse): NextResponse {
      response.headers.append("Server-Timing", [...metrics, `office_route;dur=${duration(started)}`].join(", "));
      return response;
    },
  };
}

async function respond(request: Request, head: boolean) {
  const timing = requestTiming();
  try {
    const identity = await timing.measure("office_auth", getOfficeContext);
    const prefix = "/api/office/runtime";
    const pathname = new URL(request.url).pathname;
    // Keep the raw URL path. Percent escapes and backslashes are rejected by the loader.
    const relative = pathname === prefix || pathname === prefix + "/"
      ? "index.html" : pathname.slice(prefix.length + 1);
    if (!pathname.startsWith(prefix + "/") && pathname !== prefix) return timing.finish(officeJson({ error: "Arquivo não encontrado." }, 404));
    const asset = await timing.measure("office_asset", () => getOfficeAssets(identity).load(relative));
    return timing.finish(new NextResponse(head ? null : new Uint8Array(asset.bytes), {
      headers: {
        ...OFFICE_PRIVATE_HEADERS, "Content-Type": asset.contentType,
        "Content-Length": String(asset.size), ETag: asset.etag,
        "X-Frame-Options": "SAMEORIGIN",
      },
    }));
  } catch (error) {
    if (error instanceof OfficeAssetError) {
      return timing.finish(officeJson({ error: error.status === 404 ? "Arquivo não encontrado." : "O escritório está indisponível." }, error.status));
    }
    return timing.finish(officeError(error));
  }
}

export function GET(request: Request) { return respond(request, false); }
export function HEAD(request: Request) { return respond(request, true); }
