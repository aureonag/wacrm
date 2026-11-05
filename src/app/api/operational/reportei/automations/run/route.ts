// GET /api/operational/reportei/automations/run — the daily ping that generates
// the reports that are due. Needs the shared secret in the `x-cron-secret`
// header (AUTOMATION_CRON_SECRET), like automations/cron. Safe to call many
// times a day: each automation is claimed for its scheduled day before it runs.
// Also renews the Meta tokens close to expiring, so one ping covers both.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { automationCompare, automationRange, automationTitle, dueDay, isFrequency } from "@/lib/reportei/automation";
import { refreshDueConnections } from "@/lib/reportei/meta-connection";
import { resolvePeriod } from "@/lib/reportei/periods";
import { createSavedReport, type CreateReportResult } from "@/lib/reportei/report-create";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ERROR_CODE = { no_integrations: "no_integrations", unreadable: "unreadable", db_error: "request_failed" } as const;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  const supplied = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const today = resolvePeriod("last_7d").until;
  const summary = { checked: 0, generated: 0, failed: 0, skipped: 0 };

  const { data: rows, error } = await db
    .from("reportei_automations")
    .select("id, account_id, client_id, frequency, last_run_on, created_at, ops_clients(name)")
    .eq("active", true);
  if (error) {
    console.error("[reportei automations/run] list", error.message);
    return NextResponse.json({ error: "list failed" }, { status: 500 });
  }

  for (const row of rows ?? []) {
    summary.checked++;
    if (!isFrequency(row.frequency)) continue;
    const previousRun = (row.last_run_on as string | null) ?? null;
    const createdOn = new Date(row.created_at as string).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const day = dueDay(row.frequency, today, previousRun, createdOn);
    if (!day) {
      summary.skipped++;
      continue;
    }

    // Claim the day first so two overlapping pings never generate it twice.
    const base = db.from("reportei_automations").update({ last_run_on: day }).eq("id", row.id);
    const claimed = await (previousRun ? base.eq("last_run_on", previousRun) : base.is("last_run_on", null)).select("id").maybeSingle();
    if (claimed.error || !claimed.data) {
      summary.skipped++;
      continue;
    }

    const client = Array.isArray(row.ops_clients) ? row.ops_clients[0] : row.ops_clients;
    const range = automationRange(row.frequency, day);
    const result: CreateReportResult = await createSavedReport(db, {
      accountId: row.account_id as string,
      clientId: row.client_id as string,
      title: automationTitle(row.frequency, client?.name ?? "", range),
      range,
      compare: automationCompare(row.frequency, range),
      createdBy: null,
      auto: true,
    }).catch((err: unknown) => {
      console.error("[reportei automations/run] generate", err instanceof Error ? err.message : err);
      return { ok: false, reason: "db_error" } as const;
    });

    if (result.ok) {
      summary.generated++;
      await db.from("reportei_automations").update({ last_report_id: result.id, last_error: null }).eq("id", row.id);
    } else {
      summary.failed++;
      // Give the day back so the next ping tries again, and show why on the screen.
      await db.from("reportei_automations").update({ last_run_on: previousRun, last_error: ERROR_CODE[result.reason] }).eq("id", row.id);
    }
  }

  const refresh = await refreshDueConnections().catch(() => null);
  return NextResponse.json({ ...summary, refresh });
}
