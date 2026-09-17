// ============================================================
// PATCH /api/chat/channels/[id] — rename, edit description, or
// archive/unarchive a channel. Admin+ only (Fase 1's coarse role
// model — see migration 084's header comment), enforced here and by
// the `chat_channels_update` RLS policy.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const update: Record<string, unknown> = {};

    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: 'Channel name is required' }, { status: 400 });
      if (name.length > 80) return NextResponse.json({ error: 'Channel name is too long' }, { status: 400 });
      update.name = name;
    }
    if (body?.description !== undefined) {
      update.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null;
    }
    if (body?.archived === true) update.archived_at = new Date().toISOString();
    if (body?.archived === false) update.archived_at = null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('chat_channels')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/chat/channels/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    return NextResponse.json({ channel: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
