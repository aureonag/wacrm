import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import {
  classifyMessage,
  findOrCreateContact,
  findOrCreateConversation,
  phoneFromJid,
} from '@/lib/whatsapp-sessions/contact-sync';
import { fetchProfilePictureUrl } from '@/lib/whatsapp-sessions/evolution-client';

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
    .select('user_id, account_id, status, instance_name')
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
  session: { user_id: string; account_id: string; instance_name: string },
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
  session: { user_id: string; account_id: string; instance_name: string },
  msg: Record<string, unknown>,
) {
  const key = msg.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined;
  if (!key || key.fromMe) return; // our own outbound echo — ignore

  const phone = phoneFromJid(key.remoteJid);
  if (!phone) return; // group chat or malformed jid — out of scope

  const contactName = (msg.pushName as string | undefined) || phone;
  const { contentText } = classifyMessage(
    msg.messageType as string | undefined,
    msg.message as Record<string, unknown> | undefined,
  );
  const metaMessageId = key.id || crypto.randomUUID();
  const timestampRaw = msg.messageTimestamp as number | string | undefined;
  const createdAt = timestampRaw
    ? new Date(Number(timestampRaw) * 1000).toISOString()
    : new Date().toISOString();

  const contact = await findOrCreateContact(
    db,
    session.account_id,
    session.user_id,
    phone,
    contactName,
    // Best-effort avatar, only fetched if this turns out to be a new
    // contact — never blocks message ingestion either way.
    () => fetchProfilePictureUrl(session.instance_name, phone),
  );
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
