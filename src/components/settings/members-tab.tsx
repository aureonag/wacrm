'use client';

// ============================================================
// MembersTab — Settings → Members
//
// Two stacked sections:
//   1. Roster   — every member of the account. Admin+ can change a
//                 teammate's role inline and remove them. Owner row
//                 is non-editable everywhere (transfer is its own
//                 separate flow, deferred to a later PR).
//   2. Pending  — outstanding invite links. Admin+ can revoke. The
//                 plaintext URL is gone after the create dialog
//                 closes, so we surface a "revoke + new link" hint
//                 rather than pretending we can resurface it.
//
// Role-gating
//   The tab itself is reachable by any member, but mutation buttons
//   are wrapped in `<RequireRole min="admin">` / `useCan` so an
//   agent or viewer sees the roster read-only. The server-side
//   RPCs (set_member_role, remove_account_member) double-check
//   the role anyway.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  Mail,
  MailX,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import type { AccountRole } from '@/lib/auth/roles';
import { presenceLabel, summarize } from '@/lib/presence';
import {
  PRESENCE_DOT_CLASS,
  PresenceDot,
} from '@/components/presence/presence-dot';
import { Checkbox } from '@/components/ui/checkbox';
import { InviteMemberDialog } from './invite-member-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { ROLE_META } from './role-meta';
import { NAV_MODULES, NAV_SECTIONS } from './nav-modules';
import type { Permission, Role, Sector } from '@/types';

/** Tri-state per module: 'default' follows the member's cargo. */
type NavOverrideState = 'default' | 'visible' | 'hidden';

interface Member {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: AccountRole;
  joined_at: string;
  /** Cargo customizado (migration 058) — null se nunca atribuído. */
  role_id: string | null;
  sector_ids: string[];
  /** Nav-visibility overrides (migration 079), keyed by module. */
  nav_overrides: Record<string, boolean>;
}

interface Invitation {
  id: string;
  role: 'admin' | 'agent' | 'viewer';
  label: string | null;
  created_at: string;
  expires_at: string;
}

// These roles are translated via `useTranslations("Settings.roles")` where they are used.
const EDITABLE_ROLES: { value: AccountRole }[] = [
  { value: 'admin' },
  { value: 'agent' },
  { value: 'viewer' },
];

// Per-role chip metadata (icon / label / colour) lives in the shared
// ROLE_META module so this roster and the Overview identity chip can't
// drift. The colour scale runs amber (owner — scarce, immutable) →
// primary (admin) → muted (agent / viewer).

function fmtDate(iso: string): string {
  // Match the rest of the dashboard's locale-light formatting.
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtExpiresIn(iso: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t('expired');
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return t('expiresInDays', { days });
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return t('expiresInHours', { hours });
}

export function MembersTab() {
  const t = useTranslations('Settings.members');
  const tRoles = useTranslations('Settings.roles');
  const tCargo = useTranslations('Settings.members.cargo');
  const { user, canManageMembers } = useAuth();
  const { getPresence, getRow, now } = usePresence();

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [resettingMember, setResettingMember] = useState<Member | null>(null);
  // Single "Gerenciar acesso" dialog, replacing what used to be two
  // separate dialogs (Setores, Permissões de menu) plus the inline base-
  // Role select — Allan found the three scattered controls confusing,
  // especially since Cargo and the base Role can have overlapping-sounding
  // names (2026-10-01).
  const [managingMember, setManagingMember] = useState<Member | null>(null);
  const [draftSectorIds, setDraftSectorIds] = useState<Set<string>>(new Set());
  const [draftNavOverrides, setDraftNavOverrides] = useState<Map<string, NavOverrideState>>(new Map());
  const [draftRole, setDraftRole] = useState<AccountRole>('agent');
  const [savingAccess, setSavingAccess] = useState(false);
  const [pendingMemberAction, setPendingMemberAction] = useState<string | null>(
    null,
  );

  // module -> permission id, for the `comercial:*:view` nav permissions
  // only (built once permissions load; used both to render the editor
  // and to translate the tri-state draft back into override rows).
  const navPermissionIdByModule = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of permissions) {
      if (p.environment === 'comercial' && p.action === 'view') map.set(p.module, p.id);
    }
    return map;
  }, [permissions]);

  const loadEverything = useCallback(async () => {
    try {
      const [mres, ires, rres, sres, pres] = await Promise.all([
        fetch('/api/account/members', { cache: 'no-store' }),
        canManageMembers
          ? fetch('/api/account/invitations', { cache: 'no-store' })
          : Promise.resolve(null),
        fetch('/api/account/roles', { cache: 'no-store' }),
        fetch('/api/account/sectors', { cache: 'no-store' }),
        fetch('/api/account/permissions', { cache: 'no-store' }),
      ]);

      if (!mres.ok) {
        const payload = await mres.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load members');
        return;
      }
      const mdata = (await mres.json()) as { members: Member[] };
      setMembers(mdata.members);

      if (rres.ok) setRoles(((await rres.json()) as { roles: Role[] }).roles);
      if (sres.ok) setSectors(((await sres.json()) as { sectors: Sector[] }).sectors);
      if (pres.ok) setPermissions(((await pres.json()) as { permissions: Permission[] }).permissions);

      if (ires) {
        if (!ires.ok) {
          const payload = await ires.json().catch(() => ({}));
          toast.error(payload.error || 'Failed to load invitations');
          return;
        }
        const idata = (await ires.json()) as { invitations: Invitation[] };
        setInvitations(idata.invitations);
      } else {
        setInvitations([]);
      }
    } catch (err) {
      console.error('[MembersTab] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [canManageMembers]);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  async function handleCargoChange(member: Member, nextRoleId: string | null) {
    if (member.role_id === nextRoleId) return;
    const previous = member.role_id;
    setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role_id: nextRoleId } : m)));
    try {
      const res = await fetch(`/api/account/members/${member.user_id}/cargo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: nextRoleId }),
      });
      if (!res.ok) {
        setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role_id: previous } : m)));
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || tCargo('updateError'));
        return;
      }
      toast.success(tCargo('updatedToast', { name: member.full_name || t('unnamed') }));
    } catch (err) {
      setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role_id: previous } : m)));
      console.error('[MembersTab] cargo change error:', err);
      toast.error('Could not reach the server');
    }
  }

  function openAccessManager(member: Member) {
    setDraftSectorIds(new Set(member.sector_ids));
    const draft = new Map<string, NavOverrideState>();
    for (const { module } of NAV_MODULES) {
      const granted = member.nav_overrides[module];
      draft.set(module, granted === undefined ? 'default' : granted ? 'visible' : 'hidden');
    }
    setDraftNavOverrides(draft);
    // Owner row never opens this dialog (see the `!isOwnerRow` guard at
    // the call site), but guard here too since `draftRole` must be one
    // of the editable values the Select renders.
    setDraftRole(member.role === 'owner' ? 'agent' : member.role);
    setManagingMember(member);
  }

  // One dialog now covers what used to be three independent controls
  // (base Role select, Setores dialog, Permissões de menu dialog) — see
  // the `managingMember` state comment above. Each save call stays its
  // own existing endpoint; firing them together is safe since all three
  // are full-replace/idempotent.
  async function handleSaveAccess() {
    if (!managingMember) return;
    setSavingAccess(true);
    try {
      const tasks: Promise<Response>[] = [];

      if (draftRole !== managingMember.role) {
        tasks.push(
          fetch(`/api/account/members/${managingMember.user_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: draftRole }),
          }),
        );
      }

      const sectorIds = [...draftSectorIds];
      tasks.push(
        fetch(`/api/account/members/${managingMember.user_id}/sectors`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sector_ids: sectorIds }),
        }),
      );

      const overrides: { permission_id: string; granted: boolean }[] = [];
      const nextOverrides: Record<string, boolean> = {};
      for (const [module, state] of draftNavOverrides) {
        if (state === 'default') continue;
        const permissionId = navPermissionIdByModule.get(module);
        if (!permissionId) continue; // catalog not loaded yet — shouldn't happen once the dialog is open
        const granted = state === 'visible';
        overrides.push({ permission_id: permissionId, granted });
        nextOverrides[module] = granted;
      }
      tasks.push(
        fetch(`/api/account/members/${managingMember.user_id}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides }),
        }),
      );

      const results = await Promise.all(tasks);
      if (results.some((res) => !res.ok)) {
        toast.error(tCargo('accessUpdateError'));
        return;
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === managingMember.user_id
            ? { ...m, role: draftRole, sector_ids: sectorIds, nav_overrides: nextOverrides }
            : m,
        ),
      );
      toast.success(tCargo('accessUpdatedToast', { name: managingMember.full_name || t('unnamed') }));
      setManagingMember(null);
    } catch (err) {
      console.error('[MembersTab] access save error:', err);
      toast.error('Could not reach the server');
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleRemove() {
    if (!removingMember) return;
    setPendingMemberAction(removingMember.user_id);
    try {
      const res = await fetch(
        `/api/account/members/${removingMember.user_id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to remove member');
        return;
      }
      toast.success(t('removedToast', { name: removingMember.full_name || t('unnamed') }));
      setMembers((prev) =>
        prev.filter((m) => m.user_id !== removingMember.user_id),
      );
      setRemovingMember(null);
    } catch (err) {
      console.error('[MembersTab] remove error:', err);
      toast.error('Could not reach the server');
    } finally {
      setPendingMemberAction(null);
    }
  }

  async function handleRevoke(invite: Invitation) {
    try {
      const res = await fetch(`/api/account/invitations/${invite.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to revoke invitation');
        return;
      }
      toast.success(t('revokedToast'));
      setInvitations((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      console.error('[MembersTab] revoke error:', err);
      toast.error('Could not reach the server');
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
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="size-4" />
              {t('inviteMember')}
            </Button>
          </RequireRole>
        }
      />

      {/* Live presence summary across the roster. Updates without a
          full refresh as heartbeats and the local re-derive tick land. */}
      {members.length > 0 &&
        (() => {
          const counts = summarize(members.map((m) => getPresence(m.user_id)));
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="online" />
                {counts.online} {t('online')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="away" />
                {counts.away} {t('away')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PresenceDot status="offline" />
                {counts.offline} {t('offline')}
              </span>
              <span className="text-muted-foreground/70">
                · {t('memberCount', { count: members.length })}
              </span>
            </div>
          );
        })()}

      {/* Roster */}
      <Card>
        <CardContent className="p-0">
          {/* Column headers — desktop only. The grid-template-columns
              here must stay in sync with each row's below so headers
              line up; previously the row was a loose flex cluster with
              no headers at all, which read as unaligned/disorganized
              (Allan, 2026-10-01). */}
          <div className="hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(180px,2fr)_132px_110px_150px_76px] sm:items-center sm:gap-4">
            <span>{tCargo('colMember')}</span>
            <span>{tCargo('colCargo')}</span>
            <span>{tCargo('colSector')}</span>
            <span>{tCargo('colAccess')}</span>
            <span className="text-right">{tCargo('colActions')}</span>
          </div>
          <ul className="divide-y divide-border">
            {members.map((member) => {
              const roleMeta = ROLE_META[member.role];
              const RoleIcon = roleMeta.icon;
              const isSelf = member.user_id === user?.id;
              const isOwnerRow = member.role === 'owner';
              const isBusy = pendingMemberAction === member.user_id;
              const presence = getPresence(member.user_id);
              const presenceRow = getRow(member.user_id);
              const presenceText = presenceLabel(
                presence,
                presenceRow?.last_seen_at ?? null,
                now,
              );

              return (
                <li
                  key={member.user_id}
                  // Mobile: stack as a single column. Desktop (sm+): a
                  // grid whose columns match the header above —
                  // Membro | Cargo | Setor | Permissões | Ações.
                  className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(180px,2fr)_132px_110px_150px_76px] sm:items-center sm:gap-4"
                >
                  {/* Membro */}
                  <div className="flex min-w-0 items-center gap-3">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Avatar className="size-9 shrink-0">
                            {member.avatar_url ? (
                              <AvatarImage
                                src={member.avatar_url}
                                alt={member.full_name || 'Member'}
                              />
                            ) : null}
                            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                              {(member.full_name || member.email || 'U')
                                .charAt(0)
                                .toUpperCase()}
                            </AvatarFallback>
                            {/* role+label so screen readers announce
                                presence — the hover tooltip alone isn't
                                reachable by keyboard/AT on a non-focusable
                                avatar. */}
                            <AvatarBadge
                              role="img"
                              aria-label={presenceText}
                              className={PRESENCE_DOT_CLASS[presence]}
                            />
                          </Avatar>
                        }
                      />
                      <TooltipContent>{presenceText}</TooltipContent>
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {member.full_name || t('unnamed')}
                        </span>
                        {isSelf && (
                          <Badge className="bg-muted text-muted-foreground border-border text-[10px] uppercase tracking-wide">
                            {t('you')}
                          </Badge>
                        )}
                        {/* Owner badge moved here from its own column —
                            it's a fixed account attribute (there's only
                            ever one), not something anyone picks from a
                            dropdown, so it doesn't deserve column space
                            next to the two real per-person controls
                            (Allan, 2026-10-01). */}
                        {isOwnerRow && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                            <RoleIcon className="size-3" />
                            {tRoles('owner')}
                          </span>
                        )}
                      </div>
                      {member.email && (
                        <p className="truncate text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      )}
                      <p className="truncate text-[11px] text-muted-foreground/70">
                        {t('joined', { date: fmtDate(member.joined_at) })}
                      </p>
                    </div>
                  </div>

                  {/* Cargo (migration 058) — kept as a quick inline
                      action; assignable to any member including the
                      owner and self. */}
                  <div>
                    {canManageMembers ? (
                      <Select
                        value={member.role_id ?? '__none'}
                        onValueChange={(v) => handleCargoChange(member, v === '__none' ? null : (v as string))}
                      >
                        <SelectTrigger className="w-full bg-muted border-border text-foreground">
                          <SelectValue>
                            {roles.find((r) => r.id === member.role_id)?.name ?? tCargo('none')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">{tCargo('none')}</SelectItem>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {roles.find((r) => r.id === member.role_id)?.name ?? tCargo('none')}
                      </span>
                    )}
                  </div>

                  {/* Setor — display only; editing happens in the
                      "Gerenciar acesso" panel (Permissões column) along
                      with Nível de acesso and visibilidade do menu. */}
                  <div className="text-xs text-muted-foreground">
                    {member.sector_ids.length > 0
                      ? tCargo('sectorsCount', { count: member.sector_ids.length })
                      : tCargo('none')}
                  </div>

                  {/* Permissões — single entry point into the combined
                      "Gerenciar acesso" dialog (Nível de acesso + Setor +
                      visibilidade do menu), replacing what used to be
                      three separate controls (Setores button, Ajustes
                      button, base-Role select) plus a static info icon
                      (Allan, 2026-10-01). */}
                  <div>
                    {isOwnerRow ? (
                      <span className="text-xs text-muted-foreground">{tCargo('fullAccess')}</span>
                    ) : canManageMembers ? (
                      <button
                        type="button"
                        onClick={() => openAccessManager(member)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {Object.keys(member.nav_overrides).length > 0
                          ? tCargo('permissionsCount', { count: Object.keys(member.nav_overrides).length })
                          : tCargo('permissionsDefault')}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {Object.keys(member.nav_overrides).length > 0
                          ? tCargo('permissionsCount', { count: Object.keys(member.nav_overrides).length })
                          : tCargo('permissionsDefault')}
                      </span>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-start gap-2 sm:justify-end">
                    {/* Reset password. Admin+ only; never on the owner
                        row; never on yourself. Pre-polish styling was
                        neutral-default + red-on-hover — the
                        destructive intent was invisible until the
                        user moused over. Now red is the default
                        state with a darker shade on hover so the
                        affordance reads at-a-glance. */}
                    {canManageMembers && !isOwnerRow && !isSelf && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setResettingMember(member)}
                              disabled={isBusy}
                              className="border-border text-muted-foreground hover:bg-muted"
                            />
                          }
                        >
                          <KeyRound className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent>{t('resetPasswordAction')}</TooltipContent>
                      </Tooltip>
                    )}

                    {canManageMembers && !isOwnerRow && !isSelf && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRemovingMember(member)}
                        disabled={isBusy}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Pending invitations — admin+ only */}
      <RequireRole min="admin">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <UsersRound className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('pendingInvitations')}
            </h3>
            <Badge className="bg-muted text-muted-foreground border-border">
              {invitations.length}
            </Badge>
          </div>
          {/* P10 — make the no-resend design explicit. Admins were
              confused why the pending list shows roles + expiry but
              no "copy link again" button. Stating the constraint up
              front (rather than letting the user discover it by
              looking for a button) keeps it from feeling like a bug. */}
          {invitations.length > 0 ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {t('inviteHint')}
            </p>
          ) : null}

          {invitations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Mail className="size-6 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('noPendingTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.rich('noPendingDesc', { bold: (chunks) => <strong>{chunks}</strong> })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {invitations.map((inv) => {
                    const inviteRoleMeta = ROLE_META[inv.role];
                    const InviteRoleIcon = inviteRoleMeta.icon;
                    return (
                    <li
                      key={inv.id}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {inv.label || t('untitledInvite')}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${inviteRoleMeta.className}`}
                          >
                            <InviteRoleIcon className="size-3" />
                            {tRoles(inv.role)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('created', { date: fmtDate(inv.created_at) })} · {fmtExpiresIn(inv.expires_at, t)}
                        </p>
                      </div>

                      {/* Revoke: red default state, mirrors the
                          members-tab Remove button. Pre-polish version
                          read as a neutral secondary button until
                          hover. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(inv)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <MailX className="size-4" />
                        {t('revoke')}
                      </Button>
                    </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </RequireRole>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={loadEverything}
      />

      <ResetPasswordDialog
        open={resettingMember !== null}
        onOpenChange={(open) => {
          if (!open) setResettingMember(null);
        }}
        member={resettingMember}
      />

      <Dialog
        open={removingMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingMember(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              {t('removeDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.rich('removeDialogDesc', { 
                name: removingMember?.full_name || t('unnamed'),
                bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setRemovingMember(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleRemove}
              disabled={!!pendingMemberAction}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pendingMemberAction ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('removing')}
                </>
              ) : (
                t('removeBtn')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gerenciar acesso — Nível de acesso + Setor + Visibilidade do
          menu, consolidated into one dialog (see `managingMember` state
          comment above). */}
      <Dialog open={managingMember !== null} onOpenChange={(open) => !open && setManagingMember(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {tCargo('accessDialogTitle', { name: managingMember?.full_name || t('unnamed') })}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[72vh] space-y-7 overflow-y-auto pr-4">
            {/* Nível de acesso — base account role (admin/agent/viewer).
                Distinct from Cargo, which stays editable inline in the
                roster and only controls menu/module visibility. */}
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{tCargo('accessLevelLabel')}</Label>
              <Select value={draftRole} onValueChange={(v) => v && setDraftRole(v as AccountRole)}>
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue>{tRoles(draftRole)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {tRoles(r.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tCargo('accessLevelHint')}</p>
            </div>

            <div>
              <Label className="text-muted-foreground">{tCargo('sectorSectionTitle')}</Label>
              {sectors.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{tCargo('noSectorsYet')}</p>
              ) : (
                <div className="mt-1.5 space-y-2">
                  {sectors.map((sector) => (
                    <label key={sector.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                      <Checkbox
                        checked={draftSectorIds.has(sector.id)}
                        onCheckedChange={() =>
                          setDraftSectorIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(sector.id)) next.delete(sector.id);
                            else next.add(sector.id);
                            return next;
                          })
                        }
                      />
                      {sector.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="text-muted-foreground">{tCargo('permissionsSectionTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{tCargo('permissionsDialogDesc')}</p>
              <NavSectionsGrid
                draft={draftNavOverrides}
                onChange={(module, value) => setDraftNavOverrides((prev) => new Map(prev).set(module, value))}
              />
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setManagingMember(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSaveAccess}
              disabled={savingAccess}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingAccess ? tCargo('saving') : tCargo('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Padrão / Visível / Oculto — compact, colored when it overrides the cargo. */
function NavVisibilitySelect({
  value,
  onChange,
}: {
  value: NavOverrideState;
  onChange: (value: NavOverrideState) => void;
}) {
  const tCargo = useTranslations('Settings.members.cargo');
  const tone =
    value === 'visible' ? 'text-emerald-400' : value === 'hidden' ? 'text-red-400' : 'text-muted-foreground';
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as NavOverrideState)}>
      {/* Short labels in the trigger AND in the options: the open panel
          matches the trigger width, so long texts clipped. */}
      <SelectTrigger className={`h-8 w-32 shrink-0 border-border bg-muted text-xs font-medium ${tone}`}>
        <SelectValue>{tCargo(`permissionsStateShort.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{tCargo('permissionsStateShort.default')}</SelectItem>
        <SelectItem value="visible">{tCargo('permissionsStateShort.visible')}</SelectItem>
        <SelectItem value="hidden">{tCargo('permissionsStateShort.hidden')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * The menu, one card per section in sidebar order: the section's own switch in
 * the card header, its items below with the choice on the right. Cards go into
 * two columns by height (each one into the shorter column), so there are no
 * holes however many items a section has.
 */
function NavSectionsGrid({
  draft,
  onChange,
}: {
  draft: Map<string, NavOverrideState>;
  onChange: (module: string, value: NavOverrideState) => void;
}) {
  const tSidebar = useTranslations('Sidebar');
  const columns: (typeof NAV_SECTIONS)[] = [[], []];
  const heights = [0, 0];
  for (const section of NAV_SECTIONS) {
    const target = heights[0] <= heights[1] ? 0 : 1;
    columns[target].push(section);
    // header + one row per item (+ a line for the note)
    heights[target] += 2 + section.items.length + (section.noteKey ? 1 : 0);
  }

  return (
    <div className="mt-4 grid items-start gap-5 lg:grid-cols-2">
      {columns.map((sections, index) => (
        <div key={index} className="flex flex-col gap-5">
          {sections.map((section) => (
            <section key={section.key} className="overflow-hidden rounded-xl border border-border bg-card/40">
              <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
                <h4 className="text-sm font-semibold text-foreground">{tSidebar(section.titleKey)}</h4>
                {section.master.module && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{tSidebar(section.master.labelKey)}</span>
                    <NavVisibilitySelect
                      value={draft.get(section.master.module) ?? 'default'}
                      onChange={(v) => onChange(section.master.module, v)}
                    />
                  </div>
                )}
              </header>
              {section.noteKey && (
                <p className="px-4 py-3 text-xs text-muted-foreground">{tSidebar(section.noteKey)}</p>
              )}
              {section.items.length > 0 && (
                <div className="divide-y divide-border/50 px-4">
                  {section.items.map((item) => (
                    <div key={item.module} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-sm text-foreground">{tSidebar(item.labelKey)}</span>
                      <NavVisibilitySelect
                        value={draft.get(item.module) ?? 'default'}
                        onChange={(v) => onChange(item.module, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}
