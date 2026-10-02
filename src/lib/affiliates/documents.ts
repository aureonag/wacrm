// Private document storage for Afiliados (notas fiscais, comprovantes).
//
// Bucket `affiliates-docs` is private with NO storage policies (migration 102):
// nobody but the server (service_role) can touch it. Every download goes
// through an API route that checks the caller and the client first, then
// hands out a short-lived signed URL.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BadInput } from "./campaigns";

export const AFF_BUCKET = "affiliates-docs";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;

export class StorageNotReady extends Error {}

export interface UploadedDoc {
  buffer: Buffer;
  mime: "application/pdf" | "image/png" | "image/jpeg";
  ext: "pdf" | "png" | "jpg";
  /** Original name, sanitized for display only (never used as a path). */
  name: string;
}

/** Validates an uploaded file by size AND content (magic bytes), not by name. */
export async function readUpload(entry: FormDataEntryValue | null): Promise<UploadedDoc> {
  if (!(entry instanceof File) || entry.size === 0) throw new BadInput("Selecione um arquivo.");
  if (entry.size > MAX_UPLOAD_BYTES) throw new BadInput("O arquivo deve ter até 5 MB.");

  const buffer = Buffer.from(await entry.arrayBuffer());
  let mime: UploadedDoc["mime"];
  let ext: UploadedDoc["ext"];
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    mime = "application/pdf";
    ext = "pdf";
  } else if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mime = "image/png";
    ext = "png";
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mime = "image/jpeg";
    ext = "jpg";
  } else {
    throw new BadInput("Envie um arquivo PDF, PNG ou JPEG.");
  }

  const base = entry.name.split(/[\\/]/).pop() ?? "documento";
  const name = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "documento";
  return { buffer, mime, ext, name };
}

function isBucketMissing(message: string | undefined): boolean {
  return /bucket not found/i.test(message ?? "");
}

/** Stores a file under `<clientId>/<commissionId>/<kind>-<uuid>.<ext>`; returns the path. */
export async function storeDoc(
  admin: SupabaseClient,
  clientId: string,
  commissionId: string,
  kind: "invoice" | "receipt",
  doc: UploadedDoc,
): Promise<string> {
  const path = `${clientId}/${commissionId}/${kind}-${randomUUID()}.${doc.ext}`;
  const { error } = await admin.storage.from(AFF_BUCKET).upload(path, doc.buffer, {
    contentType: doc.mime,
    upsert: false,
  });
  if (error) {
    if (isBucketMissing(error.message)) throw new StorageNotReady();
    throw new Error(`storage upload failed: ${error.message}`);
  }
  return path;
}

export async function removeDoc(admin: SupabaseClient, path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await admin.storage.from(AFF_BUCKET).remove([path]);
  if (error) console.error("[affiliates] storage remove failed:", error.message);
}

export async function signedDocUrl(admin: SupabaseClient, path: string, fileName: string | null): Promise<string | null> {
  const { data, error } = await admin.storage.from(AFF_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS, {
    download: fileName ?? true,
  });
  if (error || !data) {
    console.error("[affiliates] createSignedUrl failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}
