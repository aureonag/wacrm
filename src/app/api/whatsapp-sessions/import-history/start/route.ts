import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { identityFromJid } from '@/lib/whatsapp-sessions/contact-sync';
import { findChats } from '@/lib/whatsapp-sessions/evolution-client';

/**
 * POST /api/whatsapp-sessions/import-history/start — (re)builds the
 * caller's import queue from every chat Evolution currently knows
 * about (1:1 *and* groups) and flips the session into "running".
 *
 * Safe to call again later: chats already queued keep whatever status
 * they have (`ON CONFLICT DO NOTHING`), so re-starting after a full
 * run only queues chats that are new since then, and re-starting after
 * an interrupted run resumes it rather than redoing finished chats.
 * Each chat is then imported by repeated calls to .../process.
 */
export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    const db = supabaseAdmin();
    const { data: session, error: sessionError } = await db
      .from('whatsapp_sessions')
      .select('user_id, instance_name, status')
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

    const chats = await findChats(session.instance_name);

    const rows = chats
      .map((chat) => {
        const identity = identityFromJid(chat.remoteJid);
        if (!identity) return null;
        return {
          user_id: ctx.userId,
          remote_jid: chat.remoteJid,
          is_group: identity.isGroup,
          // For a group, findChats' pushName/profilePicUrl IS the
          // group's subject/photo (verified live) -- there's no
          // separate "contact" entry for a group to look up later,
          // so this is the only chance to capture it.
          chat_name: chat.pushName || null,
          chat_avatar_url: chat.profilePicUrl || null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      const { error: upsertError } = await db
        .from('whatsapp_history_import_chats')
        .upsert(rows, { onConflict: 'user_id,remote_jid', ignoreDuplicates: true });
      if (upsertError) {
        console.error('[whatsapp-sessions/import-history/start] queue upsert failed:', upsertError);
        return NextResponse.json({ error: 'Failed to queue chats' }, { status: 500 });
      }
    }

    await db
      .from('whatsapp_sessions')
      .update({ history_import_status: 'running', history_import_error: null })
      .eq('user_id', ctx.userId);

    const { count: totalChats } = await db
      .from('whatsapp_history_import_chats')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId);
    const { count: pendingChats } = await db
      .from('whatsapp_history_import_chats')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('status', 'pending');

    return NextResponse.json({
      totalChats: totalChats ?? 0,
      pendingChats: pendingChats ?? 0,
    });
  } catch (err) {
    console.error('[whatsapp-sessions/import-history/start] failed:', err);
    return toErrorResponse(err);
  }
}
