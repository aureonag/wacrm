// Automatic e-mails of the Afiliados module: the affiliate hears about their
// sign-up, their invoice and their payment; the store hears about a new
// invoice to review.
//
// Best effort by design: a notification never fails or slows the action that
// caused it. Without SMTP configured nothing is sent (and nothing breaks).
// No personal data beyond what the person already sees in the portal; amounts
// only go to the affiliate they belong to and to the store's own finance people.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "@/lib/contracts/email";
import { portalNotificationEmailHtml } from "@/lib/contracts/email-templates";
import { baseUrl } from "./portal-access";

export type AffiliateEvent =
  | { kind: "membership_approved"; code: string; campaign: string }
  | { kind: "membership_rejected"; campaign: string }
  | { kind: "invoice_approved"; period: string }
  | { kind: "invoice_rejected"; period: string; reason: string }
  | { kind: "payment_registered"; period: string; net: string };

export type StoreEvent = { kind: "invoice_submitted"; affiliate: string; period: string };

const periodLabel = (p: string) => p.split("-").reverse().join("/");

function affiliateContent(e: AffiliateEvent, store: string): { subject: string; title: string; paragraphs: string[]; cta: string } {
  switch (e.kind) {
    case "membership_approved":
      return {
        subject: "Sua participação foi aprovada",
        title: "Sua participação foi aprovada",
        paragraphs: [
          `${store} aprovou sua participação na campanha ${e.campaign}.`,
          `Seu cupom de divulgação é ${e.code}.`,
        ],
        cta: "Abrir o portal",
      };
    case "membership_rejected":
      return {
        subject: "Sua participação não foi aprovada",
        title: "Sua participação não foi aprovada",
        paragraphs: [`${store} não aprovou sua participação na campanha ${e.campaign}.`, "Em caso de dúvida, fale diretamente com a loja."],
        cta: "Abrir o portal",
      };
    case "invoice_approved":
      return {
        subject: "Nota fiscal aprovada",
        title: "Nota fiscal aprovada",
        paragraphs: [
          `${store} aprovou sua nota fiscal da competência ${periodLabel(e.period)}.`,
          "O pagamento da comissão está liberado e será registrado pela loja.",
        ],
        cta: "Ver minhas comissões",
      };
    case "invoice_rejected":
      return {
        subject: "Nota fiscal rejeitada — envie uma nova",
        title: "Nota fiscal rejeitada",
        paragraphs: [
          `${store} rejeitou sua nota fiscal da competência ${periodLabel(e.period)}.`,
          `Motivo: ${e.reason}`,
          "Envie uma nova nota pelo portal para liberar o pagamento.",
        ],
        cta: "Enviar nova nota",
      };
    case "payment_registered":
      return {
        subject: "Pagamento registrado",
        title: "Pagamento registrado",
        paragraphs: [
          `${store} registrou o pagamento da sua comissão da competência ${periodLabel(e.period)} (${e.net}).`,
          "Você pode baixar o comprovante no portal.",
        ],
        cta: "Ver comprovante",
      };
  }
}

/** Fire-and-forget: returns immediately; errors are only logged. */
export function notifyAffiliate(
  admin: SupabaseClient,
  request: Request,
  args: { clientId: string; affiliateId: string; event: AffiliateEvent },
): void {
  void (async () => {
    if (!isEmailConfigured()) return;
    const [affiliate, client] = await Promise.all([
      admin.from("aff_affiliates").select("name, email, status").eq("id", args.affiliateId).maybeSingle(),
      admin.from("aff_clients").select("name").eq("id", args.clientId).maybeSingle(),
    ]);
    if (!affiliate.data || affiliate.data.status !== "active") return;
    const c = affiliateContent(args.event, client.data?.name ?? "A loja");
    const url = `${baseUrl(request)}/portal/afiliado${args.event.kind === "membership_approved" || args.event.kind === "membership_rejected" ? "" : "/comissoes"}`;
    await sendEmail({
      to: affiliate.data.email,
      subject: `${c.subject} — Aureon`,
      text: `Olá, ${affiliate.data.name}.\n\n${c.paragraphs.join("\n\n")}\n\n${c.cta}: ${url}`,
      html: portalNotificationEmailHtml({ title: c.title, paragraphs: [`Olá, ${affiliate.data.name}.`, ...c.paragraphs], ctaLabel: c.cta, ctaUrl: url }),
    });
  })().catch((err) => console.error("[affiliates/notify] affiliate e-mail failed:", err instanceof Error ? err.message : err));
}

/** Tells the store's contact and its owner / finance people that an invoice is waiting. */
export function notifyStore(
  admin: SupabaseClient,
  request: Request,
  args: { clientId: string; event: StoreEvent },
): void {
  void (async () => {
    if (!isEmailConfigured()) return;
    const [client, people] = await Promise.all([
      admin.from("aff_clients").select("name, contact_email").eq("id", args.clientId).maybeSingle(),
      admin
        .from("aff_client_users")
        .select("email")
        .eq("client_id", args.clientId)
        .eq("status", "active")
        .in("role", ["owner", "finance"]),
    ]);
    const recipients = new Set<string>();
    if (client.data?.contact_email) recipients.add(client.data.contact_email.toLowerCase());
    for (const p of people.data ?? []) recipients.add(String(p.email).toLowerCase());
    if (recipients.size === 0) return;

    const e = args.event;
    const paragraphs = [`${e.affiliate} enviou a nota fiscal da competência ${periodLabel(e.period)}.`, "Confira o documento antes de liberar o pagamento."];
    const url = `${baseUrl(request)}/portal/loja/${args.clientId}/notas-fiscais`;
    await Promise.all(
      [...recipients].map((to) =>
        sendEmail({
          to,
          subject: "Nova nota fiscal para analisar — Aureon",
          text: `${paragraphs.join("\n\n")}\n\nAnalisar: ${url}`,
          html: portalNotificationEmailHtml({ title: "Nova nota fiscal para analisar", paragraphs, ctaLabel: "Analisar nota", ctaUrl: url }),
        }).catch((err) => console.error("[affiliates/notify] store e-mail failed:", err instanceof Error ? err.message : err)),
      ),
    );
  })().catch((err) => console.error("[affiliates/notify] store notification failed:", err instanceof Error ? err.message : err));
}
