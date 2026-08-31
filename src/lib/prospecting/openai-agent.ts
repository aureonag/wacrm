// ============================================================
// Prospecting: the OpenAI Responses API agent loop.
//
// Isolated from `src/lib/ai/providers/*` on purpose (plan decision
// #5) — those stay a zero-dependency, non-streaming, Chat-Completions
// implementation used only by auto-reply/draft/playground. This file
// is the one place in the codebase allowed to import the official
// `openai` package, because the Responses API's native tool-calling +
// streaming loop would be substantial, error-prone code to hand-roll.
//
// The account's OpenAI key still comes from the exact same place as
// every other AI feature — `loadAiConfig()` / `ai_configs` — so a
// fresh `OpenAI` client is constructed PER CALL with that account's
// decrypted key, never as a module-level singleton (a singleton would
// leak one account's key into a concurrent request for another).
// ============================================================

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai/usage";
import { PROSPECTING_SYSTEM_PROMPT } from "./system-prompt";
import { PROSPECTING_TOOL_SCHEMAS } from "./tool-schemas";
import { listarFrentes, listarPipelines, listarResponsaveis, obterPrimeiraEtapa } from "./tools/pipelines";
import { pesquisarEmpresas } from "./tools/search";
import { enriquecerGoogle, analisarSite, localizarInstagram } from "./tools/enrichment";
import { verificarDuplicidade } from "./tools/dedupe";
import { pontuarIcp } from "./tools/scoring";
import { consultarStatusDaPesquisa, cancelarPesquisa } from "./tools/status";
import { ProspectingToolError } from "./tools/errors";

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStreamHandlers {
  onTextDelta: (delta: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string, result: unknown, error?: string) => void;
  onDone: (finalText: string) => void;
  onError: (message: string) => void;
}

type ToolDispatch = (
  db: SupabaseClient,
  accountId: string,
  userId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// `criar_contatos_e_negocios`/`preparar_importacao` are not wired yet
// (the import flow lands in a later milestone) — calling either
// returns a clear "not available yet" error to the model instead of
// throwing.
const TOOL_HANDLERS: Record<string, ToolDispatch> = {
  listar_pipelines: (db) => listarPipelines(db),
  obter_primeira_etapa: (db, accountId, _userId, toolArgs) => obterPrimeiraEtapa(db, accountId, toolArgs),
  listar_responsaveis: (db) => listarResponsaveis(db),
  listar_frentes: () => Promise.resolve(listarFrentes()),
  pesquisar_empresas: (db, accountId, userId, toolArgs) => pesquisarEmpresas(db, accountId, userId, toolArgs),
  enriquecer_google: (db, accountId, _userId, toolArgs) => enriquecerGoogle(db, accountId, toolArgs),
  analisar_site: (db, accountId, _userId, toolArgs) => analisarSite(db, accountId, toolArgs),
  localizar_instagram: (db, accountId, _userId, toolArgs) => localizarInstagram(db, accountId, toolArgs),
  verificar_duplicidade: (db, accountId, _userId, toolArgs) => verificarDuplicidade(db, accountId, toolArgs),
  pontuar_icp: (db, accountId, _userId, toolArgs) => pontuarIcp(db, accountId, toolArgs),
  consultar_status_da_pesquisa: (db, accountId, _userId, toolArgs) => consultarStatusDaPesquisa(db, accountId, toolArgs),
  cancelar_pesquisa: (db, accountId, _userId, toolArgs) => cancelarPesquisa(db, accountId, toolArgs),
};

// Guards against a pathological tool-call loop (the model repeatedly
// calling tools without ever producing a final answer) from running
// away — each round is one Responses API call.
const MAX_TOOL_ROUNDS = 6;

export interface RunProspectingTurnArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  apiKey: string;
  model: string;
  provider: string;
  history: AgentChatMessage[];
  handlers: AgentStreamHandlers;
}

export async function runProspectingTurn(args: RunProspectingTurnArgs): Promise<void> {
  const { db, accountId, userId, apiKey, model, provider, history, handlers } = args;

  if (provider !== "openai") {
    handlers.onError(
      "A Prospecção funciona apenas com um provedor OpenAI configurado em Agentes de IA — a conta está configurada com outro provedor.",
    );
    return;
  }

  const client = new OpenAI({ apiKey });

  let input: OpenAI.Responses.ResponseInput = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  let previousResponseId: string | undefined;
  let finalText = "";
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let round = 0;
  let ranOutOfRounds = false;

  try {
    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const stream = await client.responses.create({
        model,
        instructions: PROSPECTING_SYSTEM_PROMPT,
        input,
        tools: PROSPECTING_TOOL_SCHEMAS,
        previous_response_id: previousResponseId,
        stream: true,
      });

      let roundText = "";
      const functionCalls: { call_id: string; name: string; arguments: string }[] = [];
      let responseId: string | undefined;
      let usage: OpenAI.Responses.ResponseUsage | undefined;

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          roundText += event.delta;
          handlers.onTextDelta(event.delta);
        } else if (event.type === "response.completed") {
          responseId = event.response.id;
          usage = event.response.usage;
          for (const item of event.response.output) {
            if (item.type === "function_call") {
              functionCalls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments });
            }
          }
        } else if (event.type === "response.failed" || event.type === "response.incomplete") {
          throw new Error("A resposta do modelo falhou ou ficou incompleta.");
        }
      }

      if (usage) {
        totalUsage.promptTokens += usage.input_tokens;
        totalUsage.completionTokens += usage.output_tokens;
        totalUsage.totalTokens += usage.total_tokens;
      }
      finalText += roundText;
      previousResponseId = responseId;

      if (functionCalls.length === 0) {
        handlers.onDone(finalText);
        break;
      }

      const outputItems: OpenAI.Responses.ResponseInputItem[] = [];
      for (const call of functionCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          // Leave empty — the handler's own validation will reject
          // missing required fields with a clear message.
        }
        handlers.onToolCall(call.name, parsedArgs);

        const handler = TOOL_HANDLERS[call.name];
        let output: unknown;
        let errorMessage: string | undefined;
        if (!handler) {
          errorMessage = "Esta ferramenta ainda não está disponível nesta versão do módulo.";
        } else {
          try {
            output = await handler(db, accountId, userId, parsedArgs);
          } catch (err) {
            errorMessage =
              err instanceof ProspectingToolError ? err.message : "Falha ao executar a ferramenta.";
          }
        }

        handlers.onToolResult(call.name, output, errorMessage);
        outputItems.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(errorMessage ? { error: errorMessage } : (output ?? {})),
        });
      }

      input = outputItems;
      if (round === MAX_TOOL_ROUNDS) ranOutOfRounds = true;
    }

    if (ranOutOfRounds) {
      handlers.onError("O agente encadeou chamadas de ferramenta demais nesta rodada. Tente reformular o pedido.");
    }
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "Erro inesperado ao conversar com o agente.");
  } finally {
    if (totalUsage.totalTokens > 0) {
      void logAiUsage(db, {
        accountId,
        // `ai_usage_log.conversation_id` FKs to the WhatsApp inbox
        // `conversations` table, not `prospecting_conversations` — a
        // prospecting conversation id here would violate that FK.
        conversationId: null,
        mode: "prospecting",
        provider: "openai",
        model,
        usage: totalUsage,
      });
    }
  }
}
