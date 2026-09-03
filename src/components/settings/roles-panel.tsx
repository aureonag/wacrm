'use client';

// ============================================================
// RolesPanel — Settings → Roles & permissions (Cargos e Permissões)
//
// Migration 058's admin UI: list of cargos, each with the environments
// it grants and a permission matrix (environment → module → action).
// Mirrors MembersTab's structure (roster + create dialog) and
// ContractTemplatesPanel's create/edit Dialog pattern.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, Loader2, Lock, Pencil, Plus, ShieldCheck, Trash2, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { PlatformEnvironment, Permission, Role } from '@/types';

const ENVIRONMENTS: PlatformEnvironment[] = ['comercial', 'operational'];
const ENV_ICON: Record<PlatformEnvironment, typeof Briefcase> = {
  comercial: Briefcase,
  operational: Workflow,
};

export function RolesPanel() {
  const t = useTranslations('Settings.rolesPanel');
  const tEnv = useTranslations('Sidebar.environment');

  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [environments, setEnvironments] = useState<Set<PlatformEnvironment>>(new Set());
  const [permissionIds, setPermissionIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const load = useCallback(async () => {
    try {
      const [rres, pres] = await Promise.all([
        fetch('/api/account/roles', { cache: 'no-store' }),
        fetch('/api/account/permissions', { cache: 'no-store' }),
      ]);
      if (rres.ok) setRoles(((await rres.json()) as { roles: Role[] }).roles);
      if (pres.ok) setPermissions(((await pres.json()) as { permissions: Permission[] }).permissions);
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

  const permissionsByEnvModule = useMemo(() => {
    const map = new Map<PlatformEnvironment, Map<string, Permission[]>>();
    for (const perm of permissions) {
      const envMap = map.get(perm.environment) ?? new Map<string, Permission[]>();
      const bucket = envMap.get(perm.module) ?? [];
      bucket.push(perm);
      envMap.set(perm.module, bucket);
      map.set(perm.environment, envMap);
    }
    return map;
  }, [permissions]);

  function openCreate() {
    setEditing(null);
    setName('');
    setEnvironments(new Set());
    setPermissionIds(new Set());
    setDialogOpen(true);
  }

  function openEdit(role: Role) {
    setEditing(role);
    setName(role.name);
    setEnvironments(new Set(role.environments));
    setPermissionIds(new Set(role.permission_ids));
    setDialogOpen(true);
  }

  function toggleEnvironment(env: PlatformEnvironment) {
    setEnvironments((prev) => {
      const next = new Set(prev);
      if (next.has(env)) next.delete(env);
      else next.add(env);
      return next;
    });
  }

  function togglePermission(id: string) {
    setPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        environments: [...environments],
        permission_ids: [...permissionIds],
      };
      const res = editing
        ? await fetch(`/api/account/roles/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/account/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || t('saveError'));
        return;
      }
      toast.success(t('savedToast', { name: payload.name }));
      setDialogOpen(false);
      await load();
    } catch (err) {
      console.error('[RolesPanel] save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
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

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <ShieldCheck className="size-4 text-primary" />
                      {role.name}
                    </span>
                    {role.is_system_default && (
                      <Badge className="gap-1 border-border bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Lock className="size-3" />
                        {t('default')}
                      </Badge>
                    )}
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('permissionCount', { count: role.permission_ids.length })}
                  </p>
                </div>
                <RequireRole min="admin">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(role)} className="border-border text-muted-foreground hover:bg-muted">
                      <Pencil className="size-4" />
                    </Button>
                    {!role.is_system_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleting(role)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </RequireRole>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? t('editTitle') : t('newRole')}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('nameLabel')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className="bg-muted text-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('environmentsLabel')}</Label>
              <div className="flex gap-3">
                {ENVIRONMENTS.map((env) => {
                  const Icon = ENV_ICON[env];
                  return (
                    <label key={env} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                      <Checkbox checked={environments.has(env)} onCheckedChange={() => toggleEnvironment(env)} />
                      <Icon className="size-4 text-muted-foreground" />
                      {tEnv(env)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-muted-foreground">{t('permissionsLabel')}</Label>
              {[...permissionsByEnvModule.entries()].map(([env, modules]) => {
                const EnvIcon = ENV_ICON[env];
                return (
                  <div key={env} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <EnvIcon className="size-3.5" />
                      {tEnv(env)}
                    </div>
                    <div className="space-y-2">
                      {[...modules.entries()].map(([module, perms]) => (
                        <div key={module} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                          <span className="w-28 shrink-0 text-xs text-muted-foreground">{module}</span>
                          {perms.map((perm) => (
                            <label key={perm.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
                              <Checkbox
                                checked={permissionIds.has(perm.id)}
                                onCheckedChange={() => togglePermission(perm.id)}
                              />
                              {perm.label}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
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
