"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { EnvironmentSwitcher } from "@/components/layout/environment-switcher";
import { Hash, Lock, LogOut, Plus, Settings, User, X } from "lucide-react";
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
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { ChatChannel } from "@/types";

// Same visual chrome as the other three sidebars (Comercial/Operational/
// Financeiro) — deliberately its own component rather than a shared one
// parameterized by environment, matching those sidebars' own stated
// reasoning (nav lists diverge). Unlike them, the list here is dynamic
// (channels) instead of a fixed navItems array.

interface ChatSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function ChatSidebar({ open = false, onClose }: ChatSidebarProps) {
  const t = useTranslations("Sidebar");
  const tChat = useTranslations("Chat.sidebar");
  const tCreate = useTranslations("Chat.createChannel");
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();

  const [channels, setChannels] = useState<ChatChannel[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
          is_private: isPrivate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tCreate("createError"));
        return;
      }
      setCreateOpen(false);
      setName("");
      setDescription("");
      setIsPrivate(false);
      await loadChannels();
      router.push(`/chat/${data.channel.id}`);
    } catch {
      toast.error(tCreate("createError"));
    } finally {
      setCreating(false);
    }
  }, [name, description, isPrivate, creating, loadChannels, router, tCreate]);

  const publicChannels = (channels ?? []).filter((c) => !c.is_private);
  const privateChannels = (channels ?? []).filter((c) => c.is_private);

  return (
    <>
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
          <Link href="/chat" className="flex items-center gap-2">
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

        <div className="pt-3">
          <EnvironmentSwitcher current="chat" />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
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
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
              <div className="mb-1 mt-4 px-2">
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
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

          <div className="my-4 border-t border-border" />

          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:py-2"
              >
                <Settings className="h-4 w-4" />
                {t("settings")}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? t("defaultAvatar")} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tCreate("namePlaceholder")}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-channel-description">{tCreate("descriptionLabel")}</Label>
              <Input
                id="chat-channel-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="chat-channel-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
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
            <Button onClick={handleCreate} disabled={!name.trim() || creating}>
              {tCreate("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
