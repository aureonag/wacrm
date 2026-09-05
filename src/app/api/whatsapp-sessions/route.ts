import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  createInstance,
  EvolutionApiError,
  fetchQrCode,
  isEvolutionApiConfigured,
  setInstanceWebhook,
} from '@/lib/whatsapp-sessions/evolution-client';

// Deterministic, globally-unique-enough instance name — Evolution API
// instance names are unique across the whole deployment (shared by
// every account), not just within ours, so keying by user_id (already
// a global UUID) is sufficient without needing the account_id in it.
function instanceNameFor(userId: string): string {
  return `wacrm_${userId}`;
}

function webhookUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be set to register the Evolution API webhook',
    );
  }
  return `${site.replace(/\/+$/, '')}/api/whatsapp-sessions/webhook`;
}

/**
 * POST /api/whatsapp-sessions — connect (or reconnect) the caller's
 * own personal WhatsApp. Creates the Evolution API instance on first
 * call; on a later call while still disconnected, just re-fetches a
 * fresh QR for the same instance (Evolution rejects re-creating an
 * instance name that already exists).
 */
export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    if (!isEvolutionApiConfigured()) {
      return NextResponse.json(
        { error: 'WhatsApp pessoal não está configurado neste ambiente' },
        { status: 503 },
      );
    }

    const db = supabaseAdmin();
    const { data: existing } = await db
      .from('whatsapp_sessions')
      .select('*')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (existing?.status === 'connected') {
      return NextResponse.json(
        { error: 'Seu WhatsApp já está conectado. Desconecte antes de gerar um novo QR.' },
        { status: 409 },
      );
    }

    let qrBase64: string | null;
    let instanceName: string;

    if (existing) {
      instanceName = existing.instance_name;
      qrBase64 = await fetchQrCode(instanceName);
    } else {
      instanceName = instanceNameFor(ctx.userId);
      const created = await createInstance(instanceName);
      await setInstanceWebhook(instanceName, webhookUrl());
      qrBase64 = created.qrBase64 ?? (await fetchQrCode(instanceName));
    }

    const { error: upsertError } = await db.from('whatsapp_sessions').upsert(
      {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        instance_name: instanceName,
        status: 'connecting',
      },
      { onConflict: 'user_id' },
    );
    if (upsertError) {
      console.error('[whatsapp-sessions] upsert failed:', upsertError);
      return NextResponse.json({ error: 'Failed to save session' }, { status: 500 });
    }

    return NextResponse.json({ qrBase64, instanceName });
  } catch (err) {
    if (err instanceof EvolutionApiError) {
      console.error('[whatsapp-sessions] Evolution API error:', err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('[whatsapp-sessions] POST failed:', err);
    return toErrorResponse(err);
  }
}
