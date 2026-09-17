// ============================================================
// GET  /api/chat/channels — list channels visible to the caller.
// POST /api/chat/channels — create a channel.
//
// Visibility is enforced by RLS (`can_access_chat_channel`, migration
// 084) — every account member sees public channels, private channels
// only if they're a member. The `.eq('account_id', ...)` filter below
// is belt-and-braces, same reasoning as api-keys/[id]/route.ts.
//
// Any account member can create a channel (Fase 1's deliberately open
// model — see migration 084's header comment). Rename/archive is
// admin+, enforced in [id]/route.ts.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('chat_channels')
      .select('*')
      .eq('account_id', ctx.accountId)
      .is('archived_at', null)
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/chat/channels] error:', error);
      return NextResponse.json({ error: 'Failed to load channels' }, { status: 500 });
    }

    return NextResponse.json({ channels: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`chat:createChannel:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
    const isPrivate = body?.is_private === true;

    if (!name) {
      return NextResponse.json({ error: 'Channel name is required' }, { status: 400 });
    }
    if (name.length > 80) {
      return NextResponse.json({ error: 'Channel name is too long' }, { status: 400 });
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
      .from('chat_channels')
      .insert({
        account_id: ctx.accountId,
        name,
        description,
        is_private: isPrivate,
        created_by: profile.id,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[POST /api/chat/channels] error:', error);
      return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 });
    }

    // Private channels start with just the creator as a member so it's
    // immediately visible to them via can_access_chat_channel — other
    // members are added afterwards through chat_channel_members.
    if (isPrivate) {
      const { error: memberErr } = await ctx.supabase
        .from('chat_channel_members')
        .insert({ channel_id: data.id, profile_id: profile.id });
      if (memberErr) {
        console.error('[POST /api/chat/channels] member insert error:', memberErr);
      }
    }

    return NextResponse.json({ channel: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
