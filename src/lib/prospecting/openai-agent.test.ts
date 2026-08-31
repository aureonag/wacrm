import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  logAiUsage: vi.fn(),
  listarPipelines: vi.fn(),
  obterPrimeiraEtapa: vi.fn(),
  listarResponsaveis: vi.fn(),
  listarFrentes: vi.fn(),
  pesquisarEmpresas: vi.fn(),
  enriquecerGoogle: vi.fn(),
  analisarSite: vi.fn(),
  localizarInstagram: vi.fn(),
  verificarDuplicidade: vi.fn(),
  pontuarIcp: vi.fn(),
  consultarStatusDaPesquisa: vi.fn(),
  cancelarPesquisa: vi.fn(),
  prepararImportacao: vi.fn(),
  criarContatosENegocios: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: mocks.create };
  },
}));

vi.mock("@/lib/ai/usage", () => ({ logAiUsage: mocks.logAiUsage }));

vi.mock("./tools/pipelines", () => ({
  listarPipelines: mocks.listarPipelines,
  obterPrimeiraEtapa: mocks.obterPrimeiraEtapa,
  listarResponsaveis: mocks.listarResponsaveis,
  listarFrentes: mocks.listarFrentes,
}));
vi.mock("./tools/search", () => ({ pesquisarEmpresas: mocks.pesquisarEmpresas }));
vi.mock("./tools/enrichment", () => ({
  enriquecerGoogle: mocks.enriquecerGoogle,
  analisarSite: mocks.analisarSite,
  localizarInstagram: mocks.localizarInstagram,
}));
vi.mock("./tools/dedupe", () => ({ verificarDuplicidade: mocks.verificarDuplicidade }));
vi.mock("./tools/scoring", () => ({ pontuarIcp: mocks.pontuarIcp }));
vi.mock("./tools/status", () => ({
  consultarStatusDaPesquisa: mocks.consultarStatusDaPesquisa,
  cancelarPesquisa: mocks.cancelarPesquisa,
}));
vi.mock("./tools/import", () => ({
  prepararImportacao: mocks.prepararImportacao,
  criarContatosENegocios: mocks.criarContatosENegocios,
}));

import { runProspectingTurn } from "./openai-agent";
import { ProspectingToolError } from "./tools/errors";

function textOnlyStream(text: string, responseId = "resp-1") {
  return (async function* () {
    yield { type: "response.output_text.delta", delta: text };
    yield {
      type: "response.completed",
      response: {
        id: responseId,
        output: [],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    };
  })();
}

function toolCallStream(name: string, args: Record<string, unknown>, responseId = "resp-1") {
  return (async function* () {
    yield {
      type: "response.completed",
      response: {
        id: responseId,
        output: [{ type: "function_call", call_id: "call-1", name, arguments: JSON.stringify(args) }],
        usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      },
    };
  })();
}

function handlers() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.logAiUsage.mockReset();
  mocks.listarPipelines.mockReset();
  mocks.obterPrimeiraEtapa.mockReset();
  mocks.listarResponsaveis.mockReset();
  mocks.listarFrentes.mockReset();
  mocks.pesquisarEmpresas.mockReset();
  mocks.enriquecerGoogle.mockReset();
  mocks.analisarSite.mockReset();
  mocks.localizarInstagram.mockReset();
  mocks.verificarDuplicidade.mockReset();
  mocks.pontuarIcp.mockReset();
  mocks.consultarStatusDaPesquisa.mockReset();
  mocks.cancelarPesquisa.mockReset();
  mocks.prepararImportacao.mockReset();
  mocks.criarContatosENegocios.mockReset();
});

describe("runProspectingTurn", () => {
  it("streams text deltas and calls onDone with the full text when there are no tool calls", async () => {
    mocks.create.mockResolvedValue(textOnlyStream("Olá! Como posso ajudar?"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [{ role: "user", content: "oi" }],
      handlers: h,
    });

    expect(h.onTextDelta).toHaveBeenCalledWith("Olá! Como posso ajudar?");
    expect(h.onDone).toHaveBeenCalledWith("Olá! Como posso ajudar?");
    expect(h.onError).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.logAiUsage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        accountId: "acct-1",
        conversationId: null,
        mode: "prospecting",
        provider: "openai",
        model: "gpt-5.4-mini",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    );
  });

  it("rejects immediately when the account's configured provider isn't openai, without calling the API", async () => {
    const h = handlers();
    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "claude-x",
      provider: "anthropic",
      history: [],
      handlers: h,
    });
    expect(h.onError).toHaveBeenCalledWith(expect.stringContaining("OpenAI"));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("executes a tool call, feeds the output back as a second round, and finishes on the model's follow-up text", async () => {
    mocks.listarPipelines.mockResolvedValue([{ id: "p1", name: "Vendas" }]);
    mocks.create
      .mockResolvedValueOnce(toolCallStream("listar_pipelines", {}))
      .mockResolvedValueOnce(textOnlyStream("Encontrei o pipeline Vendas.", "resp-2"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [{ role: "user", content: "quais pipelines eu tenho?" }],
      handlers: h,
    });

    expect(mocks.listarPipelines).toHaveBeenCalled();
    expect(h.onToolCall).toHaveBeenCalledWith("listar_pipelines", {});
    expect(h.onToolResult).toHaveBeenCalledWith("listar_pipelines", [{ id: "p1", name: "Vendas" }], undefined);
    expect(h.onDone).toHaveBeenCalledWith("Encontrei o pipeline Vendas.");
    expect(mocks.create).toHaveBeenCalledTimes(2);

    // Second call must chain off the first response and send only the
    // tool output, not the full history again.
    const secondCallArgs = mocks.create.mock.calls[1][0];
    expect(secondCallArgs.previous_response_id).toBe("resp-1");
    expect(secondCallArgs.input).toEqual([
      { type: "function_call_output", call_id: "call-1", output: JSON.stringify([{ id: "p1", name: "Vendas" }]) },
    ]);
  });

  it("reports a tool handler's ProspectingToolError message back to the model instead of throwing", async () => {
    mocks.obterPrimeiraEtapa.mockRejectedValue(new ProspectingToolError("Pipeline não encontrado.", "pipeline_not_found"));
    mocks.create
      .mockResolvedValueOnce(toolCallStream("obter_primeira_etapa", { pipeline_id: "bad-id" }))
      .mockResolvedValueOnce(textOnlyStream("Não encontrei esse pipeline.", "resp-2"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [],
      handlers: h,
    });

    expect(h.onToolResult).toHaveBeenCalledWith("obter_primeira_etapa", undefined, "Pipeline não encontrado.");
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith("Não encontrei esse pipeline.");
  });

  it("returns a graceful 'not available' tool result for a name the model hallucinated (not in our schema at all), instead of crashing", async () => {
    mocks.create
      .mockResolvedValueOnce(toolCallStream("deletar_tudo", { run_id: "run-1" }))
      .mockResolvedValueOnce(textOnlyStream("Essa função não existe.", "resp-2"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [],
      handlers: h,
    });

    expect(h.onToolResult).toHaveBeenCalledWith(
      "deletar_tudo",
      undefined,
      expect.stringContaining("não está disponível"),
    );
  });

  it("dispatches criar_contatos_e_negocios to the real import tool, threading accountId and userId through", async () => {
    mocks.criarContatosENegocios.mockResolvedValue({ imported: 2, alreadyImported: 0, failed: 0, results: [] });
    mocks.create
      .mockResolvedValueOnce(toolCallStream("criar_contatos_e_negocios", { run_id: "run-1", candidate_ids: ["c1", "c2"] }))
      .mockResolvedValueOnce(textOnlyStream("Importei 2 negócios!", "resp-2"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [],
      handlers: h,
    });

    expect(mocks.criarContatosENegocios).toHaveBeenCalledWith({}, "acct-1", "user-1", {
      run_id: "run-1",
      candidate_ids: ["c1", "c2"],
    });
    expect(h.onToolResult).toHaveBeenCalledWith(
      "criar_contatos_e_negocios",
      { imported: 2, alreadyImported: 0, failed: 0, results: [] },
      undefined,
    );
  });

  it("dispatches pesquisar_empresas to the real search tool, threading accountId and userId through", async () => {
    mocks.pesquisarEmpresas.mockResolvedValue({ run_id: "run-1", status: "searching", found_count: 3, error: null });
    mocks.create
      .mockResolvedValueOnce(
        toolCallStream("pesquisar_empresas", { pipeline_id: "p1", niche: "dentista", region: "SP", quantity: 10 }),
      )
      .mockResolvedValueOnce(textOnlyStream("Comecei a busca!", "resp-2"));
    const h = handlers();

    await runProspectingTurn({
      db: {} as never,
      accountId: "acct-1",
      userId: "user-1",
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      provider: "openai",
      history: [],
      handlers: h,
    });

    expect(mocks.pesquisarEmpresas).toHaveBeenCalledWith(
      {},
      "acct-1",
      "user-1",
      { pipeline_id: "p1", niche: "dentista", region: "SP", quantity: 10 },
    );
    expect(h.onToolResult).toHaveBeenCalledWith(
      "pesquisar_empresas",
      { run_id: "run-1", status: "searching", found_count: 3, error: null },
      undefined,
    );
  });
});
