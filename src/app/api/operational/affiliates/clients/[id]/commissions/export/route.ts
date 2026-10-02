// GET /api/operational/affiliates/clients/:id/commissions/export
//   → CSV of the commissions AVAILABLE for payment (nota fiscal aprovada).
//
// Downloading the file does not register any payment. The export is audited
// (it contains Pix keys). Staff only.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireStaff, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";

interface Row {
  period: string;
  gross_cents: number;
  withholding_cents: number;
  invoice_number: string | null;
  aff_affiliates: { name: string; email: string; pix_key_type: string | null; pix_key: string | null } | null;
}

/** Quotes every cell and defuses spreadsheet formulas (=, +, -, @, tab, CR). */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function brl(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data, error } = await admin
      .from("aff_commissions")
      .select("period, gross_cents, withholding_cents, invoice_number, aff_affiliates(name, email, pix_key_type, pix_key)")
      .eq("client_id", id)
      .eq("status", "available")
      .order("period", { ascending: true });
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/commissions/export]", error.message);
      return NextResponse.json({ error: "Failed to export" }, { status: 500 });
    }

    const header = ["Afiliado", "E-mail", "Tipo da chave Pix", "Chave Pix", "Competência", "Valor bruto (R$)", "Retenção (R$)", "Valor a pagar (R$)", "Nota fiscal"];
    const lines = ((data ?? []) as unknown as Row[]).map((r) => {
      const a = r.aff_affiliates;
      return [
        a?.name ?? "",
        a?.email ?? "",
        a?.pix_key_type ?? "",
        a?.pix_key ?? "",
        r.period.split("-").reverse().join("/"),
        brl(r.gross_cents),
        brl(r.withholding_cents),
        brl(r.gross_cents - r.withholding_cents),
        r.invoice_number ?? "",
      ]
        .map(cell)
        .join(";");
    });

    await writeAudit(admin, ctx, { clientId: id, action: "Exportou pagamentos", objectType: "client", objectId: id });

    const body = "﻿" + [header.map(cell).join(";"), ...lines].join("\r\n") + "\r\n";
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pagamentos-aprovados.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
