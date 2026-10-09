'use client';

// ============================================================
// RolesPanel — Settings → Roles & permissions (Cargos e Permissões)
//
// Migration 058's admin UI. A cargo is the DEFAULT package for a group of
// people (which menu items they see + what they may do); the exceptions of one
// person are set in Membros da equipe → "Gerenciar acesso", on top of it.
// The editor (RoleEditorDialog) uses the same look as that dialog.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Briefcase, Info, ListChecks, Loader2, Lock, Pencil, Plus, ShieldCheck, Trash2, Users, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';
import { RoleEditorDialog } from './role-editor-dialog';
import { NAV_MODULES } from './nav-modules';
import type { PlatformEnvironment, Permission, Role } from '@/types';

const ENV_ICON: Record<PlatformEnvironment, typeof Briefcase> = {
  comercial: Briefcase,
  operational: Workflow,
};

const NAV_MODULE_SET = new Set(NAV_MODULES.map((m) => m.module));

export function RolesPanel() {
  const t = useTranslations('Settings.rolesPanel');
  const tEnv = useTranslations('Sidebar.environment');

  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [peopleByRole, setPeopleByRole] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const load = useCallback(async () => {
    try {
      const [rres, pres, mres] = await Promise.all([
        fetch('/api/account/roles', { cache: 'no-store' }),
        fetch('/api/account/permissions', { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
      ]);
      if (rres.ok) setRoles(((await rres.json()) as { roles: Role[] }).roles);
      if (pres.ok) setPermissions(((await pres.json()) as { permissions: Permission[] }).permissions);
      if (mres.ok) {
        const members = ((await mres.json()) as { members: { role_id: string | null }[] }).members;
        const counts = new Map<string, number>();
        for (const m of members) if (m.role_id) counts.set(m.role_id, (counts.get(m.role_id) ?? 0) + 1);
        setPeopleByRole(counts);
      }
    } catch (err) {
      console.error('[RolesPanel] load error:', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ids that are menu switches vs "O que pode fazer" actions (Afiliados access counts with its menu item)
  const { navIds, hiddenIds } = useMemo(() => {
    const nav = new Set<string>();
    const hidden = new Set<string>();
    for (const p of permissions) {
      if (p.environment === 'comercial' && p.action === 'view' && NAV_MODULE_SET.has(p.module)) nav.add(p.id);
      if (p.environment === 'operational' && p.module === 'affiliates') hidden.add(p.id);
    }
    return { navIds: nav, hiddenIds: hidden };
  }, [permissions]);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(role: Role) {
    setEditing(role);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/account/roles/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('deleteError'));
        return;
      }
      toast.success(t('deletedToast', { name: deleting.name }));
      setRoles((prev) => prev.filter((r) => r.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      console.error('[RolesPanel] delete error:', err);
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
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('newRole')}
            </Button>
          </RequireRole>
        }
      />

      {/* how cargos and "Gerenciar acesso" fit together */}
      <div className="flex gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="text-xs leading-relaxed text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{t('howTitle')}</p>
          <p className="mt-1">{t('howCargo')}</p>
          <p>
            {t('howPerson')}{' '}
            <Link href="/settings?tab=members" className="font-medium text-primary hover:underline">
              {t('howPersonLink')}
            </Link>
          </p>
        </div>
      </div>

      {/* cargos */}
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const actionCount = role.permission_ids.filter((id) => !navIds.has(id) && !hiddenIds.has(id)).length;
          const people = peopleByRole.get(role.id) ?? 0;
          return (
            <article key={role.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-base font-semibold text-foreground">
                      <ShieldCheck className="size-4 text-primary" />
                      {role.name}
                    </span>
                    {role.is_system_default && (
                      <Badge className="gap-1 border-border bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Lock className="size-3" />
                        {t('default')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {role.environments.map((env) => {
                      const Icon = ENV_ICON[env];
                      return (
                        <Badge key={env} className="gap-1 border-border bg-muted/60 text-[10px] text-muted-foreground">
                          <Icon className="size-3" />
                          {tEnv(env)}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <RequireRole min="admin">
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(role)} className="border-border text-muted-foreground hover:bg-muted">
                      <Pencil className="size-4" />
                      {t('edit')}
                    </Button>
                    {!role.is_system_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleting(role)}
                        aria-label={t('deleteBtn')}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </RequireRole>
              </div>

              <dl className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Users className="size-3.5" />
                    {t('statPeople')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{people}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <ListChecks className="size-3.5" />
                    {t('statActions')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{actionCount}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      <RoleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        role={editing}
        permissions={permissions}
        onSaved={load}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteDesc', { name: deleting?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
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
