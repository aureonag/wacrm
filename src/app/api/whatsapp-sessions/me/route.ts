import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/** GET /api/whatsapp-sessions/me — the caller's own connection status. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('whatsapp_sessions')
      .select(
        'user_id, status, phone_number, connected_at, created_at, zapi_instance_id, zapi_instance_token',
      )
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (error) {
      console.error('[whatsapp-sessions/me] query failed:', error);
      return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ session: null });
    }

    // Never send the raw instance token to the client — only whether
    // it's already saved, which is all the connect form needs.
    const { zapi_instance_id, zapi_instance_token, ...rest } = data;
    const session = {
      ...rest,
      hasZapiCredentials: Boolean(zapi_instance_id && zapi_instance_token),
    };

    return NextResponse.json({ session });
  } catch (err) {
    return toErrorResponse(err);
  }
}
