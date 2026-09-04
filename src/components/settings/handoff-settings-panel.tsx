'use client';

// HandoffSettingsPanel — Settings → Handoff Operacional (migration 070,
// Etapa 3 Fase 3). Account-wide defaults consumed by
// create_kickoff_task_for_deal() the moment a deal is marked won: which
// board/stage a kickoff task lands in, and its default sector/assignee/
// title template/due offset. Same list+form shape as SectorsPanel, but a
// single row (upsert) instead of a collection.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Rocket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { loadBoards, loadBoardStages, loadAccountProfiles } from '@/lib/tasks/queries';
import type { Board, BoardStage, OperationalHandoffDefaults, Profile, Sector } from '@/types';

const NONE = '__none';

export function HandoffSettingsPanel() {
  const t = useTranslations('Settings.handoff');
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [boardId, setBoardId] = useState<string>(NONE);
  const [stageId, setStageId] = useState<string>(NONE);
  const [sectorId, setSectorId] = useState<string>(NONE);
  const [assigneeId, setAssigneeId] = useState<string>(NONE);
  const [titleTemplate, setTitleTemplate] = useState('Kickoff - {deal}');
  const [dueOffsetDays, setDueOffsetDays] = useState<string>('');

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const [boardRows, sectorRows, profileRows, res] = await Promise.all([
        loadBoards(supabase),
        supabase.from('sectors').select('*').eq('account_id', accountId).order('name'),
        loadAccountProfiles(supabase, accountId),
        fetch('/api/operational/handoff-defaults', { cache: 'no-store' }),
      ]);
      setBoards(boardRows);
      setSectors((sectorRows.data ?? []) as Sector[]);
      setProfiles(profileRows);

      if (res.ok) {
        const { defaults } = (await res.json()) as { defaults: OperationalHandoffDefaults | null };
        if (defaults) {
          setBoardId(defaults.board_id ?? NONE);
          setStageId(defaults.initial_stage_id ?? NONE);
          setSectorId(defaults.default_sector_id ?? NONE);
          setAssigneeId(defaults.default_assignee_id ?? NONE);
          setTitleTemplate(defaults.title_template || 'Kickoff - {deal}');
          setDueOffsetDays(defaults.due_offset_days != null ? String(defaults.due_offset_days) : '');
          if (defaults.board_id) {
            setStages(await loadBoardStages(supabase, defaults.board_id));
          }
        }
      }
    } catch (err) {
      console.error('[HandoffSettingsPanel] load error:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleBoardChange(value: string | null) {
    if (value === null) return;
    setBoardId(value);
    setStageId(NONE);
    if (value === NONE) {
      setStages([]);
      return;
    }
    const supabase = createClient();
    setStages(await loadBoardStages(supabase, value));
  }

  async function handleSave() {
    if (boardId === NONE || stageId === NONE) {
      toast.error(t('boardAndStageRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/operational/handoff-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: boardId,
          initial_stage_id: stageId,
          default_sector_id: sectorId === NONE ? null : sectorId,
          default_assignee_id: assigneeId === NONE ? null : assigneeId,
          title_template: titleTemplate.trim() || 'Kickoff - {deal}',
          due_offset_days: dueOffsetDays.trim() ? Number(dueOffsetDays) : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('saveError'));
        return;
      }
      toast.success(t('savedToast'));
    } catch (err) {
      console.error('[HandoffSettingsPanel] save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
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
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('board')}</Label>
            <Select value={boardId} onValueChange={handleBoardChange}>
              <SelectTrigger className="bg-muted text-foreground">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('none')}</SelectItem>
                {boards.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('initialStage')}</Label>
            <Select value={stageId} onValueChange={(v) => setStageId(v ?? NONE)} disabled={boardId === NONE}>
              <SelectTrigger className="bg-muted text-foreground">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('defaultSector')}</Label>
            <Select value={sectorId} onValueChange={(v) => setSectorId(v ?? NONE)}>
              <SelectTrigger className="bg-muted text-foreground">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('none')}</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('defaultAssignee')}</Label>
            <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
              <SelectTrigger className="bg-muted text-foreground">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('none')}</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('titleTemplate')}</Label>
            <Input
              value={titleTemplate}
              onChange={(e) => setTitleTemplate(e.target.value)}
              placeholder="Kickoff - {deal}"
              className="bg-muted text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('dueOffsetDays')}</Label>
            <Input
              type="number"
              min={0}
              value={dueOffsetDays}
              onChange={(e) => setDueOffsetDays(e.target.value)}
              placeholder={t('dueOffsetPlaceholder')}
              className="bg-muted text-foreground"
            />
          </div>
        </CardContent>
      </Card>

      <RequireRole min="admin">
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Rocket className="size-4" />
            )}
            {t('save')}
          </Button>
        </div>
      </RequireRole>
    </section>
  );
}
