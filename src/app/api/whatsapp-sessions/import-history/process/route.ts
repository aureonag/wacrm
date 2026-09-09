import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  findOrCreateContact,
  findOrCreateConversation,
  identityFromZApiPhone,
} from '@/lib/whatsapp-sessions/contact-sync';
import {
  fetchProfilePictureUrl,
  findContacts,
  type ZApiContact,
} from '@/lib/whatsapp-sessions/zapi-client';

// Chats per call. Z-API has no message-history endpoint, so a "chat" is
// now just one find-or-create (name + photo) — much cheaper per item
// than the old Evolution path's full per-chat message pagination, so a
// larger batch still keeps one request's duration well within budget.
const BATCH_SIZE = 20;

export const maxDuration = 60;

// A row stuck in 'processing' this long is treated as abandoned (the
// request that claimed it crashed or timed out mid-batch) and becomes
// reclaimable again, so one dead request can't wedge the sync forever.
const STALE_PROCESSING_MINUTES = 5;

function staleProcessingCutoffIso(): string {
  return new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
}

export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    const db = supabaseAdmin();
    const { data: session, error: sessionError } = await db
      .from('whatsapp_sessions')
      .select('user_id, account_id, zapi_instance_id, zapi_instance_token')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'WhatsApp session not found' }, { status: 404 });
    }

    // Claim a batch atomically instead of just reading 'pending' rows —
    // see 075_history_import_processing_status.sql for why.
    const staleCutoff = staleProcessingCutoffIso();
    const { data: candidates, error: candidatesError } = await db
      .from('whatsapp_history_import_chats')
      .select('remote_jid')
      .eq('user_id', ctx.userId)
      .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${staleCutoff})`)
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (candidatesError) {
      console.error(
        '[whatsapp-sessions/import-history/process] candidate fetch failed:',
        candidatesError,
      );
      return NextResponse.json({ error: 'Failed to load next batch' }, { status: 500 });
    }

    let batch: { remote_jid: string; is_group: boolean; chat_name: string | null; chat_avatar_url: string | null }[] = [];
    if (candidates && candidates.length > 0) {
      const { data: claimed, error: claimError } = await db
        .from('whatsapp_history_import_chats')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('user_id', ctx.userId)
        .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${staleCutoff})`)
        .in(
          'remote_jid',
          candidates.map((c) => c.remote_jid),
        )
        .select('remote_jid, is_group, chat_name, chat_avatar_url');

      if (claimError) {
        console.error('[whatsapp-sessions/import-history/process] claim failed:', claimError);
        return NextResponse.json({ error: 'Failed to claim next batch' }, { status: 500 });
      }
      batch = claimed ?? [];
    }

    let contactsSyncedThisBatch = 0;

    if (batch.length > 0) {
      // Z-API's own saved-contacts store — one call, reused for every
      // chat in this batch, same reasoning as the old Evolution path:
      // more reliable than any single chat's own name guess.
      const contactRows = await findContacts(
        session.zapi_instance_id,
        session.zapi_instance_token,
      ).catch(() => []);
      const contactsByPhone = new Map<string, ZApiContact>();
      for (const c of contactRows) {
        const identity = identityFromZApiPhone(c.phone);
        if (identity && !identity.isGroup) contactsByPhone.set(identity.id, c);
      }

      for (const chat of batch) {
        const synced = await processOneChat(db, session, chat, contactsByPhone);
        if (synced) contactsSyncedThisBatch += 1;
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
        .in('status', ['pending', 'processing']),
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
      messagesImportedThisBatch: contactsSyncedThisBatch, // field name kept for the panel's existing toast copy
    });
  } catch (err) {
    console.error('[whatsapp-sessions/import-history/process] failed:', err);
    return toErrorResponse(err);
  }
}

async function processOneChat(
  db: ReturnType<typeof supabaseAdmin>,
  session: { user_id: string; account_id: string; zapi_instance_id: string; zapi_instance_token: string },
  chat: { remote_jid: string; is_group: boolean; chat_name: string | null; chat_avatar_url: string | null },
  contactsByPhone: Map<string, ZApiContact>,
): Promise<boolean> {
  const markResult = (status: 'done' | 'failed') =>
    db
      .from('whatsapp_history_import_chats')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', session.user_id)
      .eq('remote_jid', chat.remote_jid);

  const identity = identityFromZApiPhone(chat.remote_jid);
  if (!identity) {
    await markResult('failed');
    return false;
  }

  // For a 1:1, the saved-contacts store is authoritative when it has
  // the number; the chat's own name (captured at /start time) is the
  // fallback. For a group there is no contact-store entry at all, so
  // the chat name (the group's subject) is primary.
  const known = identity.isGroup ? undefined : contactsByPhone.get(identity.id);
  const displayName = known?.name || known?.vname || chat.chat_name || identity.id;
  const avatarUrl =
    chat.chat_avatar_url ||
    (await fetchProfilePictureUrl(session.zapi_instance_id, session.zapi_instance_token, identity.id));

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
    await markResult('failed');
    return false;
  }

  // Self-healing backfill, same as the live webhook: never overwrites a
  // name/photo that already resolved to something real.
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
    await markResult('failed');
    return false;
  }

  await markResult('done');
  return true;
}
