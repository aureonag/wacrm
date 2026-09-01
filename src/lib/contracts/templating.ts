// ============================================================
// Contrato: template variable substitution.
//
// Deliberately simple — no templating engine. The confirmed real-world
// templates (both provided by the user) are plain paragraphs with
// `{{variable}}` placeholders and nothing more sophisticated (no
// conditionals, loops, or nested lookups), so a single global regex
// replace covers the actual need without pulling in a dependency.
// ============================================================

export interface ContractTemplateVariable {
  key: string;
  /** Portuguese label shown next to the copyable placeholder in the template editor. */
  label: string;
}

/** The 5 confirmed legal fields — every `deal_contracts` row has all of these. */
export const CONTRACT_TEMPLATE_VARIABLES: ContractTemplateVariable[] = [
  { key: "razao_social_cliente", label: "Razão Social" },
  { key: "cnpj_cliente", label: "CNPJ" },
  { key: "endereco_cliente", label: "Endereço" },
  { key: "nome_representante_cliente", label: "Nome do representante" },
  { key: "cpf_representante_cliente", label: "CPF do representante" },
];

/**
 * Replaces every `{{key}}` occurrence with the matching value. Unknown
 * placeholders (a typo, or a variable removed from
 * CONTRACT_TEMPLATE_VARIABLES) are left as-is rather than silently
 * blanked — an obviously-wrong `{{...}}` left in the output is a much
 * easier bug to spot than a paragraph that quietly loses a clause.
 */
export function renderTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}
