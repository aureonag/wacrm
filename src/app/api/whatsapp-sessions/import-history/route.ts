import { NextResponse, after } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  classifyMessage,
  findOrCreateContact,
  findOrCreateConversation,
  phoneFromJid,
} from '@/lib/whatsapp-sessions/contact-sync';
import { findChats, findMessages } from '@/lib/whatsapp-sessions/evolution-client';

// Bounds on a one-time, user-triggered backfill — not a full mirror of
// years of WhatsApp history. Chosen so the background job finishes in
// well under a minute for a typical personal account (tens to low
// hundreds of 1:1 chats), not the ~30s+ per-chat crawl a full sync
// would take. Re-running the import is safe (idempotent, upserts by
// message_id) so a user who wants more can just run it again later if
// this cap ever changes.
const MAX_CHATS = 50;
const MAX_MESSAGES_PER_CHAT = 30;

/**
 * POST /api/whatsapp-sessions/import-history — one-time backfill of
 * recent 1:1 chat history from the caller's personal WhatsApp session
 * into the Inbox. Responds immediately and does the work in `after()`;
 * imported conversations/messages stream into the Inbox via the same
 * Realtime subscriptions that already drive live inbound messages, so
 * there's no separate progress UI to build.
 */
export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    const db = supabaseAdmin();
    const { data: session, error: sessionError } = await db
      .from('whatsapp_sessions')
      .select('user_id, account_id, instance_name, status')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'WhatsApp session not found' }, { status: 404 });
    }
    if (session.status !== 'connected') {
      return NextResponse.json(
        { error: 'Conecte seu WhatsApp antes de importar o histórico' },
        { status: 409 },
      );
    }

    after(async () => {
      try {
        await importHistory(db, session);
      } catch (err) {
        console.error('[whatsapp-sessions/import-history] failed:', err);
      }
    });

    return NextResponse.json({ started: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function importHistory(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string; instance_name: string },
) {
  const chats = await findChats(session.instance_name);

  const directChats = chats
    .filter((c) => phoneFromJid(c.remoteJid))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, MAX_CHATS);

  let chatsProcessed = 0;
  let messagesImported = 0;

  for (const chat of directChats) {
    const phone = phoneFromJid(chat.remoteJid);
    if (!phone) continue;

    const displayName = chat.lastMessage?.pushName || chat.pushName || phone;

    const contact = await findOrCreateContact(
      db,
      session.account_id,
      session.user_id,
      phone,
      displayName,
      () => Promise.resolve(chat.profilePicUrl ?? null),
    );
    if (!contact) continue;

    const conversation = await findOrCreateConversation(
      db,
      session.account_id,
      session.user_id,
      contact.id,
      session.user_id,
    );
    if (!conversation) continue;

    const records = await findMessages(session.instance_name, chat.remoteJid, MAX_MESSAGES_PER_CHAT);
    if (records.length === 0) {
      chatsProcessed++;
      continue;
    }

    const rows = records
      .filter((r) => r.key?.id)
      .map((r) => {
        const { contentText } = classifyMessage(r.messageType, r.message);
        const timestampRaw = r.messageTimestamp;
        const createdAt = timestampRaw
          ? new Date(Number(timestampRaw) * 1000).toISOString()
          : new Date().toISOString();
        return {
          conversation_id: conversation.id,
          sender_type: r.key?.fromMe ? 'agent' : 'customer',
          content_type: 'text',
          content_text: contentText,
          message_id: r.key!.id as string,
          status: r.key?.fromMe ? 'sent' : 'delivered',
          created_at: createdAt,
        };
      });

    const { data: inserted, error: insertError } = await db
      .from('messages')
      .upsert(rows, { onConflict: 'conversation_id,message_id', ignoreDuplicates: true })
      .select('id');

    if (insertError) {
      console.error('[whatsapp-sessions/import-history] message insert failed:', insertError);
      continue;
    }
    messagesImported += inserted?.length ?? 0;
    chatsProcessed++;

    // Only refresh the preview if the newest imported message is more
    // recent than what the conversation already shows — a live inbound
    // message that arrived after this import started must win.
    const newest = rows.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const { data: convRow } = await db
      .from('conversations')
      .select('last_message_at')
      .eq('id', conversation.id)
      .maybeSingle();
    if (!convRow?.last_message_at || newest.created_at > convRow.last_message_at) {
      await db
        .from('conversations')
        .update({
          last_message_text: newest.content_text,
          last_message_at: newest.created_at,
        })
        .eq('id', conversation.id);
    }
  }

  console.log(
    `[whatsapp-sessions/import-history] done for user ${session.user_id}: ${chatsProcessed} chats, ${messagesImported} messages`,
  );
}
