"use client";

import { useEffect, useId, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_PREFS, isTypeEnabled, popupBody, readPrefs, type DesktopPrefs } from "@/lib/notifications/desktop-prefs";
import { notificationHref, notificationsListHref } from "@/components/notifications/notification-meta";
import type { Notification } from "@/types";

// Headless. Every new row in `notifications` for this person (the database
// creates them: marked with @, put on a task, commented, contract signed...)
// becomes a pop-up, as long as the person kept that type switched on:
//   - the CRM tab is in front   -> a toast inside the CRM, with an "Abrir" button;
//   - the CRM is in the background / minimized -> a desktop pop-up from the
//     browser (needs the permission given in the bell), with two buttons:
//     "Abrir" (goes straight to the task/deal) and "Ver notificações".
// It only works while the CRM is open in some tab.

const WORKER = "/notification-sw.js";
const ICON = "/brand/aureon-symbol.png";

type ActionNotificationOptions = NotificationOptions & { actions?: { action: string; title: string }[] };

export function DesktopNotifier() {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const instanceId = useId();

  const prefs = useRef<DesktopPrefs>(DEFAULT_PREFS);
  const path = useRef(pathname);
  const labels = useRef({ open: "", list: "" });

  useEffect(() => {
    path.current = pathname;
    labels.current = { open: t("popupOpen"), list: t("popupList") };
  }, [pathname, t]);

  // The person's choices (this browser), kept fresh when they change them.
  useEffect(() => {
    if (!userId) return;
    const load = () => {
      prefs.current = readPrefs(userId);
    };
    load();
    window.addEventListener("wacrm:desktop-prefs-changed", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("wacrm:desktop-prefs-changed", load);
      window.removeEventListener("storage", load);
    };
  }, [userId]);

  // The worker that handles the clicks on the pop-ups.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(WORKER).catch(() => {});
  }, []);

  // A click on a desktop pop-up (or its button) arrives here from the worker.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string | null; url?: string; markRead?: boolean } | null;
      if (data?.type !== "wacrm-open-notification") return;
      if (data.markRead && data.id) void markRead(data.id);
      if (data.url) router.push(data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  // New notifications, live.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    async function show(n: Notification) {
      if (!isTypeEnabled(prefs.current, n.type)) return;

      let actorName: string | null = null;
      if (n.actor_user_id) {
        const { data } = await supabase.from("profiles").select("full_name").eq("user_id", n.actor_user_id).maybeSingle();
        actorName = (data?.full_name as string | null | undefined) ?? null;
      }
      const body = popupBody(n, actorName);
      const href = notificationHref(n);
      const listHref = notificationsListHref(path.current);

      // In front: a toast inside the CRM is enough.
      if (document.visibilityState === "visible" && document.hasFocus()) {
        toast(n.title, {
          description: body || undefined,
          duration: 9000,
          action: {
            label: href ? labels.current.open : labels.current.list,
            onClick: () => {
              if (href) void markRead(n.id);
              router.push(href ?? listHref);
            },
          },
        });
        return;
      }

      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const options: ActionNotificationOptions = {
        body,
        icon: ICON,
        badge: ICON,
        // The same id replaces instead of duplicating (several CRM tabs open).
        tag: n.id,
        data: { id: n.id, url: href, listUrl: listHref },
        actions: [
          ...(href ? [{ action: "open", title: labels.current.open }] : []),
          { action: "list", title: labels.current.list },
        ],
      };
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (registration) {
        await registration.showNotification(n.title, options);
      } else {
        // No worker (private window...): a plain pop-up without buttons.
        const popup = new Notification(n.title, options);
        popup.onclick = () => {
          window.focus();
          if (href) void markRead(n.id);
          router.push(href ?? listHref);
          popup.close();
        };
      }
    }

    const channel = supabase
      .channel(`desktop-notifier:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          void show(payload.new as Notification);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId, router]);

  return null;
}

async function markRead(id: string) {
  await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
}
