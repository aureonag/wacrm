import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { reopenClosedConversation } from '@/lib/conversations/reopen';

// Evolution API's own connection/QR events don't carry a shared secret
// the way Meta's HMAC-signed webhook does — the URL itself is only
// known to our Evolution API deployment (registered at instance-create
// time, never exposed to the client). Same trust model as an internal
// service-to-service callback.

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

// Baileys' remoteJid is "<digits>@s.whatsapp.net" for a 1:1 chat, or
// "<digits>@g.us" for a group. Fase 1 only handles 1:1 — group inbound
// is out of scope (mirrors how the official Meta webhook has no group
// concept either).
function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  if (jid.endsWith('@g.us')) return null;
  const [digits] = jid.split('@');
  return normalizePhone(digits ?? '');
}

function extractText(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  const extended = message.extendedTextMessage as { text?: string } | undefined;
  if (extended?.text) return extended.text;
  const image = message.imageMessage as { caption?: string } | undefined;
  if (image?.caption) return image.caption;
  const video = message.videoMessage as { caption?: string } | undefined;
  if (video?.caption) return video.caption;
  return null;
}

export async function POST(request: Request) {
  let body: EvolutionWebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Ack immediately, process after — same rationale as the Meta webhook
  // (src/app/api/whatsapp/webhook/route.ts): don't let downstream work
  // risk a slow/duplicate delivery from the gateway.
  after(async () => {
    try {
      await processEvent(body);
    } catch (err) {
      console.error('[whatsapp-sessions/webhook] processing failed:', err);
    }
  });

  return NextResponse.json({ status: 'received' });
}

async function processEvent(body: EvolutionWebhookBody) {
  const { event, instance, data } = body;
  if (!event || !instance) return;

  const db = supabaseAdmin();
  const { data: session, error: sessionError } = await db
    .from('whatsapp_sessions')
    .select('user_id, account_id, status')
    .eq('instance_name', instance)
    .maybeSingle();

  if (sessionError) {
    console.error('[whatsapp-sessions/webhook] session lookup failed:', sessionError);
    return;
  }
  if (!session) {
    console.warn('[whatsapp-sessions/webhook] unknown instance:', instance);
    return;
  }

  switch (event) {
    case 'connection.update':
      await handleConnectionUpdate(db, session, data);
      break;
    case 'messages.upsert':
      await handleMessagesUpsert(db, session, data);
      break;
    default:
      // qrcode.updated and everything else: no DB-side effect needed —
      // the "Meu WhatsApp" panel polls/refetches the QR itself.
      break;
  }
}

async function handleConnectionUpdate(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string },
  data: unknown,
) {
  const state = (data as { state?: string } | null)?.state;
  if (state !== 'open' && state !== 'close' && state !== 'connecting') return;

  const status = state === 'open' ? 'connected' : state === 'close' ? 'disconnected' : 'connecting';
  const update: Record<string, unknown> = { status };
  if (status === 'connected') update.connected_at = new Date().toISOString();

  const { error } = await db
    .from('whatsapp_sessions')
    .update(update)
    .eq('user_id', session.user_id);
  if (error) {
    console.error('[whatsapp-sessions/webhook] status update failed:', error);
  }
}

async function handleMessagesUpsert(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string },
  data: unknown,
) {
  // Evolution can deliver either a single message object or
  // { messages: [...] } depending on version — handle both.
  const raw = data as Record<string, unknown> | null;
  const messages = Array.isArray(raw?.messages) ? raw!.messages : raw ? [raw] : [];

  for (const msg of messages) {
    await processInboundMessage(db, session, msg as Record<string, unknown>);
  }
}

async function processInboundMessage(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string },
  msg: Record<string, unknown>,
) {
  const key = msg.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined;
  if (!key || key.fromMe) return; // our own outbound echo — ignore

  const phone = phoneFromJid(key.remoteJid);
  if (!phone) return; // group chat or malformed jid — out of Fase 1 scope

  const contactName = (msg.pushName as string | undefined) || phone;
  const contentText = extractText(msg.message as Record<string, unknown> | undefined);
  const metaMessageId = key.id || crypto.randomUUID();
  const timestampRaw = msg.messageTimestamp as number | string | undefined;
  const createdAt = timestampRaw
    ? new Date(Number(timestampRaw) * 1000).toISOString()
    : new Date().toISOString();

  const contact = await findOrCreateContact(db, session.account_id, session.user_id, phone, contactName);
  if (!contact) return;

  const conversation = await findOrCreateConversation(
    db,
    session.account_id,
    session.user_id,
    contact.id,
    session.user_id,
  );
  if (!conversation) return;

  const { data: inserted, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: 'text',
        content_text: contentText,
        message_id: metaMessageId,
        status: 'delivered',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (msgError) {
    console.error('[whatsapp-sessions/webhook] message insert failed:', msgError);
    return;
  }
  if (!inserted || inserted.length === 0) return; // duplicate delivery

  await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || '[mensagem]',
  });

  await reopenClosedConversation(db, conversation);
}

async function findOrCreateContact(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
) {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing) return existing;

  const { data: created, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: ownerUserId, phone, name: name || phone })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return findExistingContact(db, accountId, phone);
    }
    console.error('[whatsapp-sessions/webhook] contact create failed:', error);
    return null;
  }
  return created;
}

async function findOrCreateConversation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  ownerUserId: string,
  contactId: string,
  whatsappSessionId: string,
) {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[whatsapp-sessions/webhook] conversation lookup failed:', findError);
    return null;
  }
  if (existingRows && existingRows.length > 0) return existingRows[0];

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      whatsapp_session_id: whatsappSessionId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) return raced[0];
    }
    console.error('[whatsapp-sessions/webhook] conversation create failed:', createError);
    return null;
  }
  return created;
}
