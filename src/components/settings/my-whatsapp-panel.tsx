'use client';

// MyWhatsAppPanel — Settings → Meu WhatsApp (migration 072, Fase 1).
// Personal WhatsApp connection via QR code (Evolution API), separate
// from the account-wide official Meta number configured in the
// "WhatsApp" section above. Any account member manages only their own
// row — no RequireRole gate needed here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, QrCode, Smartphone, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { SettingsPanelHead } from './settings-panel-head';
import type { WhatsAppSession } from '@/types';

const POLL_MS = 3000;

export function MyWhatsAppPanel() {
  const t = useTranslations('Settings.myWhatsapp');
  const { user } = useAuth();

  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<WhatsAppSession | null> => {
    const res = await fetch('/api/whatsapp-sessions/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { session: WhatsAppSession | null };
    setSession(body.session);
    return body.session;
  }, []);

  useEffect(() => {
    void loadStatus().finally(() => setLoading(false));
    return () => stopPolling();
  }, [loadStatus, stopPolling]);

  // Realtime: reflect the webhook flipping status to 'connected' the
  // moment it happens, without waiting for the next poll tick.
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`whatsapp_sessions:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void loadStatus();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadStatus]);

  // While waiting for a scan, poll status so the QR view flips to
  // "connected" without the user needing to refresh the page.
  useEffect(() => {
    if (session?.status !== 'connecting') {
      stopPolling();
      return;
    }
    pollRef.current = setInterval(() => {
      void loadStatus().then((s) => {
        if (s?.status === 'connected') stopPolling();
      });
    }, POLL_MS);
    return stopPolling;
  }, [session?.status, loadStatus, stopPolling]);

  async function handleConnect() {
    setConnecting(true);
    setQrBase64(null);
    try {
      const res = await fetch('/api/whatsapp-sessions', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || t('connectError'));
        return;
      }
      setQrBase64(body.qrBase64 ?? null);
      await loadStatus();
    } catch (err) {
      console.error('[MyWhatsAppPanel] connect failed:', err);
      toast.error(t('connectError'));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!user?.id) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/whatsapp-sessions/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('disconnectError'));
        return;
      }
      setQrBase64(null);
      setSession(null);
      toast.success(t('disconnectedToast'));
    } catch (err) {
      console.error('[MyWhatsAppPanel] disconnect failed:', err);
      toast.error(t('disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const status = session?.status ?? 'disconnected';

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          {status === 'connected' ? (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Smartphone className="size-7" />
              </div>
              <div>
                <p className="font-medium text-foreground">{t('connected')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {session?.phone_number
                    ? t('connectedPhone', { phone: session.phone_number })
                    : t('connectedDesc')}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                {t('disconnect')}
              </Button>
            </>
          ) : qrBase64 ? (
            <>
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt={t('qrAlt')}
                className="size-56 rounded-lg border border-border bg-white p-2"
              />
              <p className="max-w-[42ch] text-sm text-muted-foreground">
                {t('scanInstructions')}
              </p>
              <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                {t('newQr')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <QrCode className="size-7" />
              </div>
              <div>
                <p className="font-medium text-foreground">{t('notConnected')}</p>
                <p className="mt-1 max-w-[42ch] text-sm text-muted-foreground">
                  {t('notConnectedDesc')}
                </p>
              </div>
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                {t('connect')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
