// ============================================================
// Thin REST client for Z-API (z-api.io) — the hosted, unofficial
// WhatsApp Web/QR-code gateway that backs "Meu WhatsApp" (personal
// connections, one instance per user). Replaces the self-hosted
// Evolution API (see evolution-client.ts, kept in the repo unused for
// rollback — see the migration plan notes).
//
// Architectural difference from Evolution API: Z-API instances are
// NOT created by this app. A regular (non-"integrador") Z-API account
// only creates instances by hand in their dashboard (app.z-api.io) —
// there's no "createInstance" here. Each user pastes their own
// Instance ID + Instance Token into Settings once; from then on this
// client drives the same connect/QR/send/receive flow Evolution did.
//
// ZAPI_CLIENT_TOKEN is a single account-wide secret (Z-API's "Segurança
// > Token de segurança da conta"), shared by every instance under this
// Z-API login — it's an env var, not per-user, unlike the instance
// id/token pair which IS per-user (stored on whatsapp_sessions).
// ============================================================

const ZAPI_BASE_URL = 'https://api.z-api.io';

export function isZApiConfigured(): boolean {
  return Boolean(process.env.ZAPI_CLIENT_TOKEN);
}

export class ZApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ZApiError';
    this.status = status;
  }
}

function clientToken(): string {
  const token = process.env.ZAPI_CLIENT_TOKEN;
  if (!token) {
    throw new ZApiError('ZAPI_CLIENT_TOKEN is not configured', 500);
  }
  return token;
}

async function request<T>(
  instanceId: string,
  instanceToken: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const url = `${ZAPI_BASE_URL}/instances/${encodeURIComponent(instanceId)}/token/${encodeURIComponent(instanceToken)}${path}`;
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': clientToken(),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not expected from Z-API in practice, but stay defensive like the
    // Evolution client did for its own 5xx pages.
  }

  // Verified live: Z-API can return a 200 with a top-level `error`
  // string instead of a non-2xx status (e.g. the missing-client-token
  // case) — check both, not just res.ok.
  const errorField = (json as { error?: unknown } | null)?.error;
  if (!res.ok || (typeof errorField === 'string' && errorField)) {
    const message =
      (json as { message?: string } | null)?.message ??
      (typeof errorField === 'string' ? errorField : null) ??
      `Z-API request failed (${res.status})`;
    throw new ZApiError(message, res.ok ? 502 : res.status);
  }

  return json as T;
}

/**
 * Best-effort extraction of a base64/URL QR code from Z-API's response
 * — field name isn't confirmed live (Allan's test instance was already
 * paired, so the API only ever returned `{connected:true}` during
 * verification). Kept defensive, same spirit as the old Evolution
 * client's `extractQrBase64`; confirm the real field name the first
 * time this runs against a genuinely disconnected instance.
 */
function extractQrValue(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ['value', 'qrcode', 'base64', 'image']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return null;
}

/**
 * Fetch/refresh the QR code for an instance not yet paired. Returns
 * null (instead of a QR) once the instance is already connected —
 * verified live: Z-API replies `{"connected":true}` in that case.
 */
export async function fetchQrCode(instanceId: string, instanceToken: string): Promise<string | null> {
  const data = await request<unknown>(instanceId, instanceToken, '/qr-code/image');
  return extractQrValue(data);
}

export type ZApiConnectionState = 'connected' | 'disconnected';

/** Live connection state straight from Z-API (not our cached DB status). Verified live. */
export async function fetchConnectionState(
  instanceId: string,
  instanceToken: string,
): Promise<ZApiConnectionState> {
  const data = await request<{ connected?: boolean }>(instanceId, instanceToken, '/status');
  return data?.connected ? 'connected' : 'disconnected';
}

/**
 * Point every webhook category (message received, connected,
 * disconnected, etc.) at the same URL in one call, mirroring how the
 * Evolution client registered one webhook for every event type it
 * cared about.
 */
export async function configureWebhook(
  instanceId: string,
  instanceToken: string,
  webhookUrl: string,
): Promise<void> {
  await request(instanceId, instanceToken, '/update-every-webhooks', {
    method: 'PUT',
    body: { value: webhookUrl },
  });
}

/**
 * Log the WhatsApp device out. Unlike Evolution API there is no
 * "delete instance" for a regular (non-integrador) Z-API account — the
 * instance itself keeps existing and being billed until cancelled by
 * hand in the Z-API dashboard. Callers must surface that distinction to
 * the user (see the Settings disconnect confirmation copy).
 */
export async function disconnectInstance(instanceId: string, instanceToken: string): Promise<void> {
  try {
    await request(instanceId, instanceToken, '/disconnect');
  } catch (err) {
    if (!(err instanceof ZApiError) || err.status !== 404) throw err;
  }
}

/** Best-effort profile picture lookup for one number. Null if none set. */
export async function fetchProfilePictureUrl(
  instanceId: string,
  instanceToken: string,
  phone: string,
): Promise<string | null> {
  try {
    const data = await request<{ link?: string; profilePictureUrl?: string }>(
      instanceId,
      instanceToken,
      `/contacts/${encodeURIComponent(phone)}/profile-picture`,
    );
    return data?.link ?? data?.profilePictureUrl ?? null;
  } catch {
    return null;
  }
}

export interface ZApiChat {
  phone: string;
  name?: string | null;
  isGroup: boolean;
  archived?: string | boolean;
  pinned?: string | boolean;
  lastMessageTime?: string | number;
  unread?: string | number;
}

/** Every chat (1:1 and group) Z-API currently knows for this instance — verified live. */
export async function findChats(instanceId: string, instanceToken: string): Promise<ZApiChat[]> {
  const data = await request<ZApiChat[]>(instanceId, instanceToken, '/chats?page=1&pageSize=100');
  return Array.isArray(data) ? data : [];
}

export interface ZApiContact {
  phone: string;
  name?: string | null;
  vname?: string | null;
  short?: string | null;
}

/** The phone's own saved-contacts store — verified live. No per-contact photo here (see fetchProfilePictureUrl). */
export async function findContacts(instanceId: string, instanceToken: string): Promise<ZApiContact[]> {
  const data = await request<ZApiContact[]>(instanceId, instanceToken, '/contacts?page=1&pageSize=100');
  return Array.isArray(data) ? data : [];
}

/** Send a plain text message through a connected personal instance. */
export async function sendText(
  instanceId: string,
  instanceToken: string,
  to: string,
  text: string,
): Promise<{ messageId: string }> {
  const data = await request<{ messageId?: string; zaapId?: string }>(
    instanceId,
    instanceToken,
    '/send-text',
    { method: 'POST', body: { phone: to, message: text } },
  );
  return { messageId: data?.messageId ?? data?.zaapId ?? '' };
}

const MEDIA_ENDPOINT: Record<'image' | 'video' | 'document' | 'audio', string> = {
  image: '/send-image',
  video: '/send-video',
  document: '/send-document',
  audio: '/send-audio',
};

/** Send an image/video/document/audio message through a connected personal instance. */
export async function sendMedia(
  instanceId: string,
  instanceToken: string,
  to: string,
  media: {
    mediaType: 'image' | 'video' | 'document' | 'audio';
    url: string;
    caption?: string;
    fileName?: string;
  },
): Promise<{ messageId: string }> {
  const bodyKey = media.mediaType; // Z-API's payload key matches the type name (image/video/document/audio)
  const data = await request<{ messageId?: string; zaapId?: string }>(
    instanceId,
    instanceToken,
    MEDIA_ENDPOINT[media.mediaType],
    {
      method: 'POST',
      body: {
        phone: to,
        [bodyKey]: media.url,
        caption: media.caption,
        fileName: media.fileName,
      },
    },
  );
  return { messageId: data?.messageId ?? data?.zaapId ?? '' };
}

/**
 * Send an emoji reaction to a specific message. Not wired into any UI
 * yet (no reaction picker on the personal-session path) — exposed here
 * because Z-API supports it natively, closing a gap Evolution API left
 * open; a future phase can add the picker.
 */
export async function sendReaction(
  instanceId: string,
  instanceToken: string,
  to: string,
  messageId: string,
  reaction: string,
): Promise<void> {
  await request(instanceId, instanceToken, '/send-message-reaction', {
    method: 'POST',
    body: { phone: to, messageId, reaction },
  });
}

/**
 * Send a sticker. Not wired into any UI yet — same rationale as
 * sendReaction above.
 */
export async function sendSticker(
  instanceId: string,
  instanceToken: string,
  to: string,
  stickerUrl: string,
): Promise<{ messageId: string }> {
  const data = await request<{ messageId?: string; zaapId?: string }>(
    instanceId,
    instanceToken,
    '/send-sticker',
    { method: 'POST', body: { phone: to, sticker: stickerUrl } },
  );
  return { messageId: data?.messageId ?? data?.zaapId ?? '' };
}
