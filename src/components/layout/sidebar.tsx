"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useHasEnvironmentAccess, useHasPermission } from "@/hooks/use-permissions";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { toast } from "sonner";
import {
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CheckSquare,
  ChevronDown,
  Crown,
  GitBranch,
  Hash,
  HandCoins,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  Lock,
  LogOut,
  MessageSquare,
  Plus,
  Radar,
  Radio,
  Receipt,
  Settings,
  Shield,
  User,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import type { ChatChannel } from "@/types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";

// ============================================================
// Unified primary sidebar (Allan, 2026-09-30) — replaces the old
// "EnvironmentSwitcher dropdown + 4 separate per-environment sidebar
// components" pattern (Sidebar/OperationalSidebar/FinanceiroSidebar/
// ChatSidebar) with ONE sidebar mounted by all 4 environment shells,
// showing every environment the account can reach as a collapsible
// ("cascata") section. Each section toggles independently — clicking
// a header expands/collapses just that section's items, several can
// be open at once. The section matching the current route auto-opens
// on navigation so users always land somewhere visible.
//
// Per-environment/per-item visibility rules are unchanged from the
// components this replaces:
//  - Comercial/Operacional sections: hidden entirely unless the
//    cargo grants that environment (owner always does) — same gate
//    `EnvironmentSwitcher` used to apply before showing it as an option.
//  - Financeiro: owner-only, matching FinanceiroShell's hard redirect.
//  - Chat: no gate (migration 084) — always shown.
//  - Materiais (new): currently just Playbook, gated on the same
//    `comercial:playbook:view` permission the old flat nav list used.
// ============================================================

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

const navRowBase =
  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2";
const navRowActive = "bg-primary/10 text-primary";
const navRowInactive = "text-muted-foreground hover:bg-muted hover:text-foreground";

interface ComercialNavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /** Renders a small "Beta" chip after the label. Purely informational. */
  beta?: boolean;
  /** `comercial:<module>:view` permission (migration 079). Omit = never hideable. */
  module?: string;
}

const COMERCIAL_ITEMS: ComercialNavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare, module: "inbox" },
  { href: "/notifications", labelKey: "notifications", icon: Bell, module: "notifications" },
  { href: "/contacts", labelKey: "contacts", icon: Users, module: "contacts" },
  { href: "/prospecting", labelKey: "prospecting", icon: Radar, beta: true, module: "prospecting" },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch, module: "pipelines" },
  { href: "/activities", labelKey: "activities", icon: CheckSquare, module: "activities" },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio, module: "broadcasts" },
  { href: "/automations", labelKey: "automations", icon: Zap, module: "automations" },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true, module: "flows" },
  { href: "/agents", labelKey: "aiAgents", icon: Bot, module: "agents" },
];

const FINANCEIRO_ITEMS = [
  { href: "/financeiro/dashboard", labelKey: "overview", icon: LayoutDashboard },
  { href: "/financeiro/linhas", labelKey: "lines", icon: ListTree },
  { href: "/financeiro/despesas", labelKey: "expenses", icon: Receipt },
  { href: "/financeiro/comissoes", labelKey: "commissions", icon: HandCoins },
  { href: "/financeiro/equipe", labelKey: "team", icon: UserRound },
];

type SectionKey = "comercial" | "operational" | "financeiro" | "chat" | "materiais";

function sectionForPath(pathname: string): SectionKey {
  if (pathname.startsWith("/operational")) return "operational";
  if (pathname.startsWith("/financeiro")) return "financeiro";
  if (pathname.startsWith("/chat")) return "chat";
  return "comercial";
}

function SectionButton({
  icon: Icon,
  label,
  open,
  onClick,
}: {
  icon: typeof Briefcase;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted lg:py-2"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
          open ? "rotate-0" : "-rotate-90",
        )}
      />
    </button>
  );
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const tFin = useTranslations("Financeiro.sidebar");
  const tOp = useTranslations("Operational.sidebar");
  const tChat = useTranslations("Chat.sidebar");
  const tCreate = useTranslations("Chat.createChannel");
  const pathname = usePathname();
  const router = useRouter();
  const { profile, profileLoading, account, accountRole, signOut, isOwner, permissions } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const hasComercialAccess = useHasEnvironmentAccess("comercial");
  const hasOperationalAccess = useHasEnvironmentAccess("operational");
  const canViewBoards = useHasPermission("operational", "tasks", "view_boards");

  // Mirrors useHasPermission's logic but as a plain function — calling a
  // hook inside .filter() would violate rules-of-hooks, since the number
  // of calls would vary with COMERCIAL_ITEMS.length instead of being fixed.
  const canView = (item: ComercialNavItem) =>
    !item.module || isOwner || permissions.has(`comercial:${item.module}:view`);
  const visibleComercialItems = COMERCIAL_ITEMS.filter(canView);
  const canViewPlaybook = isOwner || permissions.has("comercial:playbook:view");

  const showComercial = isOwner || hasComercialAccess;
  const showOperational = isOwner || hasOperationalAccess;
  const showFinanceiro = isOwner;

  const currentSection = sectionForPath(pathname);
  const logoHref =
    currentSection === "operational"
      ? "/operational/dashboard"
      : currentSection === "financeiro"
        ? "/financeiro/dashboard"
        : currentSection === "chat"
          ? "/chat"
          : "/dashboard";

  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    () => new Set([sectionForPath(pathname)]),
  );
  const [midiaOpen, setMidiaOpen] = useState(false);
  const [comercialOpen, setComercialOpen] = useState(false);

  useEffect(() => {
    const sec = sectionForPath(pathname);
    setOpenSections((prev) => (prev.has(sec) ? prev : new Set(prev).add(sec)));
  }, [pathname]);

  function toggleSection(key: SectionKey) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Chat channels — same fetch/create logic the old standalone ChatSidebar
  // used, now feeding the Chat section's expanded content instead of a
  // whole separate sidebar component.
  const [channels, setChannels] = useState<ChatChannel[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [channelPrivate, setChannelPrivate] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);

  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/channels");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tChat("loadError"));
        return;
      }
      setChannels(data.channels ?? []);
    } catch {
      toast.error(tChat("loadError"));
    }
  }, [tChat]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const handleCreateChannel = useCallback(async () => {
    const trimmed = channelName.trim();
    if (!trimmed || creatingChannel) return;
    setCreatingChannel(true);
    try {
      const res = await fetch("/api/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: channelDescription.trim() || undefined,
          is_private: channelPrivate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tCreate("createError"));
        return;
      }
      setCreateOpen(false);
      setChannelName("");
      setChannelDescription("");
      setChannelPrivate(false);
      await loadChannels();
      setOpenSections((prev) => new Set(prev).add("chat"));
      router.push(`/chat/${data.channel.id}`);
    } catch {
      toast.error(tCreate("createError"));
    } finally {
      setCreatingChannel(false);
    }
  }, [channelName, channelDescription, channelPrivate, creatingChannel, loadChannels, router, tCreate]);

  const publicChannels = (channels ?? []).filter((c) => !c.is_private);
  const privateChannels = (channels ?? []).filter((c) => c.is_private);

  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below.
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-6">
          <Link href={logoHref} className="flex items-center gap-2">
            <img
              src="/brand/aureon-logo-white.png"
              alt={t("title")}
              className="aureon-logo aureon-logo--dark h-5 w-auto"
            />
            <img
              src="/brand/aureon-logo-black.png"
              alt={t("title")}
              className="aureon-logo aureon-logo--light h-5 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {showComercial && (
              <li>
                <SectionButton
                  icon={Briefcase}
                  label={t("environment.comercial")}
                  open={openSections.has("comercial")}
                  onClick={() => toggleSection("comercial")}
                />
                {openSections.has("comercial") && (
                  <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                    {visibleComercialItems.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));
                      const showUnreadDot = item.href === "/inbox" && totalUnread > 0 && !isActive;
                      const showNotificationBadge =
                        item.href === "/notifications" && unreadNotifications > 0;

                      return (
                        <li key={item.href}>
                          <Link href={item.href} className={cn(navRowBase, isActive ? navRowActive : navRowInactive)}>
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{t(item.labelKey)}</span>
                            {item.beta && (
                              <span
                                aria-label={t("beta")}
                                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                              >
                                {t("beta")}
                              </span>
                            )}
                            {showUnreadDot && (
                              <span
                                aria-label={t("unreadConversations", { count: totalUnread })}
                                className="relative flex h-2 w-2"
                              >
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                              </span>
                            )}
                            {showNotificationBadge && (
                              <span
                                aria-label={t("unreadNotifications", { count: unreadNotifications })}
                                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                              >
                                {unreadNotifications > 9 ? "9+" : unreadNotifications}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            )}

            {showOperational && (
              <li>
                <SectionButton
                  icon={Workflow}
                  label={t("environment.operational")}
                  open={openSections.has("operational")}
                  onClick={() => toggleSection("operational")}
                />
                {openSections.has("operational") && (
                  <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                    <li>
                      <Link
                        href="/operational/dashboard"
                        className={cn(
                          navRowBase,
                          pathname === "/operational/dashboard" ? navRowActive : navRowInactive,
                        )}
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        <span className="flex-1">{tOp("dashboard")}</span>
                      </Link>
                    </li>
                    {canViewBoards && (
                      <li>
                        <Link
                          href="/operational/boards"
                          className={cn(
                            navRowBase,
                            pathname.startsWith("/operational/boards") ? navRowActive : navRowInactive,
                          )}
                        >
                          <LayoutGrid className="h-4 w-4" />
                          <span className="flex-1">{tOp("boards")}</span>
                        </Link>
                      </li>
                    )}
                    {canViewBoards && (
                      <li>
                        <Link
                          href="/operational/clients"
                          className={cn(
                            navRowBase,
                            pathname.startsWith("/operational/clients") ? navRowActive : navRowInactive,
                          )}
                        >
                          <Building2 className="h-4 w-4" />
                          <span className="flex-1">{tOp("clients")}</span>
                        </Link>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )}

            {showFinanceiro && (
              <li>
                <SectionButton
                  icon={Wallet}
                  label={t("environment.financeiro")}
                  open={openSections.has("financeiro")}
                  onClick={() => toggleSection("financeiro")}
                />
                {openSections.has("financeiro") && (
                  <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                    {FINANCEIRO_ITEMS.map((item) => {
                      const isActive = pathname.startsWith(item.href);
                      return (
                        <li key={item.href}>
                          <Link href={item.href} className={cn(navRowBase, isActive ? navRowActive : navRowInactive)}>
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{tFin(item.labelKey)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            )}

            {/* Chat — no gate (migration 084), every account member reaches it. */}
            <li>
              <SectionButton
                icon={MessageSquare}
                label={t("environment.chat")}
                open={openSections.has("chat")}
                onClick={() => toggleSection("chat")}
              />
              {openSections.has("chat") && (
                <div className="mt-1 ml-3 border-l border-border pl-3">
                  <div className="mb-1 flex items-center justify-between px-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      {tChat("publicChannels")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      aria-label={tChat("newChannel")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {publicChannels.map((c) => {
                      const href = `/chat/${c.id}`;
                      const isActive = pathname === href;
                      return (
                        <li key={c.id}>
                          <Link
                            href={href}
                            className={cn(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <Hash className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{c.name}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  {privateChannels.length > 0 && (
                    <>
                      <div className="mb-1 mt-3 px-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {tChat("privateChannels")}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-0.5">
                        {privateChannels.map((c) => {
                          const href = `/chat/${c.id}`;
                          const isActive = pathname === href;
                          return (
                            <li key={c.id}>
                              <Link
                                href={href}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                )}
                              >
                                <Lock className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{c.name}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>

            {/* Materiais — Comercial (Playbook + Apresentação Comercial) + Mídia (kickoffs), ambos em cascata. */}
            {canViewPlaybook && (
              <li>
                <SectionButton
                  icon={Layers}
                  label={t("materiais")}
                  open={openSections.has("materiais")}
                  onClick={() => toggleSection("materiais")}
                />
                {openSections.has("materiais") && (
                  <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                    <li>
                      <SectionButton
                        icon={Briefcase}
                        label={t("environment.comercial")}
                        open={comercialOpen}
                        onClick={() => setComercialOpen((v) => !v)}
                      />
                      {comercialOpen && (
                        <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                          <li>
                            <a
                              href="https://playbook.aureonag.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(navRowBase, navRowInactive)}
                            >
                              <BookOpen className="h-4 w-4" />
                              <span className="flex-1">{t("playbook")}</span>
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://playbook.aureonag.com/apresentacao-comercial.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(navRowBase, navRowInactive)}
                            >
                              <LayoutGrid className="h-4 w-4" />
                              <span className="flex-1">{t("apresentacaoComercial")}</span>
                            </a>
                          </li>
                        </ul>
                      )}
                    </li>
                    <li>
                      <SectionButton
                        icon={Radio}
                        label={t("midia")}
                        open={midiaOpen}
                        onClick={() => setMidiaOpen((v) => !v)}
                      />
                      {midiaOpen && (
                        <ul className="mt-1 ml-3 flex flex-col gap-1 border-l border-border pl-3">
                          <li>
                            <a
                              href="https://playbook.aureonag.com/kickoff-ecommerce.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(navRowBase, navRowInactive)}
                            >
                              <Zap className="h-4 w-4" />
                              <span className="flex-1">{t("kickoffEcommerce")}</span>
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://playbook.aureonag.com/kickoff-leadgeneration.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(navRowBase, navRowInactive)}
                            >
                              <Zap className="h-4 w-4" />
                              <span className="flex-1">{t("kickoffLeadGeneration")}</span>
                            </a>
                          </li>
                          <li>
                            <a
                              href="https://playbook.aureonag.com/aureon-integracao-midia.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(navRowBase, navRowInactive)}
                            >
                              <Zap className="h-4 w-4" />
                              <span className="flex-1">{t("integracaoGestores")}</span>
                            </a>
                          </li>
                        </ul>
                      )}
                    </li>
                  </ul>
                )}
              </li>
            )}
          </ul>

          <div className="my-4 border-t border-border" />

          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href="/settings"
                className={cn(navRowBase, pathname.startsWith("/settings") ? navRowActive : navRowInactive)}
              >
                <Settings className="h-4 w-4" />
                {t("settings")}
              </Link>
            </li>
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? t("defaultAvatar")} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ?? profile?.email?.charAt(0)?.toUpperCase() ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{profile?.full_name ?? t("defaultUser")}</p>
                <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCreate("title")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-channel-name">{tCreate("nameLabel")}</Label>
              <Input
                id="chat-channel-name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder={tCreate("namePlaceholder")}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-channel-description">{tCreate("descriptionLabel")}</Label>
              <Input
                id="chat-channel-description"
                value={channelDescription}
                onChange={(e) => setChannelDescription(e.target.value)}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="chat-channel-private"
                checked={channelPrivate}
                onCheckedChange={(checked) => setChannelPrivate(checked === true)}
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="chat-channel-private" className="font-normal">
                  {tCreate("privateLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">{tCreate("privateHint")}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tCreate("cancel")}
            </Button>
            <Button onClick={handleCreateChannel} disabled={!channelName.trim() || creatingChannel}>
              {tCreate("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
