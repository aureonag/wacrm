// Server-only helpers shared by the commissions API routes.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleNotReady, moduleNotReadyResponse } from "./admin";
import type { Commission } from "./commissions";
import { StorageNotReady } from "./documents";

/** Columns of aff_commissions that may be sent to the browser (no file paths). */
export const COMMISSION_COLUMNS =
  "id, client_id, affiliate_id, period, gross_cents, withholding_cents, status, invoice_number, invoice_issuer, invoice_recipient, invoice_value_cents, invoice_status, invoice_reason, invoice_sent_at, invoice_file_name, receipt_file_name, payment_reference, paid_at, created_at";

export interface CommissionRow extends Omit<Commission, "affiliate_name" | "affiliate_email"> {
  aff_affiliates?: { name: string; email: string } | null;
}

export function toCommission(row: CommissionRow): Commission {
  const { aff_affiliates, ...rest } = row;
  return { ...rest, affiliate_name: aff_affiliates?.name ?? "", affiliate_email: aff_affiliates?.email ?? "" };
}

export interface CommissionFiles {
  id: string;
  status: Commission["status"];
  affiliate_id: string;
  period: string;
  invoice_file_path: string | null;
  invoice_file_name: string | null;
  receipt_file_path: string | null;
  receipt_file_name: string | null;
}

/** Loads one commission scoped to the client. Returns a response when it cannot continue. */
export async function loadCommissionFiles(
  admin: SupabaseClient,
  clientId: string,
  commissionId: string,
): Promise<CommissionFiles | NextResponse> {
  const { data, error } = await admin
    .from("aff_commissions")
    .select("id, status, affiliate_id, period, invoice_file_path, invoice_file_name, receipt_file_path, receipt_file_name")
    .eq("id", commissionId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (isModuleNotReady(error)) return moduleNotReadyResponse();
    console.error("[affiliates/commissions] load failed:", error.message);
    return NextResponse.json({ error: "Failed to load commission" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return data as CommissionFiles;
}

export function storageNotReadyResponse(): NextResponse {
  return NextResponse.json({ error: "storage_not_ready" }, { status: 503 });
}

export function conflictResponse(): NextResponse {
  return NextResponse.json(
    { error: "A comissão mudou de situação enquanto você a editava. Recarregue a página." },
    { status: 409 },
  );
}

export { StorageNotReady };
