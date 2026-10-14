"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationResync } from "@/hooks/use-notification-resync";
import { useServerOffset } from "@/hooks/use-clock-tick";
import { DEFAULT_PREFS, isTypeEnabled, popupBody, readPrefs, type DesktopPrefs } from "@/lib/notifications/desktop-prefs";
import { notificationHref, notificationsListHref } from "@/components/notifications/notification-meta";
import { showDesktopPopup } from "@/lib/notifications/desktop-popup";
import type { Notification } from "@/types";

// Headless. Every new row in `notifications` for this person (the database
// creates them: marked with @, put on a task, commented, moved, contract signed...)
// becomes a pop-up, as long as the person kept that type switched on:
//   - the CRM tab is in front   -> a toast inside the CRM, with an "Abrir" button;
//   - the CRM is in the background / minimized -> a desktop pop-up from the
//     browser (needs the permission given in the bell), with two buttons:
//     "Abrir" (goes straight to the task/deal) and "Ver notificações".
// It only works while the CRM is open in some tab.
//
// Delivery is instant through the live channel; as a safety net the table is
// also re-read when the channel (re)connects, when the person returns to the
// tab and every few seconds, so a connection that slept or dropped never costs
// a notification. Each notification id is shown once.

const WORKER = "/notification-sw.js";
/** Notifications that arrive together (a bulk move) are grouped past this many. */
const GROUP_AFTER = 3;
/** Wait this long to see whether more are coming before showing them. */
const GROUP_WINDOW_MS = 150;
const PERMISSION_TOAST_ID = "wacrm-enable-desktop-alerts";
const PERMISSION_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const snoozeKey = (userId: string) => `wacrm:desktop-permission-snooze:${userId}`;

export function DesktopNotifier() {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const instanceId = useId();
  const serverOffset = useServerOffset();

  const prefs = useRef<DesktopPrefs>(DEFAULT_PREFS);
  const path = useRef(pathname);
  const labels = useRef<{ open: string; list: string; group: (count: number) => string }>({
    open: "",
    list: "",
    group: () => "",
  });
  const offsetRef = useRef(serverOffset);

  // Ids already shown (realtime and the catch-up read can deliver the same one)
  // and the newest created_at known, the point the catch-up read starts from.
  const seen = useRef<Set<string>>(new Set());
  const cursor = useRef<string | null>(null);
  const queue = useRef<Notification[]>([]);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    path.current = pathname;
    offsetRef.current = serverOffset;
    labels.current = {
      open: t("popupOpen"),
      list: t("popupList"),
      group: (count: number) => t("catchUp", { count }),
    };
  }, [pathname, t, serverOffset]);

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

  // One time, a few seconds after opening: ask for the permission to show
  // desktop pop-ups (only a click on the button can trigger the browser's
  // question). Without it nothing shows while the CRM is in the background.
  useEffect(() => {
    if (!userId) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    const timer = setTimeout(() => {
      try {
        const until = Number(window.localStorage.getItem(snoozeKey(userId)) ?? 0);
        if (until > Date.now()) return;
      } catch {
        // Storage blocked: just ask.
      }
      if (!readPrefs(userId).enabled) return;
      toast(t("enableTitle"), {
        id: PERMISSION_TOAST_ID,
        description: t("enableBody"),
        duration: Infinity,
        action: {
          label: t("enableAction"),
          onClick: () => {
            void Notification.requestPermission().then(() => {
              window.dispatchEvent(new CustomEvent("wacrm:desktop-prefs-changed"));
            });
          },
        },
        cancel: {
          label: t("enableLater"),
          onClick: () => {
            try {
              window.localStorage.setItem(snoozeKey(userId), String(Date.now() + PERMISSION_SNOOZE_MS));
            } catch {
              // Not remembered; it will ask again next time.
            }
          },
        },
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, [userId, t]);

  const present = useCallback(
    async (supabase: ReturnType<typeof createClient>, n: Notification) => {
      let actorName: string | null = null;
      if (n.actor_user_id) {
        const { data } = await supabase.from("profiles").select("full_name").eq("user_id", n.actor_user_id).maybeSingle();
        actorName = (data?.full_name as string | null | undefined) ?? null;
      }
      const body = popupBody(n, actorName);
      const href = notificationHref(n);
      const listHref = notificationsListHref(path.current);

      // In front: a toast inside the CRM is enough (unless the person asked
      // for the system pop-up in this case too).
      const inFront = document.visibilityState === "visible" && document.hasFocus();
      if (inFront && !prefs.current.alwaysSystem) {
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
      try {
        await showDesktopPopup({
          title: n.title,
          body,
          // The same id replaces instead of duplicating (several CRM tabs open).
          tag: n.id,
          id: n.id,
          url: href,
          listUrl: listHref,
          labels: labels.current,
          onClick: () => {
            if (href) void markRead(n.id);
            router.push(href ?? listHref);
          },
        });
      } catch (err) {
        console.error("[desktop-notifier] could not show the pop-up:", err);
      }
    },
    [router],
  );

  // New notifications go through a short queue: a handful together are shown
  // one by one, a bulk move becomes ONE "N novas notificações" pop-up.
  const flush = useCallback(
    (supabase: ReturnType<typeof createClient>) => {
      queueTimer.current = null;
      const batch = queue.current.filter((n) => isTypeEnabled(prefs.current, n.type));
      queue.current = [];
      if (batch.length === 0) return;
      if (batch.length <= GROUP_AFTER) {
        for (const n of batch) void present(supabase, n);
        return;
      }
      const listHref = notificationsListHref(path.current);
      const title = labels.current.group(batch.length);
      const inFront = document.visibilityState === "visible" && document.hasFocus();
      if (inFront && !prefs.current.alwaysSystem) {
        toast(title, {
          duration: 9000,
          action: { label: labels.current.list, onClick: () => router.push(listHref) },
        });
      } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void showDesktopPopup({
          title,
          body: batch
            .slice(0, 3)
            .map((n) => n.title)
            .join(" · "),
          tag: "wacrm-group",
          url: null,
          listUrl: listHref,
          labels: labels.current,
          onClick: () => router.push(listHref),
        }).catch((err) => console.error("[desktop-notifier] could not show the pop-up:", err));
      }
    },
    [present, router],
  );

  const accept = useCallback(
    (supabase: ReturnType<typeof createClient>, rows: Notification[]) => {
      let added = false;
      for (const n of rows) {
        if (cursor.current === null || Date.parse(n.created_at) > Date.parse(cursor.current)) cursor.current = n.created_at;
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        if (n.read_at) continue;
        queue.current.push(n);
        added = true;
      }
      if (added && !queueTimer.current) {
        queueTimer.current = setTimeout(() => flush(supabase), GROUP_WINDOW_MS);
      }
    },
    [flush],
  );

  // Everything newer than what was already shown (after a reconnect, a sleep,
  // coming back to the tab, or just as the periodic safety net).
  const catchUp = useCallback(async () => {
    if (!userId || cursor.current === null) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .gt("created_at", cursor.current)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error || !data || data.length === 0) return;
    accept(supabase, data as Notification[]);
  }, [userId, accept]);

  useNotificationResync(() => void catchUp());

  // New notifications, live.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;

    // Where "new" starts: the newest notification that already exists.
    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const newest = (data?.[0] as { id: string; created_at: string } | undefined) ?? null;
      if (newest) {
        seen.current.add(newest.id);
        if (cursor.current === null || Date.parse(newest.created_at) > Date.parse(cursor.current)) {
          cursor.current = newest.created_at;
        }
      } else if (cursor.current === null) {
        cursor.current = new Date(Date.now() + offsetRef.current).toISOString();
      }
      void catchUp();
    })();

    const channel = supabase
      .channel(`desktop-notifier:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          accept(supabase, [payload.new as Notification]);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void catchUp();
      });

    return () => {
      cancelled = true;
      if (queueTimer.current) clearTimeout(queueTimer.current);
      queueTimer.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId, accept, catchUp]);

  return null;
}

async function markRead(id: string) {
  await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
}
