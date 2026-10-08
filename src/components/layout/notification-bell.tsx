"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TYPE_ICON, notificationHref, notificationsListHref } from "@/components/notifications/notification-meta";
import { DesktopAlertsPanel } from "@/components/notifications/desktop-alerts-panel";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types";

// The bell next to the light/dark switch, in the top bar of Comercial and of
// Operacional. The red dot counts what was not read yet; clicking opens the
// latest notifications (assigned to a task, mentioned with @, commented,
// moved, ...). Everything comes from the same `notifications` table the full
// list uses — the database creates them, this is only the window onto them.

const LATEST = 20;

export function NotificationBell() {
  const t = useTranslations("Notifications");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const unread = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LATEST);
    setItems((data ?? []) as Notification[]);
  }, []);

  // Fresh list whenever it is opened, and again if something arrives (or is
  // read elsewhere) while it is open.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; setState happens after the await
    void load();
  }, [open, unread, load]);

  async function markRead(n: Notification) {
    if (n.read_at) return;
    setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? prev);
    await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", n.id)
      .is("read_at", null);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((x) => (x.read_at ? x : { ...x, read_at: now })) ?? prev);
    await createClient().from("notifications").update({ read_at: now }).is("read_at", null);
  }

  function openNotification(n: Notification) {
    void markRead(n);
    const href = notificationHref(n);
    setOpen(false);
    if (href) router.push(href);
  }

  const dateLocale = locale.startsWith("pt") ? ptBR : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("bellLabel")}
        title={t("bellLabel")}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none data-popup-open:bg-muted"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">{t("bellLabel")}</p>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unread === 0}
            className="flex items-center gap-1 text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {t("markAllRead")}
          </button>
        </div>

        <DesktopAlertsPanel />

        <div className="max-h-[26rem] overflow-y-auto">
          {items === null ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <Bell className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{t("bellEmpty")}</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id} className="border-b border-border/60 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        isUnread && "bg-primary/5",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-[13px]",
                              isUnread ? "font-semibold text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {n.title}
                          </span>
                          {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t("unread")} />}
                        </span>
                        {n.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span>}
                        <span className="mt-1 block text-[11px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateLocale })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          href={notificationsListHref(pathname)}
          onClick={() => setOpen(false)}
          className="block border-t border-border px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60"
        >
          {t("viewAll")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
