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
