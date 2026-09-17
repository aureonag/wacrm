// ============================================================
// GET  /api/chat/channels/[id]/messages — paginated history.
// POST /api/chat/channels/[id]/messages — send a message.
//
// Channel visibility (public vs private-membership) is enforced by
// the `can_access_chat_channel` RLS predicate (migration 084) on both
// verbs — a caller who can't see the channel gets an empty/failed
// result here rather than a 403, matching how the rest of the app
// lets RLS do the real gatekeeping and the route stay simple.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const PAGE_SIZE = 50;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');

    let query = ctx.supabase
      .from('chat_messages')
      .select('*, author:profiles!chat_messages_author_id_fkey(id, full_name, avatar_url)')
      .eq('channel_id', id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;

    if (error) {
      console.error('[GET /api/chat/channels/[id]/messages] error:', error);
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    }

    return NextResponse.json({ messages: (data ?? []).reverse() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const limit = checkRateLimit(`chat:send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const content = typeof body?.content === 'string' && body.content.trim() ? body.content.trim() : null;
    const attachmentUrl = typeof body?.attachment_url === 'string' ? body.attachment_url : null;
    const attachmentType = typeof body?.attachment_type === 'string' ? body.attachment_type : null;
    const attachmentName = typeof body?.attachment_name === 'string' ? body.attachment_name : null;
    const replyToId = typeof body?.reply_to_id === 'string' ? body.reply_to_id : null;

    if (!content && !attachmentUrl) {
      return NextResponse.json({ error: 'Message needs content or an attachment' }, { status: 400 });
    }
    if (content && content.length > 4000) {
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
      .insert({
        channel_id: id,
        account_id: ctx.accountId,
        author_id: profile.id,
        content,
        attachment_url: attachmentUrl,
        attachment_type: attachmentType,
        attachment_name: attachmentName,
        reply_to_id: replyToId,
      })
      .select('*, author:profiles!chat_messages_author_id_fkey(id, full_name, avatar_url)')
      .single();

    if (error) {
      console.error('[POST /api/chat/channels/[id]/messages] error:', error);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
