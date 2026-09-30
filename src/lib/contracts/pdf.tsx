// ============================================================
// Signed-contract PDF — generated once, right after a client signs
// (virtual-acceptance flow), to (a) store in the `contracts` Storage
// bucket as the durable record behind `deal_contracts.signed_pdf_path`,
// and (b) attach to the confirmation emails sent to the client and to
// the deal's responsible salesperson (Allan, 2026-09-30).
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

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { parseContractSections, toTitleCase } from "@/lib/contracts/render-sections";

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

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  title: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 12,
  },
  intro: {
    marginBottom: 14,
    textAlign: "center",
    color: "#404040",
    lineHeight: 1.5,
  },
  section: {
    marginBottom: 12,
  },
  heading: {
    fontSize: 11.5,
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
  signatureBox: {
    marginTop: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: "#c9c9c9",
    borderStyle: "solid",
    borderRadius: 4,
  },
  signatureTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  signatureLine: {
    lineHeight: 1.5,
    color: "#404040",
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

function SignedContractPdfDocument(props: SignedContractPdfArgs) {
  const parsed = parseContractSections(props.renderedContent);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {parsed.title && <Text style={styles.title}>{toTitleCase(parsed.title)}</Text>}
        {parsed.intro.map((block, i) => (
          <Text key={i} style={styles.intro}>
            {block.join(" ")}
          </Text>
        ))}

        {parsed.sections.map((section, i) => (
          <View key={i} style={styles.section} wrap={false}>
            <Text style={styles.heading}>{toTitleCase(section.heading)}</Text>
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
        ))}

        <View style={styles.signatureBox} wrap={false}>
          <Text style={styles.signatureTitle}>Assinatura eletrônica</Text>
          <Text style={styles.signatureLine}>
            Assinado por {props.nomeRepresentante} (CPF {props.cpfRepresentante}), representante de{" "}
            {props.razaoSocial} (CNPJ {props.cnpj}).
          </Text>
          <Text style={styles.signatureLine}>Em {formatSignedAtPtBr(props.signedAt)}.</Text>
          {props.signedIp && <Text style={styles.signatureLine}>Endereço IP: {props.signedIp}.</Text>}
          <Text style={styles.signatureLine}>Referência: {props.refCode}.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateSignedContractPdf(args: SignedContractPdfArgs): Promise<Buffer> {
  return renderToBuffer(<SignedContractPdfDocument {...args} />);
}
