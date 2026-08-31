// ============================================================
// Prospecting: function-calling tool schemas for the OpenAI Responses
// API agent.
//
// Names stay in Portuguese — they're the agent's domain vocabulary,
// not a code-navigation concern (mirrors how the client's spec frames
// them). Every argument the model can pass is validated again,
// server-side, by the tool's actual handler in `tools/*.ts` — a
// schema only bounds the *shape* the model may send, it is never
// trusted as an authorization check.
//
// All tools are wired to a real handler in `openai-agent.ts` except
// `preparar_importacao`/`criar_contatos_e_negocios`, which land with
// the import flow in a later milestone (they return a clear "not
// available yet" tool error until then).
// ============================================================

import { PROSPECTING_MAX_QUANTITY, PROSPECTING_MIN_QUANTITY } from "./constants";

export interface ProspectingToolSchema {
  type: "function";
  name: string;
  description: string;
  // Not every tool has every property required (e.g. `pesquisar_empresas`'s
  // priority criteria are optional), so strict structured-outputs mode
  // is off — arguments are still fully validated by the tool handler
  // itself, never trusted just because they matched the schema shape.
  strict: false;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export const PROSPECTING_TOOL_SCHEMAS: ProspectingToolSchema[] = [
  {
    type: "function",
    strict: false,
    name: "listar_pipelines",
    description: "Lista os pipelines de vendas acessíveis à conta autenticada.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    strict: false,
    name: "obter_primeira_etapa",
    description:
      "Retorna a primeira etapa (menor posição) de um pipeline, para onde os negócios importados serão inseridos.",
    parameters: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "ID do pipeline, obtido via listar_pipelines." },
      },
      required: ["pipeline_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "listar_responsaveis",
    description: "Lista os membros da conta que podem ser definidos como responsáveis pelos negócios importados.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    strict: false,
    name: "listar_frentes",
    description:
      "Lista as frentes comerciais disponíveis (Lead Generation e E-commerce AVR — conjunto fixo, uma ou ambas podem ser selecionadas).",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    strict: false,
    name: "pesquisar_empresas",
    description:
      "Inicia uma busca de empresas em segundo plano a partir de nicho, região e critérios comerciais. Retorna imediatamente com o ID da execução — o resultado completo chega de forma assíncrona.",
    parameters: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "Pipeline de destino, já validado nesta conversa." },
        niche: { type: "string", description: "Nicho/segmento das empresas buscadas." },
        region: { type: "string", description: "Região geográfica da busca (cidade, estado ou região)." },
        quantity: {
          type: "integer",
          minimum: PROSPECTING_MIN_QUANTITY,
          maximum: PROSPECTING_MAX_QUANTITY,
          description: "Quantidade de empresas desejada (o número de candidatos válidos pode ser menor).",
        },
        required_criteria: {
          type: "array",
          items: { type: "string" },
          description: "Critérios obrigatórios explicitados pelo usuário.",
        },
        priority_criteria: {
          type: "array",
          items: { type: "string" },
          description: "Critérios de prioridade/desejáveis explicitados pelo usuário.",
        },
      },
      required: ["pipeline_id", "niche", "region", "quantity"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "enriquecer_google",
    description: "Enriquece um candidato com dados do Google Places (avaliação, telefone, site, endereço).",
    parameters: {
      type: "object",
      properties: { candidate_id: { type: "string" } },
      required: ["candidate_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "analisar_site",
    description: "Analisa o site de um candidato em busca de sinais públicos de presença digital.",
    parameters: {
      type: "object",
      properties: { candidate_id: { type: "string" } },
      required: ["candidate_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "localizar_instagram",
    description: "Tenta localizar o perfil do Instagram de um candidato a partir do site e de outras fontes permitidas.",
    parameters: {
      type: "object",
      properties: { candidate_id: { type: "string" } },
      required: ["candidate_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "verificar_duplicidade",
    description: "Verifica se um candidato já existe como contato/negócio na conta (Place ID, domínio, telefone, Instagram, e-mail ou nome+cidade).",
    parameters: {
      type: "object",
      properties: { candidate_id: { type: "string" } },
      required: ["candidate_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "pontuar_icp",
    description: "Calcula o score de aderência ao ICP (0-100, nota A/B/C) de um candidato já enriquecido.",
    parameters: {
      type: "object",
      properties: { candidate_id: { type: "string" } },
      required: ["candidate_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "preparar_importacao",
    description: "Retorna um resumo dos candidatos selecionados para revisão antes da importação (sem gravar nada ainda).",
    parameters: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        candidate_ids: { type: "array", items: { type: "string" } },
      },
      required: ["run_id", "candidate_ids"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "criar_contatos_e_negocios",
    description:
      "Cria contatos e negócios reais no CRM a partir dos candidatos aprovados pelo usuário. Requer autorização explícita do usuário na conversa antes de ser chamada.",
    parameters: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        candidate_ids: { type: "array", items: { type: "string" } },
      },
      required: ["run_id", "candidate_ids"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "consultar_status_da_pesquisa",
    description: "Consulta o status e o progresso atual de uma execução de pesquisa.",
    parameters: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    strict: false,
    name: "cancelar_pesquisa",
    description: "Cancela uma execução de pesquisa em andamento.",
    parameters: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
];
