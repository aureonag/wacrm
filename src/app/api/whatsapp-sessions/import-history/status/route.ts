import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/**
 * GET /api/whatsapp-sessions/import-history/status — current progress,
 * so the settings panel can show a resume banner ("continuar
 * importação") after a page reload or a closed tab left a run
 * mid-way, instead of the client's in-memory loop being the only
 * record that an import is underway.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: session } = await ctx.supabase
      .from('whatsapp_sessions')
      .select('history_import_status')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    const [{ count: totalChats }, { count: doneChats }] = await Promise.all([
      ctx.supabase
        .from('whatsapp_history_import_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', ctx.userId),
      ctx.supabase
        .from('whatsapp_history_import_chats')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', ctx.userId)
        .eq('status', 'done'),
    ]);

    return NextResponse.json({
      status: session?.history_import_status ?? 'idle',
      totalChats: totalChats ?? 0,
      doneChats: doneChats ?? 0,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
