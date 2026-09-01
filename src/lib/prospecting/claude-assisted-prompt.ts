// ============================================================
// Prospecting: "Pesquisar com meu Claude" prompt builder.
//
// Generates a copy-pasteable research brief for a Claude session the
// USER already has (Claude Code/Desktop with browser/computer-use
// tools) to run for free — the user's own Claude does the actual web
// research, and hands the result back via the paste/upload path in
// `external-import.ts`. No OpenAI or Google Places call is involved
// on our side.
//
// The checklist text is drawn directly from Aureon's own commercial
// playbook (`Playbook_Aureon_Lead_Generation.docx` sections LG.08/
// LG.11/LG.12, `Playbook_Aureon_Ecommerce_AVR.docx` sections EC.11-13)
// rather than a generic "qualify this lead" instruction — the two
// frentes comerciais have genuinely different qualification criteria
// (a local service business vs. an already-selling online store), so
// the prompt branches on frente rather than using one shared checklist.
//
// Versioned like the other prompt content in this module
// (system-prompt.ts) so a future wording change can be tracked
// independently of a code deploy.
// ============================================================

import { PROSPECTING_TEMPLATE_COLUMNS } from "./external-import";

export const PROSPECTING_CLAUDE_ASSISTED_PROMPT_VERSION = "v1";

export type ProspectingFrente = "leadgen" | "avr";

export interface BuildClaudeResearchPromptArgs {
  frente: ProspectingFrente;
  /** Niche/segment description, e.g. "clínicas odontológicas". Optional — the user can fill it in if left blank. */
  niche?: string;
  /** Region/city, e.g. "Santo André, SP". Optional for the AVR frente, where region rarely matters. */
  region?: string;
  quantity: number;
}

const LEADGEN_CHECKLIST = `Para cada empresa, investigue e registre o que encontrar (nunca invente um dado que não encontrou):

- GOOGLE — Como a empresa aparece nas buscas? Tem boas avaliações? Quantas? Existem concorrentes anunciando no mesmo termo?
- INSTAGRAM — O perfil existe? A comunicação é profissional? Tem frequência de postagem? Quantos seguidores? Qual o engajamento aproximado (curtidas/comentários por post recente)? Quando foi a última publicação (perfil ativo ou abandonado)?
- SITE — Existe? Está atualizado? Funciona bem no celular? Tem uma chamada clara para contato (telefone, WhatsApp, formulário)?
- ANÚNCIOS — A empresa aparenta investir em mídia paga? Os concorrentes do nicho anunciam?
- REPUTAÇÃO — O que os clientes dizem nas avaliações? Existem provas sociais fortes?
- OFERTA — Fica claro o que a empresa vende e por que alguém a escolheria?
- CONVERSÃO — É fácil pedir orçamento, agendar ou falar com alguém?

A nota e o número de avaliações do Google vão em colunas próprias ("Nota do Google (0-5)" e "Avaliações do Google"), e o número de seguidores do Instagram vai na coluna própria "Seguidores do Instagram" — nunca só dentro do texto. Depois de investigar, registre na coluna "Observações / sinais encontrados" os outros sinais que encontrou (positivos e negativos) — por exemplo: "Instagram ativo mas sem oferta clara, site não é responsivo, fácil pedir orçamento pelo WhatsApp".

Sinais de bom prospect (quanto mais destes, melhor a oportunidade): demanda real pelo serviço, ticket médio que sustenta investimento em aquisição, capacidade de atender mais clientes, alguma oportunidade clara de melhoria na presença digital atual (site fraco ou ausente é uma OPORTUNIDADE, não um motivo para descartar).
Sinais de que talvez não valha a pena continuar: agenda já lotada sem intenção de crescer, ausência total de qualquer canal de contato, ou um problema estrutural do negócio que marketing não resolve.`;

const AVR_CHECKLIST = `Para cada loja virtual, investigue e registre o que encontrar (nunca invente um dado que não encontrou):

- PRODUTO E OPERAÇÃO — A loja já vende de fato (tem produtos publicados, preços, avaliações de compradores)? Parece uma operação ativa ou uma loja recém-criada/abandonada?
- ESTRUTURA DO SITE — A navegação funciona bem? O checkout parece simples? O site carrega rápido? Funciona bem no celular?
- PROVA SOCIAL — Existem avaliações de clientes nos produtos? Depoimentos?
- INSTAGRAM/REDES — O perfil existe e está ativo? Que tipo de conteúdo publica (só produto, ou também campanhas/promoções)? Engajamento aproximado? Última publicação?
- SINAIS DE MÍDIA PAGA — A loja aparenta anunciar (posts patrocinados, remarketing perceptível)?
- OPORTUNIDADE NO CICLO ATRAIA/VENDA/RETENHA — Existe algum sinal visível de que a loja não recupera carrinho, não tem e-mail/WhatsApp de recompra, ou não tem programa de fidelização? Isso é uma oportunidade comercial, não um defeito a ocultar.

A nota e o número de avaliações do Google (se a loja tiver Google Meu Negócio) vão em colunas próprias ("Nota do Google (0-5)" e "Avaliações do Google"), e o número de seguidores do Instagram vai na coluna própria "Seguidores do Instagram" — nunca só dentro do texto. Depois de investigar, registre na coluna "Observações / sinais encontrados" os outros sinais que encontrou (positivos e negativos) — por exemplo: "Loja ativa com +50 produtos e avaliações reais, Instagram só posta produto sem oferta, nenhum sinal de recuperação de carrinho".

Sinais de bom prospect (quanto mais destes, melhor a oportunidade): produto validado (já vende de verdade), operação com histórico real, margem aparente para investir em crescimento, e alguma lacuna clara no ciclo Atraia/Venda/Retenha que a Aureon possa resolver.
Sinais de que talvez não valha a pena continuar: loja claramente inativa/abandonada (sem posts ou produtos recentes), ou nenhuma evidência de vendas reais acontecendo.`;

function buildColumnsList(): string {
  return PROSPECTING_TEMPLATE_COLUMNS.map((c) => c.header).join(", ");
}

export function buildClaudeResearchPrompt(args: BuildClaudeResearchPromptArgs): string {
  const { frente, quantity } = args;
  const niche = args.niche?.trim();
  const region = args.region?.trim();
  const checklist = frente === "leadgen" ? LEADGEN_CHECKLIST : AVR_CHECKLIST;
  const frenteName = frente === "leadgen" ? "Lead Generation (negócios locais/serviços)" : "E-commerce AVR";

  const targetLine =
    frente === "leadgen"
      ? `Nicho: ${niche || "[preencha o nicho, ex.: clínicas odontológicas]"}\nRegião: ${region || "[preencha a cidade/região]"}`
      : `Segmento/nicho de loja virtual: ${niche || "[preencha o segmento, ex.: moda feminina]"}${region ? `\nRegião (se relevante): ${region}` : ""}`;

  return `Você vai me ajudar a pesquisar empresas reais na internet para a Aureon, uma agência de marketing e vendas. Use seu navegador para pesquisar de verdade — não invente nenhuma empresa nem nenhum dado.

CONTEXTO
A Aureon trabalha com duas frentes comerciais. Esta pesquisa é para a frente: ${frenteName}.

O QUE BUSCAR
${targetLine}
Quantidade alvo: aproximadamente ${quantity} empresas qualificadas (pode entregar menos se não encontrar o suficiente com qualidade real — nunca complete a lista com empresas fracas só para bater o número).

COMO INVESTIGAR CADA EMPRESA
${checklist}

REGRAS IMPORTANTES
- Nunca invente telefone, e-mail, site, número de seguidores, avaliação ou qualquer outro dado. Se não encontrar, deixe o campo em branco.
- Pesquise de verdade no navegador (Google, Google Maps, Instagram, o site da empresa) — não gere uma lista a partir de conhecimento genérico.
- Priorize qualidade sobre quantidade.

FORMATO DE SAÍDA
Devolva os resultados como uma tabela em CSV (separada por vírgula), com exatamente estas colunas, nesta ordem:
${buildColumnsList()}

Depois de gerar a tabela, eu vou colar sua resposta diretamente na tela de Prospecção do CRM, então mantenha o formato CSV limpo (sem texto antes ou depois da tabela, exceto se precisar avisar sobre alguma limitação encontrada).`;
}
