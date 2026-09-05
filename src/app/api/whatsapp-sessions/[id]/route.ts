import { NextResponse } from 'next/server';

import { ForbiddenError, getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { deleteInstance, logoutInstance } from '@/lib/whatsapp-sessions/evolution-client';

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
      .select('user_id, instance_name, account_id')
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

    // Best-effort against Evolution API — the DB row is the source of
    // truth for the UI, so a slow/unreachable gateway shouldn't block
    // the user from clearing their own connection state.
    try {
      await logoutInstance(session.instance_name);
      await deleteInstance(session.instance_name);
    } catch (err) {
      console.error('[whatsapp-sessions] Evolution API cleanup failed:', err);
    }

    const { error: deleteError } = await db
      .from('whatsapp_sessions')
      .delete()
      .eq('user_id', id);

    if (deleteError) {
      console.error('[whatsapp-sessions] delete failed:', deleteError);
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
