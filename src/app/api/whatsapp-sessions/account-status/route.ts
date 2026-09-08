import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/**
 * GET /api/whatsapp-sessions/account-status — whether ANY team member's
 * personal QR connection is usable for this account, regardless of
 * which one of them is asking. `whatsapp_sessions` RLS only lets a user
 * read their own row (or an admin read every row) — a plain agent
 * checking a teammate's connection would see nothing and the Inbox
 * banner would wrongly claim WhatsApp is disconnected. Runs with the
 * service-role client so the check is correct for every role, with the
 * account already resolved server-side (never client-supplied).
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const db = supabaseAdmin();
    const { data, error } = await db
      .from('whatsapp_sessions')
      .select('user_id')
      .eq('account_id', ctx.accountId)
      .eq('status', 'connected')
      .limit(1);

    if (error) {
      console.error('[whatsapp-sessions/account-status] query failed:', error);
      return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
    }

    return NextResponse.json({ anyConnected: (data?.length ?? 0) > 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
