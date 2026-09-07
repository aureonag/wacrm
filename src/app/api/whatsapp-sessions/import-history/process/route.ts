import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  classifyMessage,
  findOrCreateContact,
  findOrCreateConversation,
  identityFromJid,
} from '@/lib/whatsapp-sessions/contact-sync';
import {
  findAllMessages,
  findChats,
  findContacts,
  type EvolutionChat,
  type EvolutionContact,
} from '@/lib/whatsapp-sessions/evolution-client';

// Chats per call. Kept small and synchronous (see the note on why
// import-history dropped `after()`) — a handful of chats, each
// possibly needing several paginated Evolution API calls, keeps one
// request's duration predictable. The client calls this repeatedly
// until { done: true }, which is what makes the overall import
// "background" from the user's point of view without needing a real
// background-job runtime.
const BATCH_SIZE = 4;
// How many message rows to upsert in one Supabase call — a chat with
// thousands of messages still writes in bounded chunks.
const MESSAGE_UPSERT_CHUNK = 500;

// Message-content pagination inside Evolution can itself be slow for
// very active groups; give this route real headroom (no-op on hosts
// that don't enforce it, same convention as the other routes).
export const maxDuration = 120;

export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    const db = supabaseAdmin();
    const { data: session, error: sessionError } = await db
      .from('whatsapp_sessions')
      .select('user_id, account_id, instance_name')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'WhatsApp session not found' }, { status: 404 });
    }

    const { data: batch, error: batchError } = await db
      .from('whatsapp_history_import_chats')
      .select('remote_jid, is_group, chat_name, chat_avatar_url')
      .eq('user_id', ctx.userId)
      .eq('status', 'pending')
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (batchError) {
      console.error('[whatsapp-sessions/import-history/process] batch fetch failed:', batchError);
      return NextResponse.json({ error: 'Failed to load next batch' }, { status: 500 });
    }

    let messagesImportedThisBatch = 0;

    if (batch && batch.length > 0) {
      // Baileys' own contact store — one call, reused for every chat in
      // this batch. See the Fase-5 fix notes on why this beats a
      // per-chat message-history name/photo guess.
      const contactRows = await findContacts(session.instance_name).catch(() => []);
      const contactsByPhone = new Map<string, EvolutionContact>();
      for (const c of contactRows) {
        const identity = identityFromJid(c.remoteJid);
        if (identity && !identity.isGroup) contactsByPhone.set(identity.id, c);
      }

      // Groups have no entry in Baileys' contact store -- their name/
      // photo only ever come from the chat itself (findChats' pushName/
      // profilePicUrl IS the group's subject/photo). Fetched live here
      // rather than trusting whatsapp_history_import_chats.chat_name,
      // since that column is only populated for chats queued by a
      // /start call made after that column existed -- a chat queued
      // earlier and merely reset back to 'pending' would otherwise
      // have it NULL forever.
      const chatRows = await findChats(session.instance_name).catch(() => []);
      const chatsByJid = new Map<string, EvolutionChat>();
      for (const c of chatRows) chatsByJid.set(c.remoteJid, c);

      for (const chat of batch) {
        const imported = await processOneChat(db, session, chat, contactsByPhone, chatsByJid);
        messagesImportedThisBatch += imported;
      }
    }

    const [{ count: total }, { count: pending }, { count: done }] = await Promise.all([
      db
        .from('whatsapp_history_import_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', ctx.userId),
      db
        .from('whatsapp_history_import_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .eq('status', 'pending'),
      db
        .from('whatsapp_history_import_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .eq('status', 'done'),
    ]);

    const isDone = (pending ?? 0) === 0;
    if (isDone) {
      await db
        .from('whatsapp_sessions')
        .update({ history_import_status: 'done' })
        .eq('user_id', ctx.userId);
    }

    return NextResponse.json({
      done: isDone,
      totalChats: total ?? 0,
      doneChats: done ?? 0,
      messagesImportedThisBatch,
    });
  } catch (err) {
    console.error('[whatsapp-sessions/import-history/process] failed:', err);
    return toErrorResponse(err);
  }
}

async function processOneChat(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string; instance_name: string },
  chat: { remote_jid: string; is_group: boolean; chat_name: string | null; chat_avatar_url: string | null },
  contactsByPhone: Map<string, EvolutionContact>,
  chatsByJid: Map<string, EvolutionChat>,
): Promise<number> {
  const markResult = (status: 'done' | 'failed', messagesImported: number) =>
    db
      .from('whatsapp_history_import_chats')
      .update({ status, messages_imported: messagesImported, updated_at: new Date().toISOString() })
      .eq('user_id', session.user_id)
      .eq('remote_jid', chat.remote_jid);

  const identity = identityFromJid(chat.remote_jid);
  if (!identity) {
    await markResult('failed', 0);
    return 0;
  }

  // For a 1:1, the contact store is authoritative when it has the
  // number; the live chat and the stored queue-time snapshot are both
  // fallbacks for numbers never saved as a contact. For a group there
  // is no contact-store entry at all, so the live chat is primary.
  const known = identity.isGroup ? undefined : contactsByPhone.get(identity.id);
  const liveChat = chatsByJid.get(chat.remote_jid);
  const displayName = known?.pushName || liveChat?.pushName || chat.chat_name || identity.id;
  const avatarUrl = known?.profilePicUrl || liveChat?.profilePicUrl || chat.chat_avatar_url || null;

  const contact = await findOrCreateContact(
    db,
    session.account_id,
    session.user_id,
    identity.id,
    displayName,
    () => Promise.resolve(avatarUrl),
    identity.isGroup,
  );
  if (!contact) {
    await markResult('failed', 0);
    return 0;
  }

  // Self-healing backfill, same as the live-webhook / earlier import
  // path: never overwrites a name/photo that already resolved to
  // something real.
  const contactUpdate: Record<string, unknown> = {};
  if (contact.name === identity.id && displayName !== identity.id) contactUpdate.name = displayName;
  if (!contact.avatar_url && avatarUrl) contactUpdate.avatar_url = avatarUrl;
  if (Object.keys(contactUpdate).length > 0) {
    await db.from('contacts').update(contactUpdate).eq('id', contact.id);
  }

  const conversation = await findOrCreateConversation(
    db,
    session.account_id,
    session.user_id,
    contact.id,
    session.user_id,
  );
  if (!conversation) {
    await markResult('failed', 0);
    return 0;
  }

  let records;
  try {
    records = await findAllMessages(session.instance_name, chat.remote_jid);
  } catch (err) {
    console.error('[whatsapp-sessions/import-history/process] findAllMessages failed:', err);
    await markResult('failed', 0);
    return 0;
  }

  if (records.length === 0) {
    await markResult('done', 0);
    return 0;
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

  let imported = 0;
  for (let i = 0; i < rows.length; i += MESSAGE_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + MESSAGE_UPSERT_CHUNK);
    const { data: inserted, error: insertError } = await db
      .from('messages')
      .upsert(chunk, { onConflict: 'conversation_id,message_id', ignoreDuplicates: true })
      .select('id');
    if (insertError) {
      console.error('[whatsapp-sessions/import-history/process] message insert failed:', insertError);
      continue;
    }
    imported += inserted?.length ?? 0;
  }

  const newest = rows.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  const { data: convRow } = await db
    .from('conversations')
    .select('last_message_at')
    .eq('id', conversation.id)
    .maybeSingle();
  if (!convRow?.last_message_at || newest.created_at > convRow.last_message_at) {
    await db
      .from('conversations')
      .update({ last_message_text: newest.content_text, last_message_at: newest.created_at })
      .eq('id', conversation.id);
  }

  await markResult('done', imported);
  return imported;
}
