import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/prospecting/admin-client";
import {
  createExternalRun,
  parseDelimitedText,
  parseXlsxBuffer,
} from "@/lib/prospecting/external-import";
import { obterPrimeiraEtapa } from "@/lib/prospecting/tools/pipelines";
import { ProspectingToolError } from "@/lib/prospecting/tools/errors";

interface ExternalRunFields {
  pipelineId: string;
  ownerId: string | null;
  frenteLeadgen: boolean;
  frenteAvr: boolean;
}

function readField(value: FormDataEntryValue | string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * POST /api/prospecting/runs/external  (agent+)
 *
 * Two request shapes, both producing the same result:
 *  - `application/json` — `{ pasted_text, pipeline_id, entry_stage_id, owner_id?, frente_leadgen, frente_avr }`
 *    for the "colar resultados" box.
 *  - `multipart/form-data` — same fields plus a `file` (.csv or .xlsx)
 *    for the spreadsheet-upload path.
 *
 * Neither path calls OpenAI or Google Places — see
 * `external-import.ts` for why, and `engine.ts`'s `stepQueued` for how
 * the run skips straight to enrichment.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const admin = supabaseAdmin();

    const contentType = request.headers.get("content-type") ?? "";
    let fields: ExternalRunFields;
    let parsed: { rows: Record<string, string>[]; warnings: string[] };
    let origin: "external_paste" | "external_upload";
    let sourceLabel: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      fields = {
        pipelineId: readField(form.get("pipeline_id")),
        ownerId: readField(form.get("owner_id")) || null,
        frenteLeadgen: readField(form.get("frente_leadgen")) === "true",
        frenteAvr: readField(form.get("frente_avr")) === "true",
      };
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
      }
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      parsed = isXlsx
        ? await parseXlsxBuffer(Buffer.from(await file.arrayBuffer()))
        : parseDelimitedText(await file.text());
      origin = "external_upload";
      sourceLabel = `Planilha: ${file.name}`;
    } else {
      const body = (await request.json().catch(() => null)) as
        | (Record<string, unknown> & { pasted_text?: string })
        | null;
      if (!body) return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
      fields = {
        pipelineId: readField(body.pipeline_id as string | undefined),
        ownerId: readField(body.owner_id as string | undefined) || null,
        frenteLeadgen: body.frente_leadgen === true,
        frenteAvr: body.frente_avr === true,
      };
      const pastedText = typeof body.pasted_text === "string" ? body.pasted_text : "";
      if (!pastedText.trim()) {
        return NextResponse.json({ error: "Nenhum texto colado." }, { status: 400 });
      }
      parsed = parseDelimitedText(pastedText);
      origin = "external_paste";
      sourceLabel = "Texto colado";
    }

    if (!fields.pipelineId) return NextResponse.json({ error: "pipeline_id é obrigatório." }, { status: 400 });

    // Same resolution the AI chat's `pesquisar_empresas` tool uses —
    // the client only ever needs to know the pipeline, never a stage id.
    const { stage_id: entryStageId } = await obterPrimeiraEtapa(supabase, accountId, {
      pipeline_id: fields.pipelineId,
    });

    const result = await createExternalRun(supabase, admin, {
      accountId,
      userId,
      pipelineId: fields.pipelineId,
      entryStageId,
      ownerId: fields.ownerId,
      frenteLeadgen: fields.frenteLeadgen,
      frenteAvr: fields.frenteAvr,
      origin,
      sourceLabel,
      parsedRows: parsed.rows,
    });

    return NextResponse.json({
      run_id: result.runId,
      inserted_count: result.insertedCount,
      skipped_count: result.skippedCount,
      warnings: parsed.warnings,
    });
  } catch (err) {
    if (err instanceof ProspectingToolError) {
      const status = err.code === "pipeline_not_found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    return toErrorResponse(err);
  }
}
