// Shared "send nota fiscal" logic, used by the staff route (on behalf of the
// affiliate) and by the affiliate portal. The caller authenticates and scopes;
// this only does storage + the guarded state change.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceInput } from "./commissions";
import { conflictResponse, loadCommissionFiles } from "./commissions-server";
import { removeDoc, storeDoc, type UploadedDoc } from "./documents";

/**
 * Stores the file and moves awaiting_invoice / invoice_rejected → invoice_review.
 * `onlyAffiliateId` makes a commission of anyone else look like "not found".
 * Returns a response to send when it did not succeed, or null on success.
 * May throw StorageNotReady — the caller maps it to a 503.
 */
export async function submitInvoice(
  admin: SupabaseClient,
  args: {
    clientId: string;
    commissionId: string;
    onlyAffiliateId?: string;
    fields: InvoiceInput;
    doc: UploadedDoc;
  },
): Promise<NextResponse | null> {
  const { clientId, commissionId, onlyAffiliateId, fields, doc } = args;

  const current = await loadCommissionFiles(admin, clientId, commissionId);
  if (current instanceof NextResponse) return current;
  if (onlyAffiliateId && current.affiliate_id !== onlyAffiliateId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (current.status !== "awaiting_invoice" && current.status !== "invoice_rejected") {
    return NextResponse.json({ error: "Esta comissão não aceita o envio de nota agora." }, { status: 409 });
  }

  const path = await storeDoc(admin, clientId, commissionId, "invoice", doc);
  const { data, error } = await admin
    .from("aff_commissions")
    .update({
      status: "invoice_review",
      invoice_number: fields.number,
      invoice_issuer: fields.issuer,
      invoice_recipient: fields.recipient,
      invoice_value_cents: fields.value_cents,
      invoice_status: "in_review",
      invoice_reason: null,
      invoice_sent_at: new Date().toISOString(),
      invoice_file_path: path,
      invoice_file_name: doc.name,
      invoice_file_mime: doc.mime,
    })
    .eq("id", commissionId)
    .eq("client_id", clientId)
    .eq("status", current.status)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    await removeDoc(admin, path);
    if (error) {
      console.error("[affiliates] submitInvoice failed:", error.message);
      return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
    }
    return conflictResponse();
  }

  await removeDoc(admin, current.invoice_file_path);
  return null;
}
