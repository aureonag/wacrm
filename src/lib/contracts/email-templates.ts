// ============================================================
// Contrato: HTML for contract-related transactional emails.
//
// Plain string builders — table layout + inline styles, no
// react-email/mjml dependency, since this project only sends a
// couple of simple branded emails. Colors are the hex equivalents
// of the CRM's own dark-mode design tokens (see :root in
// globals.css) so the email reads as the same product as the
// public /contracts/[token] signing page, not a generic template.
// The logo is loaded from the production domain (email clients
// can't resolve relative/local paths).
// ============================================================

const LOGO_URL = "https://aureonag.com/brand/aureon-logo-white.png";

// Hex equivalents of the app's dark-mode tokens (--background,
// --card, --border, --foreground, --muted-foreground, --primary).
const COLORS = {
  background: "#05070b",
  card: "#0f1216",
  cardBorder: "#26292e",
  foreground: "#fafafa",
  muted: "#8c8f95",
  primary: "#7834e8",
  primarySoftBg: "rgba(120, 52, 232, 0.14)",
  primarySoftBorder: "rgba(120, 52, 232, 0.4)",
};

function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:${COLORS.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background};padding:40px 16px;">
      <tr>
        <td align="center">
          <img src="${LOGO_URL}" alt="Aureon" height="28" style="display:block;border:0;margin:0 0 28px;" />
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;border-top:1px solid ${COLORS.cardBorder};">
                <p style="margin:0;font-size:12px;color:${COLORS.muted};">Dúvidas? É só responder este e-mail.</p>
                <p style="margin:6px 0 0;font-size:12px;color:${COLORS.muted};">© ${new Date().getFullYear()} Aureon Publicidade</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function otpCodeEmailHtml(args: { code: string; contractTitle?: string }): string {
  const body = `
    <h1 style="margin:0 0 16px;font-size:20px;color:${COLORS.foreground};">Confirme sua assinatura</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.muted};line-height:1.6;">
      Use o código abaixo para confirmar o aceite eletrônico do seu contrato com a Aureon${
        args.contractTitle ? ` — <strong style="color:${COLORS.foreground};">${args.contractTitle}</strong>` : ""
      }.
    </p>
    <div style="margin:0 0 20px;text-align:center;">
      <span style="display:inline-block;padding:14px 28px;background:${COLORS.primarySoftBg};border:1px solid ${COLORS.primarySoftBorder};border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:${COLORS.foreground};">${args.code}</span>
    </div>
    <p style="margin:0;font-size:13px;color:${COLORS.muted};line-height:1.5;">Este código expira em 10 minutos. Se você não solicitou este código, pode ignorar este e-mail.</p>
  `;
  return emailShell(body);
}

// ------------------------------------------------------------
// Cancelamento de contrato assinado (minuta enviada ao cliente).
// Nunca inclui valores: so identifica o contrato e a data de efeito.
// ------------------------------------------------------------

export interface TerminationEmailArgs {
  razaoSocial: string;
  cnpj: string;
  representante: string;
  /** ISO timestamp of the signature, when known. */
  signedAt: string | null;
  /** Lines of the "Serviço contratado" section (no prices). */
  serviceLines: string[];
  /** YYYY-MM-DD — data do cancelamento (início do aviso prévio de 30 dias). */
  effectiveDate: string;
  note?: string | null;
  /** Short reference so both sides can find the contract. */
  contractRef: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Aviso prévio contratual, em dias corridos. */
export const NOTICE_DAYS = 30;

/** "2026-10-15" + n days -> "2026-11-14" (calendar arithmetic in UTC, no DST drift). */
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** "2026-10-15" or an ISO timestamp -> "15/10/2026". */
export function formatBrDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

export function terminationEmailSubject(razaoSocial: string): string {
  return `Comunicado de cancelamento de contrato — ${razaoSocial}`;
}

export function terminationEmailText(a: TerminationEmailArgs): string {
  const lines = [
    `Prezado(a) ${a.representante},`,
    "",
    `Comunicamos o cancelamento do contrato de prestação de serviços firmado entre ${a.razaoSocial} e a Aureon Publicidade Ltda.${
      a.signedAt ? `, assinado em ${formatBrDate(a.signedAt)}` : ""
    }.`,
    "",
    "DADOS DO CONTRATO",
    `Contratante: ${a.razaoSocial}`,
    `CNPJ: ${a.cnpj}`,
    `Representante legal: ${a.representante}`,
    ...(a.signedAt ? [`Data da assinatura: ${formatBrDate(a.signedAt)}`] : []),
    ...(a.serviceLines.length ? [`Serviço contratado: ${a.serviceLines.join("; ")}`] : []),
    `Referência: ${a.contractRef}`,
    "",
    `DATA DO CANCELAMENTO: ${formatBrDate(a.effectiveDate)}`,
    `AVISO PRÉVIO: ${NOTICE_DAYS} dias corridos, contados a partir da data do cancelamento.`,
    `TÉRMINO DO CONTRATO: ${formatBrDate(addDaysIso(a.effectiveDate, NOTICE_DAYS))}`,
    ...(a.note ? ["", "OBSERVAÇÕES", a.note] : []),
    "",
    "Durante o aviso prévio, os serviços descritos no contrato seguem sendo prestados e as condições do contrato assinado continuam valendo até a data de término.",
    "",
    "Agradecemos a parceria e permanecemos à disposição.",
    "",
    "Aureon Publicidade",
  ];
  return lines.join("\n");
}

export function terminationEmailHtml(a: TerminationEmailArgs): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:${COLORS.muted};white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;font-size:13px;color:${COLORS.foreground};">${escapeHtml(value)}</td></tr>`;
  const body = `
    <h1 style="margin:0 0 16px;font-size:20px;color:${COLORS.foreground};">Comunicado de cancelamento</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${COLORS.muted};line-height:1.6;">
      Prezado(a) <strong style="color:${COLORS.foreground};">${escapeHtml(a.representante)}</strong>, comunicamos o
      cancelamento do contrato de prestação de serviços firmado entre
      <strong style="color:${COLORS.foreground};">${escapeHtml(a.razaoSocial)}</strong> e a Aureon Publicidade Ltda.${
        a.signedAt ? `, assinado em ${formatBrDate(a.signedAt)}` : ""
      }.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;">
      ${row("Contratante", a.razaoSocial)}
      ${row("CNPJ", a.cnpj)}
      ${row("Representante", a.representante)}
      ${a.signedAt ? row("Assinado em", formatBrDate(a.signedAt)) : ""}
      ${a.serviceLines.length ? row("Serviço", a.serviceLines.join("; ")) : ""}
      ${row("Referência", a.contractRef)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td width="38%" valign="top" style="padding:14px;background:${COLORS.background};border:1px solid ${COLORS.cardBorder};border-radius:8px;">
          <div style="font-size:11px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:1px;">Cancelamento</div>
          <div style="margin-top:6px;font-size:18px;font-weight:700;color:${COLORS.foreground};">${formatBrDate(a.effectiveDate)}</div>
        </td>
        <td width="24%" align="center" valign="middle" style="padding:0 6px;">
          <div style="font-size:20px;line-height:20px;font-weight:700;color:${COLORS.primary};">${NOTICE_DAYS}</div>
          <div style="font-size:10px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:1px;">dias corridos</div>
          <div style="margin-top:2px;font-size:18px;line-height:18px;color:${COLORS.primary};">&#8594;</div>
        </td>
        <td width="38%" valign="top" style="padding:14px;background:${COLORS.primarySoftBg};border:2px solid ${COLORS.primary};border-radius:8px;">
          <div style="font-size:11px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:1px;">Término do contrato</div>
          <div style="margin-top:6px;font-size:22px;font-weight:800;color:${COLORS.foreground};">${formatBrDate(addDaysIso(a.effectiveDate, NOTICE_DAYS))}</div>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:13px;color:${COLORS.muted};line-height:1.6;">
      O aviso prévio é de <strong style="color:${COLORS.foreground};">${NOTICE_DAYS} dias corridos</strong>, contados a partir da data do cancelamento.
    </p>
    ${
      a.note
        ? `<p style="margin:0 0 16px;font-size:13px;color:${COLORS.muted};line-height:1.6;"><strong style="color:${COLORS.foreground};">Observações:</strong> ${escapeHtml(a.note)}</p>`
        : ""
    }
    <p style="margin:0 0 12px;font-size:13px;color:${COLORS.muted};line-height:1.6;">
      Durante o aviso prévio de ${NOTICE_DAYS} dias corridos, os serviços descritos no contrato seguem sendo prestados e as condições do contrato assinado continuam valendo até a data de término.
    </p>
    <p style="margin:0;font-size:13px;color:${COLORS.muted};line-height:1.6;">Agradecemos a parceria e permanecemos à disposição.</p>
  `;
  return emailShell(body);
}
