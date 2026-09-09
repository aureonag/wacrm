import { NextResponse } from 'next/server';

import { ForbiddenError, getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { disconnectInstance } from '@/lib/whatsapp-sessions/zapi-client';

/**
 * DELETE /api/whatsapp-sessions/[id] — disconnect a personal WhatsApp
 * session. `id` is the session's user_id (the table's PK). Only the
 * owner, or an account admin, may disconnect it — mirrors the RLS
 * delete policies from migration 072.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    if (id !== ctx.userId && !hasMinRole(ctx.role, 'admin')) {
      throw new ForbiddenError('You can only disconnect your own WhatsApp');
    }

    const db = supabaseAdmin();
    const { data: session, error: findError } = await db
      .from('whatsapp_sessions')
      .select('user_id, zapi_instance_id, zapi_instance_token, account_id')
      .eq('user_id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (findError) {
      console.error('[whatsapp-sessions] lookup failed:', findError);
      return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Best-effort against Z-API — the DB row is the source of truth for
    // the UI, so a slow/unreachable gateway shouldn't block the user
    // from clearing their own connection state. Unlike the old Evolution
    // API flow there's no "delete instance": a regular Z-API account's
    // instance keeps existing and being billed until cancelled by hand
    // in their dashboard — the UI must warn about that separately.
    if (session.zapi_instance_id && session.zapi_instance_token) {
      try {
        await disconnectInstance(session.zapi_instance_id, session.zapi_instance_token);
      } catch (err) {
        console.error('[whatsapp-sessions] Z-API disconnect failed:', err);
      }
    }

    // Disconnecting wipes everything this connection ever imported —
    // reconnecting later (a different QR scan could even be a
    // different phone) starts clean rather than silently reattaching
    // to a stranger's old conversations. Read the conversation ids
    // BEFORE deleting the session: the FK is ON DELETE SET NULL, so
    // deleting whatsapp_sessions first would sever the very link this
    // query needs to find what to clean up.
    const { data: convRows } = await db
      .from('conversations')
      .select('id, contact_id')
      .eq('whatsapp_session_id', id);

    const conversationIds = (convRows ?? []).map((c) => c.id);
    const contactIds = [...new Set((convRows ?? []).map((c) => c.contact_id))];

    if (conversationIds.length > 0) {
      const { data: dealRows } = await db
        .from('deals')
        .select('id')
        .in('conversation_id', conversationIds);
      const dealIds = (dealRows ?? []).map((d) => d.id);
      if (dealIds.length > 0) {
        await db.from('deal_line_items').delete().in('deal_id', dealIds);
        await db.from('deal_activities').delete().in('deal_id', dealIds);
        await db.from('deals').delete().in('id', dealIds);
      }
      await db.from('messages').delete().in('conversation_id', conversationIds);
      await db.from('conversations').delete().in('id', conversationIds);
    }
    if (contactIds.length > 0) {
      await db.from('contacts').delete().in('id', contactIds);
    }
    await db.from('whatsapp_history_import_chats').delete().eq('user_id', id);

    const { error: deleteError } = await db
      .from('whatsapp_sessions')
      .delete()
      .eq('user_id', id);

    if (deleteError) {
      console.error('[whatsapp-sessions] delete failed:', deleteError);
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedConversations: conversationIds.length,
      deletedContacts: contactIds.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
