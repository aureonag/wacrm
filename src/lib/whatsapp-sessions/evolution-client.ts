// ============================================================
// Thin REST client for the Evolution API (github.com/EvolutionAPI/
// evolution-api) — the Baileys-based WhatsApp gateway that backs
// "Meu WhatsApp" (personal, QR-code connections, one instance per
// user). Runs as its own Docker service outside this app; every call
// here is a plain HTTP request, the same relationship this app
// already has with Meta's Graph API for the official whatsapp_config
// path.
//
// EVOLUTION_API_URL / EVOLUTION_API_KEY are required for this feature;
// callers should treat a missing config as "feature disabled" rather
// than throwing at import time (mirrors how GOOGLE_PLACES_API_KEY is
// handled for Prospecção).
// ============================================================

export function isEvolutionApiConfigured(): boolean {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
}

export class EvolutionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'EvolutionApiError';
    this.status = status;
  }
}

function baseUrl(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) {
    throw new EvolutionApiError('EVOLUTION_API_URL is not configured', 500);
  }
  return url.replace(/\/+$/, '');
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) {
    throw new EvolutionApiError('EVOLUTION_API_KEY is not configured', 500);
  }
  return key;
}

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey(),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Evolution API returns non-JSON on some 5xx pages — fall through
    // with json=null and let the status check below raise.
  }

  if (!res.ok) {
    const message =
      (json as { message?: string; error?: string } | null)?.message ??
      (json as { message?: string; error?: string } | null)?.error ??
      `Evolution API request failed (${res.status})`;
    throw new EvolutionApiError(message, res.status);
  }

  return json as T;
}

/**
 * Best-effort extraction of a base64 QR code from Evolution API's
 * response — the exact nesting has drifted across versions
 * (top-level `base64`, or nested under `qrcode.base64`). Checked live
 * against the deployed instance during Fase 1 verification; kept
 * defensive so a minor version bump doesn't silently break the QR.
 */
function extractQrBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.base64 === 'string') return obj.base64;
  if (obj.qrcode && typeof obj.qrcode === 'object') {
    const nested = (obj.qrcode as Record<string, unknown>).base64;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

export interface CreateInstanceResult {
  qrBase64: string | null;
}

/**
 * Create a new Baileys instance and return its QR code (if Evolution
 * generated one synchronously — otherwise call fetchQrCode next).
 * `instanceName` must be globally unique across the Evolution API
 * deployment (it's the account_id-free identifier — see the route
 * that calls this for the naming scheme).
 */
export async function createInstance(
  instanceName: string,
): Promise<CreateInstanceResult> {
  const data = await request<unknown>('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    },
  });
  return { qrBase64: extractQrBase64(data) };
}

/** Register (or replace) the webhook Evolution calls for this instance. */
export async function setInstanceWebhook(
  instanceName: string,
  webhookUrl: string,
): Promise<void> {
  await request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: true,
        events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
      },
    },
  });
}

/** Fetch/refresh the QR code for an instance that isn't connected yet. */
export async function fetchQrCode(instanceName: string): Promise<string | null> {
  const data = await request<unknown>(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
  );
  return extractQrBase64(data);
}

export type EvolutionConnectionState = 'open' | 'connecting' | 'close' | 'unknown';

/** Live connection state straight from Evolution API (not our cached DB status). */
export async function fetchConnectionState(
  instanceName: string,
): Promise<EvolutionConnectionState> {
  const data = await request<{ instance?: { state?: string } }>(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  const state = data?.instance?.state;
  if (state === 'open' || state === 'connecting' || state === 'close') return state;
  return 'unknown';
}

/** Log the WhatsApp device out (instance row stays, can reconnect with a new QR). */
export async function logoutInstance(instanceName: string): Promise<void> {
  try {
    await request(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    // Already logged out / instance already gone — not a caller-facing error.
    if (!(err instanceof EvolutionApiError) || err.status !== 404) throw err;
  }
}

/** Permanently remove the instance from Evolution API. */
export async function deleteInstance(instanceName: string): Promise<void> {
  try {
    await request(`/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    if (!(err instanceof EvolutionApiError) || err.status !== 404) throw err;
  }
}

/** Send a plain text message through a connected personal instance (Fase 2). */
export async function sendText(
  instanceName: string,
  to: string,
  text: string,
): Promise<{ messageId: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: { number: to, text } },
  );
  return { messageId: data?.key?.id ?? '' };
}

/** Send an image/video/document/audio message through a connected personal instance (Fase 2). */
export async function sendMedia(
  instanceName: string,
  to: string,
  media: {
    mediaType: 'image' | 'video' | 'document' | 'audio';
    url: string;
    caption?: string;
    fileName?: string;
  },
): Promise<{ messageId: string }> {
  const data = await request<{ key?: { id?: string } }>(
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: {
        number: to,
        mediatype: media.mediaType,
        media: media.url,
        caption: media.caption,
        fileName: media.fileName,
      },
    },
  );
  return { messageId: data?.key?.id ?? '' };
}
