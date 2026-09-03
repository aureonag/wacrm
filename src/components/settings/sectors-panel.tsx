'use client';

// SectorsPanel — Settings → Sectors (Setores, migration 058). Independent
// of Cargo — a member's sector(s) feed future distribution/reporting
// (Etapa 3), not access control. Same list+create-dialog shape as
// ContractTemplatesPanel/RolesPanel.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Radar, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';
import type { Sector } from '@/types';

export function SectorsPanel() {
  const t = useTranslations('Settings.sectors');

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Sector | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/sectors', { cache: 'no-store' });
      if (res.ok) setSectors(((await res.json()) as { sectors: Sector[] }).sectors);
    } catch (err) {
      console.error('[SectorsPanel] load error:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/account/sectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('saveError'));
        return;
      }
      toast.success(t('savedToast', { name: name.trim() }));
      setDialogOpen(false);
      setName('');
      await load();
    } catch (err) {
      console.error('[SectorsPanel] save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/account/sectors/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('deleteError'));
        return;
      }
      toast.success(t('deletedToast', { name: deleting.name }));
      setSectors((prev) => prev.filter((s) => s.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      console.error('[SectorsPanel] delete error:', err);
      toast.error(t('deleteError'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              {t('newSector')}
            </Button>
          </RequireRole>
        }
      />

      {sectors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Radar className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {sectors.map((sector) => (
                <li key={sector.id} className="flex items-center justify-between px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Radar className="size-4 text-muted-foreground" />
                    {sector.name}
                  </span>
                  <RequireRole min="admin">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleting(sector)}
                      className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('newSector')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted text-foreground"
            />
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('deleteDesc', { name: deleting?.name ?? '' })}</p>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setDeleting(null)} className="border-border text-muted-foreground hover:bg-muted">
              {t('cancel')}
            </Button>
            <Button onClick={handleDelete} className="bg-red-600 text-white hover:bg-red-700">
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
