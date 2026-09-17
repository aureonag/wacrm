// ============================================================
// PATCH  /api/chat/messages/[id] — edit a message's content. Author
// only (editing someone else's words isn't a moderation action).
//
// DELETE /api/chat/messages/[id] — soft delete: clears content/
// attachment and stamps deleted_at, keeping the row so the channel's
// scroll position and reply threads don't shift. Author or admin+
// (moderation), matching the `chat_messages_update` RLS policy.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
    }
    if (content.length > 4000) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
    }

    const { data: profile, error: profileErr } = await ctx.supabase
      .from('profiles')
      .select('id')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (profileErr || !profile) {
      return NextResponse.json({ error: 'Could not resolve your profile' }, { status: 500 });
    }

    const { data, error } = await ctx.supabase
      .from('chat_messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', id)
      .eq('author_id', profile.id)
      .is('deleted_at', null)
      .select('*, author:profiles!chat_messages_author_id_fkey(id, full_name, avatar_url)')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/chat/messages/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to edit message' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Message not found or not yours to edit' }, { status: 404 });
    }

    return NextResponse.json({ message: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    // RLS (chat_messages_update: author OR admin+) is the real gate —
    // the update below simply relies on it, same pattern as api-keys.
    const { data, error } = await ctx.supabase
      .from('chat_messages')
      .update({
        content: null,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/chat/messages/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Message not found or already deleted' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
