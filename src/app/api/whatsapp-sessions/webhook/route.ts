import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import {
  classifyZApiMessage,
  findOrCreateContact,
  findOrCreateConversation,
  identityFromZApiPhone,
} from '@/lib/whatsapp-sessions/contact-sync';

// Z-API's webhook URL is only known to our Z-API instance config (set
// via configureWebhook, never exposed to the client) — same trust model
// the Evolution webhook used, no shared-secret verification needed.
// One URL receives every event category (message received, connected,
// disconnected, ...); `type` tells them apart.

interface ZApiWebhookBody {
  type?: string; // 'ReceivedCallback' | 'ConnectedCallback' | 'DisconnectedCallback' | ...
  instanceId?: string;
  phone?: string;
  isGroup?: boolean;
  isNewsletter?: boolean;
  fromMe?: boolean;
  participantPhone?: string | null;
  chatName?: string | null;
  senderName?: string | null;
  photo?: string | null;
  senderPhoto?: string | null;
  messageId?: string;
  momment?: number;
  connected?: boolean;
  text?: { message?: string } | null;
  image?: { caption?: string } | null;
  video?: { caption?: string } | null;
  audio?: unknown;
  document?: { caption?: string; fileName?: string } | null;
  sticker?: unknown;
}

export async function POST(request: Request) {
  let body: ZApiWebhookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Ack immediately, process after — same rationale as the Meta webhook
  // (src/app/api/whatsapp/webhook/route.ts).
  after(async () => {
    try {
      await processEvent(body);
    } catch (err) {
      console.error('[whatsapp-sessions/webhook] processing failed:', err);
    }
  });

  return NextResponse.json({ status: 'received' });
}

async function processEvent(body: ZApiWebhookBody) {
  const { type, instanceId } = body;
  if (!type || !instanceId) return;

  const db = supabaseAdmin();
  const { data: session, error: sessionError } = await db
    .from('whatsapp_sessions')
    .select('user_id, account_id, status, zapi_instance_id, zapi_instance_token')
    .eq('zapi_instance_id', instanceId)
    .maybeSingle();

  if (sessionError) {
    console.error('[whatsapp-sessions/webhook] session lookup failed:', sessionError);
    return;
  }
  if (!session) {
    console.warn('[whatsapp-sessions/webhook] unknown instance:', instanceId);
    return;
  }

  if (type.includes('Connected') || type.includes('Disconnected')) {
    await handleConnectionEvent(db, session, body);
    return;
  }
  if (type === 'ReceivedCallback') {
    await processInboundMessage(db, session, body);
  }
  // Delivery/read-status callbacks and everything else: no DB-side
  // effect needed today.
}

async function handleConnectionEvent(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string },
  body: ZApiWebhookBody,
) {
  const connected = body.type?.includes('Disconnected') ? false : Boolean(body.connected ?? true);
  const update: Record<string, unknown> = { status: connected ? 'connected' : 'disconnected' };
  if (connected) {
    update.connected_at = new Date().toISOString();
    if (body.phone) update.phone_number = body.phone;
  }

  const { error } = await db.from('whatsapp_sessions').update(update).eq('user_id', session.user_id);
  if (error) {
    console.error('[whatsapp-sessions/webhook] status update failed:', error);
  }
}

async function processInboundMessage(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string },
  body: ZApiWebhookBody,
) {
  if (body.fromMe) return; // our own outbound echo — ignore
  if (body.isNewsletter) return; // channel/community broadcast — not a conversation

  const identity = identityFromZApiPhone(body.phone);
  if (!identity) return;

  const displayName = body.chatName || body.senderName || identity.id;
  const avatarUrl = body.photo || body.senderPhoto || null;
  const { contentText } = classifyZApiMessage(body);
  const metaMessageId = body.messageId || crypto.randomUUID();
  const createdAt = body.momment ? new Date(body.momment).toISOString() : new Date().toISOString();

  const contact = await findOrCreateContact(
    db,
    session.account_id,
    session.user_id,
    identity.id,
    displayName,
    () => Promise.resolve(avatarUrl),
    identity.isGroup,
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
