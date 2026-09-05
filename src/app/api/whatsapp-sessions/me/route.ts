import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/** GET /api/whatsapp-sessions/me — the caller's own connection status. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('whatsapp_sessions')
      .select('user_id, status, phone_number, connected_at, created_at')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (error) {
      console.error('[whatsapp-sessions/me] query failed:', error);
      return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
    }

    return NextResponse.json({ session: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
