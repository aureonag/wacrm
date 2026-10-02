// Shared types + validation for Afiliados commissions (fechamento → nota fiscal
// → análise → pagamento). Pure functions: usable on server and client.
//
// Flow: awaiting_invoice → invoice_review → available → paid_external
//                         ↘ invoice_rejected → (reenvio) invoice_review
// Pagamento só com nota aprovada (também garantido por CHECK no banco).

import { BadInput, isUuid } from "./campaigns";

export type CommissionStatus =
  | "awaiting_invoice"
  | "invoice_review"
  | "invoice_rejected"
  | "available"
  | "paid_external";

export interface Commission {
  id: string;
  client_id: string;
  affiliate_id: string;
  affiliate_name: string;
  affiliate_email: string;
  /** Competência (YYYY-MM). */
  period: string;
  gross_cents: number;
  withholding_cents: number;
  status: CommissionStatus;
  invoice_number: string | null;
  invoice_issuer: string | null;
  invoice_recipient: string | null;
  invoice_value_cents: number | null;
  invoice_status: "in_review" | "approved" | "rejected" | null;
  invoice_reason: string | null;
  invoice_sent_at: string | null;
  invoice_file_name: string | null;
  receipt_file_name: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_CENTS = 10_000_000_000; // R$ 100 milhões

function reqText(v: unknown, max: number, message: string): string {
  if (typeof v !== "string" || !v.trim()) throw new BadInput(message);
  const s = v.trim();
  if (s.length > max) throw new BadInput("Texto longo demais.");
  return s;
}

function cents(v: unknown, message: string): number {
  const n = typeof v === "number" ? v : Number(typeof v === "string" ? v.trim() : NaN);
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_CENTS) throw new BadInput(message);
  return n;
}

export interface CommissionInput {
  affiliate_id: string;
  period: string;
  gross_cents: number;
}

export function parseCommissionInput(body: unknown): CommissionInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.affiliate_id)) throw new BadInput("Selecione o afiliado.");
  const period = typeof b.period === "string" ? b.period : "";
  if (!PERIOD_RE.test(period)) throw new BadInput("Competência inválida.");
  return { affiliate_id: b.affiliate_id, period, gross_cents: cents(b.gross_cents, "Informe um valor de comissão maior que zero.") };
}

export interface InvoiceInput {
  number: string;
  issuer: string;
  recipient: string;
  value_cents: number;
}

/** Fields of the multipart invoice upload (the file is validated separately). */
export function parseInvoiceFields(get: (key: string) => FormDataEntryValue | null): InvoiceInput {
  const text = (k: string) => {
    const v = get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    number: reqText(text("number"), 200, "Informe o número ou a chave da nota."),
    issuer: reqText(text("issuer"), 200, "Informe o emitente (nome e CPF/CNPJ)."),
    recipient: reqText(text("recipient"), 200, "Informe o tomador (empresa e CNPJ)."),
    value_cents: cents(text("value_cents"), "Informe o valor da nota."),
  };
}

export interface ReviewInput {
  approve: boolean;
  reason: string | null;
}

export function parseReviewInput(body: unknown): ReviewInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.approve !== "boolean") throw new BadInput("Solicitação inválida.");
  if (b.approve) return { approve: true, reason: null };
  const reason = reqText(b.reason, 500, "Informe o motivo da rejeição.");
  if (reason.length < 3) throw new BadInput("Informe o motivo da rejeição.");
  return { approve: false, reason };
}

export function parsePaymentReference(v: FormDataEntryValue | null): string {
  return reqText(typeof v === "string" ? v : "", 200, "Informe a referência da transação bancária.");
}
