// ============================================================
// Signed-contract PDF — generated once, right after a client signs
// (virtual-acceptance flow), to (a) store in the `contracts` Storage
// bucket as the durable record behind `deal_contracts.signed_pdf_path`,
// and (b) attach to the confirmation emails sent to the client and to
// the deal's responsible salesperson (Allan, 2026-09-30).
//
// Visual design mirrors the public /contracts/[token] review page
// (party cards, tinted section cards by tone, highlighted "Resumo"
// table) — Allan's own words: it should look like the same product,
// "simples, bonito", not a plain black-and-white text dump (2026-09-30).
//
// @react-pdf/renderer draws PDFs with its own layout engine (no
// headless browser) — safe on Hostinger's build container, which has
// already shown it can't tolerate a spawned-subprocess renderer (see
// the 2026-09-29 Turbopack/webpack note in AGENTS.md). Uses the
// built-in standard PDF fonts (Helvetica) — no font files to ship or
// register.
//
// Reuses parseContractSections() (render-sections.ts) — the same
// parser that drives the on-screen ContractDocument — so the PDF's
// section structure never drifts from what the client reviewed before
// signing.
// ============================================================

import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import {
  parseContractSections,
  toTitleCase,
  type ContractSection,
  type ContractSectionTone,
} from "@/lib/contracts/render-sections";
import { AUREON_PARTY } from "@/lib/contracts/aureon-party";

// Same as contract-document.tsx's PARTY_HEADINGS — the template's own
// CONTRATANTE/CONTRATADA sections are dropped from the body since this
// PDF already shows that data as the two cards above, same reasoning
// as the public review page's `hideParties`.
//
// Also drops a section literally headed with Aureon's own party name:
// at least one real template writes the CONTRATADA block as a heading
// with no body ("## CONTRATADA" alone), followed by "**AUREON
// PUBLICIDADE LTDA**" as its own paragraph — after markdown cleanup
// that line has no lowercase letters and no colon, so isHeadingLine()
// mistakes it for a second heading and it survives as a stray section
// (Allan, 2026-09-30).
const PARTY_HEADINGS = new Set(["contratante", "contratada"]);

// Loaded from the production domain, same pattern as email-templates.ts's
// LOGO_URL — @react-pdf/renderer fetches images over HTTP(S) at render
// time, and a local filesystem path isn't reliably resolvable in every
// runtime this generator runs in (Allan, 2026-09-30).
const LOGO_URL = "https://aureonag.com/brand/aureon-logo-black.png";

function isPartySection(heading: string): boolean {
  const normalized = heading.trim().toLowerCase();
  return PARTY_HEADINGS.has(normalized) || normalized === AUREON_PARTY.name.toLowerCase();
}

export interface SignedContractPdfArgs {
  refCode: string;
  razaoSocial: string;
  cnpj: string;
  endereco: string;
  nomeRepresentante: string;
  cpfRepresentante: string;
  renderedContent: string;
  /** ISO timestamp. */
  signedAt: string;
  signedIp: string | null;
}

// Same palette as the public review page's "paper" theme
// (contract-document.tsx) and the brand purple already used in
// contract emails (email-templates.ts) — one visual identity across
// the review page, the emails, and this PDF.
const COLORS = {
  brand: "#7834e8",
  brandSoft: "#f4effc",
  ink: "#171717",
  body: "#404040",
  muted: "#8a8a8a",
  border: "#e5e5e5",
  info: "#eff6ff",
  infoBorder: "#bfdbfe",
  infoText: "#1e3a8a",
  warning: "#fffbeb",
  warningBorder: "#fde68a",
  warningText: "#78350f",
  success: "#ecfdf5",
  successBorder: "#a7f3d0",
  successText: "#065f46",
};

const TONE_STYLE: Record<ContractSectionTone, { bg: string; border: string; heading: string }> = {
  info: { bg: COLORS.info, border: COLORS.infoBorder, heading: COLORS.infoText },
  warning: { bg: COLORS.warning, border: COLORS.warningBorder, heading: COLORS.warningText },
  default: { bg: "#fafafa", border: COLORS.border, heading: COLORS.ink },
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 44,
    paddingHorizontal: 44,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.body,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.brand,
    marginBottom: 20,
  },
  logo: {
    // Source is 2457×423px (aspect ratio 5.809) — height derived from
    // that ratio so the logo never looks stretched.
    width: 110,
    height: 18.9,
  },
  refBadge: {
    fontSize: 8,
    color: COLORS.muted,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    textAlign: "center",
    marginBottom: 8,
  },
  intro: {
    marginBottom: 4,
    textAlign: "center",
    color: COLORS.muted,
    lineHeight: 1.5,
    fontSize: 9.5,
  },
  partyRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    marginBottom: 16,
  },
  partyCard: {
    flex: 1,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#fafafa",
  },
  partyLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
    letterSpacing: 1,
    marginBottom: 5,
  },
  partyName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
    marginBottom: 3,
  },
  partyLine: {
    fontSize: 9,
    color: COLORS.body,
    lineHeight: 1.4,
    marginBottom: 1,
  },
  section: {
    marginBottom: 10,
    borderRadius: 4,
    borderWidth: 1,
    padding: 10,
    paddingLeft: 12,
  },
  heading: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  paragraph: {
    lineHeight: 1.5,
    marginBottom: 3,
  },
  listItem: {
    lineHeight: 1.5,
    marginBottom: 3,
    paddingLeft: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    fontSize: 9.5,
    color: COLORS.body,
  },
  summaryLabelHighlight: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.ink,
  },
  summaryValue: {
    fontSize: 9.5,
    color: COLORS.ink,
  },
  summaryValueHighlight: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand,
  },
  signatureBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.successBorder,
    backgroundColor: COLORS.success,
  },
  signatureBadge: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: COLORS.successText,
    marginBottom: 5,
  },
  signatureLine: {
    fontSize: 8.5,
    lineHeight: 1.5,
    color: COLORS.body,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    fontSize: 7.5,
    color: COLORS.muted,
  },
});

function formatSignedAtPtBr(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const time = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${date} às ${time}`;
}

interface SummaryRow {
  label: string;
  value: string;
}

/** Mirrors contract-document.tsx's parseSummaryRows — same "RESUMO" convention, same rendering rule. */
function parseSummaryRows(section: ContractSection): SummaryRow[] | null {
  if (!/RESUMO/i.test(section.heading)) return null;
  const lines = section.blocks.flatMap((b) => (b.type === "paragraph" ? b.lines : []));
  if (lines.length === 0) return null;
  const rows: SummaryRow[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    rows.push({ label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return rows;
}

function isHighlightRow(label: string): boolean {
  return /investimento|total/i.test(label);
}

function PartyCard({ label, name, lines }: { label: string; name: string; lines: string[] }) {
  return (
    <View style={styles.partyCard}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={styles.partyName}>{name}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={styles.partyLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function SignedContractPdfDocument(props: SignedContractPdfArgs) {
  const parsed = parseContractSections(props.renderedContent);
  const sections = parsed.sections.filter((s) => !isPartySection(s.heading));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow} fixed>
          <Image src={LOGO_URL} style={styles.logo} />
          <Text style={styles.refBadge}>Contrato Nº {props.refCode}</Text>
        </View>

        {parsed.title && <Text style={styles.title}>{toTitleCase(parsed.title)}</Text>}
        {parsed.intro.map((block, i) => (
          <Text key={i} style={styles.intro}>
            {block.join(" ")}
          </Text>
        ))}

        <View style={styles.partyRow} wrap={false}>
          <PartyCard
            label="CONTRATANTE"
            name={props.razaoSocial}
            lines={[
              `CNPJ ${props.cnpj}`,
              props.endereco,
              `${props.nomeRepresentante} · CPF ${props.cpfRepresentante}`,
            ]}
          />
          <PartyCard
            label="CONTRATADA"
            name={AUREON_PARTY.name}
            lines={[`CNPJ ${AUREON_PARTY.cnpj}`, AUREON_PARTY.representative, AUREON_PARTY.email]}
          />
        </View>

        {sections.map((section, i) => {
          const summaryRows = parseSummaryRows(section);
          const tone = TONE_STYLE[section.tone];

          if (summaryRows) {
            return (
              <View
                key={i}
                style={[styles.section, { backgroundColor: "#fff", borderColor: COLORS.border }]}
                wrap={false}
              >
                <Text style={[styles.heading, { color: tone.heading }]}>{toTitleCase(section.heading)}</Text>
                {summaryRows.map((row, k) => {
                  const highlight = isHighlightRow(row.label);
                  const isLast = k === summaryRows.length - 1;
                  return (
                    <View key={k} style={[styles.summaryRow, isLast ? styles.summaryRowLast : undefined]}>
                      <Text style={highlight ? styles.summaryLabelHighlight : styles.summaryLabel}>
                        {row.label}
                      </Text>
                      <Text style={highlight ? styles.summaryValueHighlight : styles.summaryValue}>
                        {row.value}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          }

          return (
            <View
              key={i}
              style={[styles.section, { backgroundColor: tone.bg, borderColor: tone.border }]}
              wrap={false}
            >
              <Text style={[styles.heading, { color: tone.heading }]}>{toTitleCase(section.heading)}</Text>
              {section.blocks.map((block, j) =>
                block.type === "list" ? (
                  <View key={j}>
                    {block.items.map((item, k) => (
                      <Text key={k} style={styles.listItem}>
                        • {item}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <View key={j}>
                    {block.lines.map((line, k) => (
                      <Text key={k} style={styles.paragraph}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ),
              )}
            </View>
          );
        })}

        <View style={styles.signatureBox} wrap={false}>
          <Text style={styles.signatureBadge}>✓ Assinatura eletrônica confirmada</Text>
          <Text style={styles.signatureLine}>
            Assinado por {props.nomeRepresentante} (CPF {props.cpfRepresentante}), representante de{" "}
            {props.razaoSocial} (CNPJ {props.cnpj}).
          </Text>
          <Text style={styles.signatureLine}>Em {formatSignedAtPtBr(props.signedAt)}.</Text>
          {props.signedIp && <Text style={styles.signatureLine}>Endereço IP: {props.signedIp}.</Text>}
        </View>

        <View style={styles.footer} fixed>
          <Text>Aureon Publicidade · contrato assinado eletronicamente · Ref. {props.refCode}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateSignedContractPdf(args: SignedContractPdfArgs): Promise<Buffer> {
  return renderToBuffer(<SignedContractPdfDocument {...args} />);
}
