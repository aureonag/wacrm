import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  configureWebhook,
  fetchConnectionState,
  fetchQrCode,
  isZApiConfigured,
  ZApiError,
} from '@/lib/whatsapp-sessions/zapi-client';

function webhookUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be set to register the Z-API webhook',
    );
  }
  return `${site.replace(/\/+$/, '')}/api/whatsapp-sessions/webhook`;
}

/**
 * POST /api/whatsapp-sessions — connect (or reconnect) the caller's own
 * personal WhatsApp.
 *
 * Unlike the old Evolution API flow, this app doesn't create the
 * underlying instance — a regular (non-"integrador") Z-API account only
 * creates instances by hand in their own dashboard. On first connect the
 * caller pastes the Instance ID + Instance Token they got from
 * app.z-api.io into the request body; we save them, point every Z-API
 * webhook at our route, and fetch the QR. On a later call while still
 * disconnected, the saved credentials are reused to just refresh the QR.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();

    if (!isZApiConfigured()) {
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

    let instanceId: string;
    let instanceToken: string;

    if (existing?.zapi_instance_id && existing?.zapi_instance_token) {
      instanceId = existing.zapi_instance_id;
      instanceToken = existing.zapi_instance_token;
    } else {
      const body = await req.json().catch(() => ({}));
      instanceId = typeof body?.instanceId === 'string' ? body.instanceId.trim() : '';
      instanceToken = typeof body?.instanceToken === 'string' ? body.instanceToken.trim() : '';
      if (!instanceId || !instanceToken) {
        return NextResponse.json(
          { error: 'Informe o Instance ID e o Instance Token da sua instância Z-API' },
          { status: 400 },
        );
      }
      await configureWebhook(instanceId, instanceToken, webhookUrl());
    }

    // A pasted-in instance may already be paired (e.g. someone scanned
    // the QR straight from the Z-API dashboard before ever touching the
    // CRM) — check the real state instead of always assuming a QR is
    // needed, or the panel would be stuck showing nothing.
    const state = await fetchConnectionState(instanceId, instanceToken);
    const qrBase64 = state === 'connected' ? null : await fetchQrCode(instanceId, instanceToken);

    const { error: upsertError } = await db.from('whatsapp_sessions').upsert(
      {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        zapi_instance_id: instanceId,
        zapi_instance_token: instanceToken,
        status: state === 'connected' ? 'connected' : 'connecting',
        connected_at: state === 'connected' ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id' },
    );
    if (upsertError) {
      console.error('[whatsapp-sessions] upsert failed:', upsertError);
      return NextResponse.json({ error: 'Failed to save session' }, { status: 500 });
    }

    return NextResponse.json({ qrBase64 });
  } catch (err) {
    if (err instanceof ZApiError) {
      console.error('[whatsapp-sessions] Z-API error:', err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('[whatsapp-sessions] POST failed:', err);
    return toErrorResponse(err);
  }
}
