'use client';

// ============================================================
// RoleEditorDialog — create / edit a cargo (Settings → Cargos e permissões).
//
// Same look as "Gerenciar acesso" of a person (Membros da equipe): wide dialog,
// one card per menu section in two balanced columns, a switch per item. A cargo
// is the DEFAULT package for a group of people; "Gerenciar acesso" adds the
// exceptions of one person on top of it.
//
// Two parts, on purpose:
//   1. Menu lateral  — what shows up in the sidebar (the `comercial:<item>:view`
//      permissions, registry in nav-modules.ts). One switch per item.
//   2. O que pode fazer — the actions inside the system (create / edit / delete
//      contacts, deals, tasks, timesheet…), with names in Portuguese.
// ============================================================

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { AFFILIATES_MENU_MODULE, NAV_MODULES, NAV_SECTIONS } from './nav-modules';
import type { Permission, PlatformEnvironment, Role } from '@/types';

const ENVIRONMENTS: PlatformEnvironment[] = ['comercial', 'operational'];
const ENV_ICON: Record<PlatformEnvironment, typeof Briefcase> = {
  comercial: Briefcase,
  operational: Workflow,
};

/** Menu items already have their own switch above: their "Visualizar" is not listed again as an action. */
const NAV_MODULE_SET = new Set(NAV_MODULES.map((m) => m.module));

/** Modules with a friendly name in the "Settings.rolesPanel.modules" messages. */
const KNOWN_MODULES = new Set(['contacts', 'deals', 'pipelines', 'tasks', 'dashboard', 'timesheet']);

/** Reading order of actions inside a module (anything not listed goes last). */
const ACTION_ORDER = [
  'view', 'view_boards', 'view_tasks', 'view_own', 'view_sector', 'view_all', 'view_team',
  'create', 'create_boards', 'create_tasks',
  'edit', 'edit_boards', 'edit_tasks', 'move_tasks',
  'comment', 'add_files', 'approve', 'track', 'log_manual', 'edit_entries',
  'delete', 'delete_boards', 'delete_tasks',
];
const actionRank = (action: string) => {
  const i = ACTION_ORDER.indexOf(action);
  return i === -1 ? ACTION_ORDER.length : i;
};

interface RoleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creating a new cargo. */
  role: Role | null;
  permissions: Permission[];
  onSaved: () => void | Promise<void>;
}

export function RoleEditorDialog({ open, onOpenChange, role, permissions, onSaved }: RoleEditorDialogProps) {
  // The parent mounts a fresh editor for each cargo (key), so the drafts start from it.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-5xl">
        <RoleEditorBody key={role?.id ?? 'new'} role={role} permissions={permissions} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function RoleEditorBody({
  role,
  permissions,
  onClose,
  onSaved,
}: {
  role: Role | null;
  permissions: Permission[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('Settings.rolesPanel');
  const tEnv = useTranslations('Sidebar.environment');
  const tSidebar = useTranslations('Sidebar');

  const [name, setName] = useState(role?.name ?? '');
  const [environments, setEnvironments] = useState<Set<PlatformEnvironment>>(new Set(role?.environments ?? []));
  const [permissionIds, setPermissionIds] = useState<Set<string>>(new Set(role?.permission_ids ?? []));
  const [saving, setSaving] = useState(false);

  // permission id of each menu item (comercial:<module>:view) and of the Afiliados access
  const { navIdByModule, affiliatesAccessId } = useMemo(() => {
    const nav = new Map<string, string>();
    let access: string | undefined;
    for (const p of permissions) {
      if (p.environment === 'comercial' && p.action === 'view') nav.set(p.module, p.id);
      if (p.environment === 'operational' && p.module === 'affiliates' && p.action === 'access') access = p.id;
    }
    return { navIdByModule: nav, affiliatesAccessId: access };
  }, [permissions]);

  // "O que pode fazer": environment → module → actions (menu items and the Afiliados access excluded)
  const actionGroups = useMemo(() => {
    const byEnv = new Map<PlatformEnvironment, Map<string, Permission[]>>();
    for (const p of permissions) {
      if (p.environment === 'operational' && p.module === 'affiliates') continue;
      if (p.environment === 'comercial' && NAV_MODULE_SET.has(p.module) && p.action === 'view') continue;
      const modules = byEnv.get(p.environment) ?? new Map<string, Permission[]>();
      const list = modules.get(p.module) ?? [];
      list.push(p);
      modules.set(p.module, list);
      byEnv.set(p.environment, modules);
    }
    for (const modules of byEnv.values()) {
      for (const list of modules.values()) list.sort((a, b) => actionRank(a.action) - actionRank(b.action));
    }
    return byEnv;
  }, [permissions]);

  const has = (id: string | undefined) => !!id && permissionIds.has(id);

  function setPermission(id: string | undefined, on: boolean) {
    if (!id) return;
    setPermissionIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Menu switch. Afiliados also carries the right to OPEN the area (same rule as "Gerenciar acesso"). */
  function setNav(module: string, on: boolean) {
    setPermissionIds((prev) => {
      const next = new Set(prev);
      const ids = [navIdByModule.get(module)];
      if (module === AFFILIATES_MENU_MODULE) ids.push(affiliatesAccessId);
      for (const id of ids) {
        if (!id) continue;
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleEnvironment(env: PlatformEnvironment) {
    setEnvironments((prev) => {
      const next = new Set(prev);
      if (next.has(env)) next.delete(env);
      else next.add(env);
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
      const payload = { name: name.trim(), environments: [...environments], permission_ids: [...permissionIds] };
      const res = role
        ? await fetch(`/api/account/roles/${role.id}`, {
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
      onClose();
      await onSaved();
    } catch (err) {
      console.error('[RoleEditorDialog] save error:', err);
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  // Menu cards into two columns by height — same rule as "Gerenciar acesso", so no holes.
  const columns: (typeof NAV_SECTIONS)[] = [[], []];
  const heights = [0, 0];
  for (const section of NAV_SECTIONS) {
    const target = heights[0] <= heights[1] ? 0 : 1;
    columns[target].push(section);
    heights[target] += 2 + section.items.length + (section.noteKey ? 1 : 0);
  }

  const moduleName = (module: string) => (KNOWN_MODULES.has(module) ? t(`modules.${module}`) : module);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-popover-foreground">
          {role ? t('editTitle') : t('newRole')}
          {role ? <span className="font-normal text-muted-foreground"> — {role.name}</span> : null}
        </DialogTitle>
      </DialogHeader>

      <div className="max-h-[72vh] space-y-7 overflow-y-auto pr-4">
        {/* name + environments */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
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
            <div className="grid gap-3 sm:grid-cols-2">
              {ENVIRONMENTS.map((env) => {
                const Icon = ENV_ICON[env];
                const on = environments.has(env);
                return (
                  <label
                    key={env}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                      on ? 'border-primary/50 bg-primary/10' : 'border-border bg-card/40 hover:bg-muted/40',
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={() => toggleEnvironment(env)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Icon className="size-4 text-muted-foreground" />
                        {tEnv(env)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t(`environmentHint.${env}`)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 1. menu */}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('menuSectionTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('menuSectionDesc')}</p>
          <div className="mt-4 grid items-start gap-5 lg:grid-cols-2">
            {columns.map((sections, index) => (
              <div key={index} className="flex flex-col gap-5">
                {sections.map((section) => (
                  <section key={section.key} className="overflow-hidden rounded-xl border border-border bg-card/40">
                    <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
                      <h4 className="text-sm font-semibold text-foreground">{tSidebar(section.titleKey)}</h4>
                      {section.master.module && (
                        <label className="flex cursor-pointer items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">{tSidebar(section.master.labelKey)}</span>
                          <Switch
                            checked={has(navIdByModule.get(section.master.module))}
                            onCheckedChange={(on) => setNav(section.master.module, on)}
                          />
                        </label>
                      )}
                    </header>
                    {section.noteKey && <p className="px-4 py-3 text-xs text-muted-foreground">{tSidebar(section.noteKey)}</p>}
                    {section.items.length > 0 && (
                      <div className="divide-y divide-border/50 px-4">
                        {section.items.map((item) => (
                          <label key={item.module} className="flex cursor-pointer items-center justify-between gap-3 py-2">
                            <span className="text-sm text-foreground">{tSidebar(item.labelKey)}</span>
                            <Switch
                              checked={has(navIdByModule.get(item.module))}
                              onCheckedChange={(on) => setNav(item.module, on)}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 2. actions */}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('actionsTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('actionsDesc')}</p>
          <div className="mt-4 grid items-start gap-5 lg:grid-cols-2">
            {ENVIRONMENTS.map((env) => {
              const modules = actionGroups.get(env);
              if (!modules || modules.size === 0) return null;
              const Icon = ENV_ICON[env];
              return (
                <section key={env} className="overflow-hidden rounded-xl border border-border bg-card/40">
                  <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                    <Icon className="size-4 text-muted-foreground" />
                    <h4 className="text-sm font-semibold text-foreground">{tEnv(env)}</h4>
                  </header>
                  <div className="divide-y divide-border/50 px-4">
                    {[...modules.entries()].map(([module, perms]) => (
                      <div key={module} className="py-3">
                        <p className="mb-2 text-sm font-medium text-foreground">{moduleName(module)}</p>
                        <div className="flex flex-wrap gap-2">
                          {perms.map((perm) => {
                            const on = permissionIds.has(perm.id);
                            return (
                              <label
                                key={perm.id}
                                className={cn(
                                  'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                                  on
                                    ? 'border-primary/50 bg-primary/10 text-foreground'
                                    : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
                                )}
                              >
                                <Checkbox checked={on} onCheckedChange={(v) => setPermission(perm.id, v === true)} />
                                {perm.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      <DialogFooter className="border-border bg-popover/50">
        <Button variant="outline" onClick={onClose} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
          {t('cancel')}
        </Button>
        <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </>
  );
}
