// ============================================================
// Prospecting: external candidate import (paste text or spreadsheet
// upload) — the free alternative to the AI+Google Places search.
//
// Feeds the exact same downstream pipeline as an AI-driven search:
// candidates land in `prospecting_candidates` and get picked up by
// the engine's `enriching` step (website/Instagram — both free), then
// `scoring` (ICP + dedup, also free/local), then the same review
// table and import flow. The only thing this path skips is
// `searching` (Google Places) — see `engine.ts`'s `stepQueued`.
//
// Spreadsheet parsing uses `exceljs`, not the more common `xlsx`
// (SheetJS) package — `xlsx` has an unpatched high-severity
// prototype-pollution/ReDoS advisory with no fix on npm, which is
// disqualifying for a feature that parses attacker-reachable
// (user-uploaded) file content. `exceljs` carries only a moderate,
// transitive `uuid` advisory unrelated to file parsing.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { normalizeCompanyName } from "./dedupe";
import { assertPipelineOwnership } from "./tools/pipelines";
import { startRun } from "./engine";
import { logProspectingAudit } from "./audit";
import { ProspectingToolError } from "./tools/errors";
import { PROSPECTING_EXTERNAL_MAX_ROWS, type ProspectingRunOrigin } from "./constants";

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

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildTemplateCsv(): string {
  const header = PROSPECTING_TEMPLATE_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  return `﻿${header}\r\n`; // BOM so Excel opens it as UTF-8, not Latin-1
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matchColumnKey(header: string): string | null {
  const normalized = stripAccents(header.trim().toLowerCase());
  for (const col of PROSPECTING_TEMPLATE_COLUMNS) {
    if (col.aliases.some((a) => stripAccents(a) === normalized)) return col.key;
  }
  return null;
}

export interface ParsedRowResult {
  rows: Record<string, string>[];
  warnings: string[];
}

function detectDelimiter(sampleLine: string): string {
  const counts: [string, number][] = [
    [",", (sampleLine.match(/,/g) ?? []).length],
    ["\t", (sampleLine.match(/\t/g) ?? []).length],
    [";", (sampleLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Quote-aware CSV/TSV record splitter — tolerates commas, quotes, and newlines inside quoted fields. */
function parseDelimitedRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // skip — CRLF handled by the following \n
    } else if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

function rowsFromRecords(records: string[][]): ParsedRowResult {
  if (records.length === 0) return { rows: [], warnings: ["Nenhuma linha encontrada."] };

  const keyByIndex = records[0].map((h) => matchColumnKey(h));
  const warnings: string[] = [];
  if (!keyByIndex.includes("company_name")) {
    warnings.push('Coluna "Nome da empresa" não encontrada — confira se a primeira linha é o cabeçalho.');
  }

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const record = records[r];
    if (record.every((c) => !c.trim())) continue;
    const row: Record<string, string> = {};
    record.forEach((cell, i) => {
      const key = keyByIndex[i];
      if (key) row[key] = cell.trim();
    });
    rows.push(row);
  }
  return { rows, warnings };
}

/** Parses pasted text (from the config UI's "colar resultados" box) — CSV, TSV, or semicolon-delimited. */
export function parseDelimitedText(text: string): ParsedRowResult {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { rows: [], warnings: ["Nenhum conteúdo encontrado."] };

  const firstBreak = trimmed.search(/\r\n|\n|\r/);
  const firstLine = firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak);
  const delimiter = detectDelimiter(firstLine);
  return rowsFromRecords(parseDelimitedRecords(trimmed, delimiter));
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("text" in obj) return String(obj.text ?? "").trim();
    if ("result" in obj) return String(obj.result ?? "").trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

/** Parses an uploaded `.xlsx` file's first sheet. */
export async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedRowResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], warnings: ["A planilha não tem nenhuma aba."] };

  const headerValues = sheet.getRow(1).values as unknown[];
  const keyByIndex: (string | null)[] = [];
  headerValues.forEach((v, idx) => {
    keyByIndex[idx] = v ? matchColumnKey(cellToString(v)) : null;
  });

  const warnings: string[] = [];
  if (!keyByIndex.includes("company_name")) {
    warnings.push('Coluna "Nome da empresa" não encontrada — confira se a primeira linha é o cabeçalho.');
  }

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values as unknown[];
    const parsed: Record<string, string> = {};
    let hasContent = false;
    values.forEach((v, idx) => {
      const key = keyByIndex[idx];
      if (!key) return;
      const text = cellToString(v);
      if (text) hasContent = true;
      parsed[key] = text;
    });
    if (hasContent) rows.push(parsed);
  });

  return { rows, warnings };
}

export interface NormalizedExternalCandidate {
  company_name: string;
  normalized_name: string;
  contact_name: string | null;
  segment: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  notes: string | null;
}

function pick(raw: Record<string, string>, key: string): string | null {
  const v = raw[key]?.trim();
  return v ? v : null;
}

/** Accepts both "4,5" (pt-BR) and "4.5" — never invents a value from a malformed cell, just drops it. */
function pickDecimal(raw: Record<string, string>, key: string, max: number): number | null {
  const v = pick(raw, key);
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

/** Tolerant of extra text like "290 avaliações" — pulls out the leading integer. */
function pickInt(raw: Record<string, string>, key: string): number | null {
  const v = pick(raw, key);
  if (!v) return null;
  const match = v.match(/\d+/);
  if (!match) return null;
  return Number.parseInt(match[0], 10);
}

/** Never fabricates a field — an absent cell stays `null`, matching the "no placeholder text" rule (migration 047). */
export function normalizeExternalRow(raw: Record<string, string>): NormalizedExternalCandidate | null {
  const companyName = raw.company_name?.trim();
  if (!companyName) return null;
  return {
    company_name: companyName,
    normalized_name: normalizeCompanyName(companyName) ?? companyName.toLowerCase(),
    contact_name: pick(raw, "contact_name"),
    segment: pick(raw, "segment"),
    phone: pick(raw, "phone"),
    email: pick(raw, "email"),
    website: pick(raw, "website"),
    instagram: pick(raw, "instagram"),
    city: pick(raw, "city"),
    state: pick(raw, "state"),
    address: pick(raw, "address"),
    google_rating: pickDecimal(raw, "google_rating", 5),
    google_review_count: pickInt(raw, "google_review_count"),
    notes: pick(raw, "notes"),
  };
}

export interface CreateExternalRunArgs {
  accountId: string;
  userId: string;
  pipelineId: string;
  entryStageId: string;
  ownerId?: string | null;
  frenteLeadgen: boolean;
  frenteAvr: boolean;
  origin: Extract<ProspectingRunOrigin, "external_paste" | "external_upload">;
  /** Short human-readable source note stored in `prospecting_runs.prompt` (e.g. "Texto colado" or the uploaded filename). */
  sourceLabel: string;
  parsedRows: Record<string, string>[];
}

export interface CreateExternalRunResult {
  runId: string;
  insertedCount: number;
  skippedCount: number;
}

const CANDIDATE_INSERT_CHUNK = 200;

export async function createExternalRun(
  db: SupabaseClient,
  admin: SupabaseClient,
  args: CreateExternalRunArgs,
): Promise<CreateExternalRunResult> {
  await assertPipelineOwnership(db, args.accountId, args.pipelineId);

  if (args.parsedRows.length === 0) {
    throw new ProspectingToolError("Nenhuma linha encontrada para importar.", "no_rows");
  }
  if (args.parsedRows.length > PROSPECTING_EXTERNAL_MAX_ROWS) {
    throw new ProspectingToolError(
      `Essa planilha tem mais de ${PROSPECTING_EXTERNAL_MAX_ROWS} linhas — divida em arquivos menores.`,
      "too_many_rows",
    );
  }

  const normalized = args.parsedRows
    .map(normalizeExternalRow)
    .filter((r): r is NormalizedExternalCandidate => r !== null);
  const skippedCount = args.parsedRows.length - normalized.length;
  if (normalized.length === 0) {
    throw new ProspectingToolError('Nenhuma linha tinha "Nome da empresa" preenchido.', "no_valid_rows");
  }

  const { data: run, error } = await admin
    .from("prospecting_runs")
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      prompt: args.sourceLabel,
      parsed_request: {},
      pipeline_id: args.pipelineId,
      entry_stage_id: args.entryStageId,
      assigned_to: args.ownerId ?? null,
      frente_leadgen: args.frenteLeadgen,
      frente_avr: args.frenteAvr,
      requested_quantity: normalized.length,
      status: "queued",
      origin: args.origin,
      found_count: normalized.length,
    })
    .select()
    .single();

  if (error || !run) {
    console.error("[prospecting] createExternalRun run insert error:", error);
    throw new ProspectingToolError("Não foi possível criar a execução de importação.", "internal_error");
  }

  const runId = run.id as string;
  const rows = normalized.map((c) => ({
    run_id: runId,
    account_id: args.accountId,
    company_name: c.company_name,
    normalized_name: c.normalized_name,
    contact_name: c.contact_name,
    segment: c.segment,
    city: c.city,
    state: c.state,
    address: c.address,
    phone: c.phone,
    email: c.email,
    website: c.website,
    instagram: c.instagram,
    google_rating: c.google_rating,
    google_review_count: c.google_review_count,
    source_data: {
      origin: args.origin,
      imported_at: new Date().toISOString(),
      ...(c.notes ? { external_notes: c.notes } : {}),
    },
  }));

  for (let i = 0; i < rows.length; i += CANDIDATE_INSERT_CHUNK) {
    const { error: insertError } = await admin
      .from("prospecting_candidates")
      .insert(rows.slice(i, i + CANDIDATE_INSERT_CHUNK));
    if (insertError) {
      console.error("[prospecting] createExternalRun candidate insert error:", insertError);
      await admin
        .from("prospecting_runs")
        .update({ status: "failed", error: "Falha ao gravar candidatos importados." })
        .eq("id", runId);
      throw new ProspectingToolError("Falha ao gravar os candidatos importados.", "internal_error");
    }
  }

  await startRun(runId, admin);

  void logProspectingAudit(admin, {
    accountId: args.accountId,
    userId: args.userId,
    runId,
    action: "create_run",
    pipelineId: args.pipelineId,
    quantity: normalized.length,
    status: "queued",
    metadata: { origin: args.origin, source: args.sourceLabel, skipped: skippedCount },
  });

  return { runId, insertedCount: normalized.length, skippedCount };
}
