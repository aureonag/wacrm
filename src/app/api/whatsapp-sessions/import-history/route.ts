import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  classifyMessage,
  findOrCreateContact,
  findOrCreateConversation,
  phoneFromJid,
} from '@/lib/whatsapp-sessions/contact-sync';
import {
  findChats,
  findContacts,
  findMessages,
  type EvolutionContact,
} from '@/lib/whatsapp-sessions/evolution-client';

// Bounds on a one-time, user-triggered backfill — not a full mirror of
// years of WhatsApp history. Chosen so the request finishes in well
// under a minute for a typical personal account (tens to low hundreds
// of 1:1 chats), not the crawl a full sync would take. Re-running the
// import is safe (idempotent, upserts by message_id, and self-heals
// any contact still on the phone-number fallback) so a user who wants
// more can just run it again later if this cap ever changes.
const MAX_CHATS = 50;
const MAX_MESSAGES_PER_CHAT = 30;
// How many chats to process concurrently. This route runs
// synchronously (the request waits for the full import — see the note
// on `after()` below), so bounded parallelism is what keeps a ~50-chat
// import from taking minutes serially.
const CONCURRENCY = 6;

// Persistent-server route with maxDuration set for parity with the
// other WhatsApp webhook routes' convention; on hosts that don't
// enforce it (this app's Node server included) it's a no-op.
export const maxDuration = 120;

/**
 * POST /api/whatsapp-sessions/import-history — one-time backfill of
 * recent 1:1 chat history from the caller's personal WhatsApp session
 * into the Inbox.
 *
 * Deliberately synchronous (awaits the full import before responding)
 * rather than using `after()` to ack-then-process: this job makes
 * dozens of sequential Evolution API round trips per run, and in
 * testing `after()`'s background continuation did not reliably survive
 * long enough to finish that many calls on this host (unlike the
 * webhook routes, whose `after()` work is a single short burst). A
 * user-triggered, one-time action is exactly the case where making the
 * caller wait for a real result is preferable to a fire-and-forget
 * that might silently stop partway.
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

    const result = await importHistory(db, session);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[whatsapp-sessions/import-history] failed:', err);
    return toErrorResponse(err);
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function importHistory(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string; instance_name: string },
): Promise<{ chatsProcessed: number; messagesImported: number }> {
  const [chats, contactRows] = await Promise.all([
    findChats(session.instance_name),
    findContacts(session.instance_name),
  ]);

  // Baileys' own contact store (findContacts) is the authoritative
  // name/photo per number — independent of any one chat's message
  // history. Far more reliable than a chat's `lastMessage.pushName`
  // (whoever sent the newest message — "Você" when that's Allan
  // himself) or scanning message records for one with a name.
  const contactsByPhone = new Map<string, EvolutionContact>();
  for (const c of contactRows) {
    const phone = phoneFromJid(c.remoteJid);
    if (phone) contactsByPhone.set(phone, c);
  }

  const directChats = chats
    .filter((c) => phoneFromJid(c.remoteJid))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, MAX_CHATS);

  async function processChat(
    chat: (typeof directChats)[number],
  ): Promise<{ processed: boolean; imported: number }> {
    const phone = phoneFromJid(chat.remoteJid);
    if (!phone) return { processed: false, imported: 0 };

    const known = contactsByPhone.get(phone);
    const displayName = known?.pushName || phone;
    const avatarUrl = known?.profilePicUrl || chat.profilePicUrl || null;

    const contact = await findOrCreateContact(
      db,
      session.account_id,
      session.user_id,
      phone,
      displayName,
      () => Promise.resolve(avatarUrl),
    );
    if (!contact) return { processed: false, imported: 0 };

    // Self-healing backfill: a contact created earlier (live webhook or
    // a previous import run) before we had this name/photo is still
    // sitting on the phone-number fallback — fill it in now rather than
    // requiring the user to notice and re-import. Never overwrites a
    // name/photo that's already something other than the raw fallback,
    // so a manual edit or a genuinely-resolved value is never clobbered.
    const contactUpdate: Record<string, unknown> = {};
    if (contact.name === phone && displayName !== phone) contactUpdate.name = displayName;
    if (!contact.avatar_url && avatarUrl) contactUpdate.avatar_url = avatarUrl;
    if (Object.keys(contactUpdate).length > 0) {
      await db.from('contacts').update(contactUpdate).eq('id', contact.id);
    }

    const records = await findMessages(session.instance_name, chat.remoteJid, MAX_MESSAGES_PER_CHAT);

    const conversation = await findOrCreateConversation(
      db,
      session.account_id,
      session.user_id,
      contact.id,
      session.user_id,
    );
    if (!conversation) return { processed: false, imported: 0 };

    if (records.length === 0) {
      return { processed: true, imported: 0 };
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
      return { processed: false, imported: 0 };
    }

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

    return { processed: true, imported: inserted?.length ?? 0 };
  }

  const outcomes = await mapWithConcurrency(directChats, CONCURRENCY, processChat);

  const chatsProcessed = outcomes.filter((o) => o.processed).length;
  const messagesImported = outcomes.reduce((sum, o) => sum + o.imported, 0);

  console.log(
    `[whatsapp-sessions/import-history] done for user ${session.user_id}: ${chatsProcessed} chats, ${messagesImported} messages`,
  );

  return { chatsProcessed, messagesImported };
}
