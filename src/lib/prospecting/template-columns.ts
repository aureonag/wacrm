// ============================================================
// Prospecting: the spreadsheet/paste template's column definitions.
//
// Pulled out of `external-import.ts` on its own — that module pulls in
// `exceljs`, the engine, and (transitively, via `website-analyzer.ts`)
// `node:dns/promises` through `webhooks/ssrf.ts`. `claude-assisted-prompt.ts`
// is imported from a "use client" component (`prospecting-external-import.tsx`)
// and only ever needed this one constant, but importing it from
// `external-import.ts` dragged that whole server-only dependency graph
// into the client bundle — Turbopack fails hard on the `node:` import
// there (webpack silently tolerated it). Keeping this data here, with no
// imports of its own, makes it safe to import from client code.
// ============================================================

export interface TemplateColumn {
  key: string;
  header: string;
  required: boolean;
  /** Lowercase, accent-stripped header variants accepted on import. */
  aliases: string[];
}

export const PROSPECTING_TEMPLATE_COLUMNS: TemplateColumn[] = [
  { key: "company_name", header: "Nome da empresa", required: true, aliases: ["nome da empresa", "empresa", "company_name", "company", "nome"] },
  { key: "contact_name", header: "Nome do contato", required: false, aliases: ["nome do contato", "contato", "contact_name"] },
  { key: "segment", header: "Segmento", required: false, aliases: ["segmento", "nicho", "segment"] },
  { key: "phone", header: "Telefone", required: false, aliases: ["telefone", "phone", "fone", "celular"] },
  { key: "email", header: "E-mail", required: false, aliases: ["e-mail", "email"] },
  { key: "website", header: "Site", required: false, aliases: ["site", "website", "url"] },
  { key: "instagram", header: "Instagram", required: false, aliases: ["instagram"] },
  {
    key: "instagram_followers",
    header: "Seguidores do Instagram",
    required: false,
    aliases: [
      "seguidores do instagram",
      "seguidores instagram",
      "numero de seguidores",
      "número de seguidores",
      "instagram followers",
    ],
  },
  { key: "city", header: "Cidade", required: false, aliases: ["cidade", "city"] },
  { key: "state", header: "Estado", required: false, aliases: ["estado", "uf", "state"] },
  { key: "address", header: "Endereço", required: false, aliases: ["endereço", "endereco", "address"] },
  {
    key: "google_rating",
    header: "Nota do Google (0-5)",
    required: false,
    aliases: ["nota do google (0-5)", "nota do google", "avaliação do google", "google rating", "nota google"],
  },
  {
    key: "google_review_count",
    header: "Avaliações do Google",
    required: false,
    aliases: [
      "avaliações do google",
      "avaliacoes do google",
      "número de avaliações",
      "numero de avaliacoes",
      "quantidade de avaliações",
      "google review count",
    ],
  },
  {
    key: "notes",
    header: "Observações / sinais encontrados",
    required: false,
    // Matches the free-text qualification column the "pesquisar com Claude"
    // prompt asks for — kept in `source_data.external_notes` (not a
    // dedicated column) so it survives round-tripping without a migration.
    aliases: [
      "observacoes",
      "observações",
      "observacoes / sinais encontrados",
      "sinais encontrados",
      "potencial",
      "justificativa",
      "notas",
      "notes",
    ],
  },
];
