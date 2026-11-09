// GET /api/public/reportei/:token — public, no auth. Returns one shared report
// (read-only) found by its random share token. Anything else is a uniform 404.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type { ReportSnapshot } from "@/lib/reportei/report";
import { isExpired } from "@/lib/reportei/share";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limit = checkRateLimit(`reportei-public:${clientIp(request)}`, RATE_LIMITS.reporteiPublic);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabaseAdmin()
    .from("reportei_reports")
    .select("client_id, title, subtitle, notes, snapshot, created_at, share_expires_at, ops_clients(name)")
    .eq("share_token", token)
    .maybeSingle();
  if (error) {
    console.error("[GET public/reportei/:token]", error.message);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
  // An expired link answers like one that never existed.
  if (!data || isExpired(data.share_expires_at as string | null)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const logo = await supabaseAdmin().from("reportei_client_logos").select("logo_url").eq("client_id", data.client_id).maybeSingle();
  const client = Array.isArray(data.ops_clients) ? data.ops_clients[0] : data.ops_clients;
  const snapshot = data.snapshot as ReportSnapshot;
  return NextResponse.json(
    {
      report: {
        clientName: client?.name ?? "",
        logoUrl: (logo.data?.logo_url as string | undefined) ?? null,
        title: data.title,
        subtitle: data.subtitle ?? "",
        notes: data.notes ?? "",
        createdAt: data.created_at,
        // Numbers only: no error details from Meta leave the building.
        snapshot: { ...snapshot, accounts: snapshot.accounts.map((a) => ({ ...a, detail: undefined })) },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
