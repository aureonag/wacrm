"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellRing, Settings2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notificationsListHref } from "@/components/notifications/notification-meta";
import {
  DEFAULT_PREFS,
  NOTIFICATION_GROUPS,
  readPrefs,
  typeChecked,
  writePrefs,
  type DesktopPrefs,
} from "@/lib/notifications/desktop-prefs";
import type { NotificationType } from "@/types";

// Inside the bell: turn the desktop pop-ups on (the browser asks for
// permission only after a click), try one, and choose which kinds of
// notification should pop up. The choice stays in this browser.

type Permission = NotificationPermission | "unsupported";

export function DesktopAlertsPanel() {
  const t = useTranslations("Notifications");
  const pathname = usePathname();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [permission, setPermission] = useState<Permission>("default");
  const [prefs, setPrefs] = useState<DesktopPrefs>(DEFAULT_PREFS);
  const [choosing, setChoosing] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    if (userId) setPrefs(readPrefs(userId));
  }, [userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (permission === "unsupported" || !userId) return null;

  function save(next: DesktopPrefs) {
    setPrefs(next);
    if (userId) writePrefs(userId, next);
  }

  async function activate() {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      // Make sure the worker that handles the clicks is there.
      await navigator.serviceWorker?.register("/notification-sw.js").catch(() => {});
      await sendTest();
    }
  }

  async function sendTest() {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
      body: t("testBody"),
      icon: "/brand/aureon-symbol.png",
      tag: "wacrm-test",
      data: { listUrl: notificationsListHref(pathname) },
      actions: [{ action: "list", title: t("popupList") }],
    };
    if (registration) await registration.showNotification(t("testTitle"), options);
    else new Notification(t("testTitle"), options);
  }

  return (
    <>
      <div className="border-b border-border bg-muted/30 px-3 py-2.5">
        {permission === "default" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("desktopPrompt")}</p>
            <Button size="sm" onClick={activate} className="shrink-0">
              <BellRing className="h-3.5 w-3.5" />
              {t("desktopActivate")}
            </Button>
          </div>
        )}
        {permission === "denied" && <p className="text-xs text-amber-500">{t("desktopBlocked")}</p>}
        {permission === "granted" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {prefs.enabled ? t("desktopOn") : t("desktopOff")}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={sendTest}>
                {t("desktopTest")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
                <Settings2 className="h-3.5 w-3.5" />
                {t("desktopChoose")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("desktopChooseTitle")}</DialogTitle>
            <DialogDescription>{t("desktopChooseHint")}</DialogDescription>
          </DialogHeader>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-foreground">{t("desktopMaster")}</span>
            <Switch checked={prefs.enabled} onCheckedChange={(enabled) => save({ ...prefs, enabled })} />
          </label>

          <div className={prefs.enabled ? "space-y-4" : "pointer-events-none space-y-4 opacity-50"}>
            {NOTIFICATION_GROUPS.map((group) => (
              <section key={group.key}>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`groups.${group.key}`)}
                </h4>
                <ul className="space-y-1">
                  {group.types.map((type: NotificationType) => (
                    <li key={type}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted/50">
                        <Checkbox
                          checked={typeChecked(prefs, type)}
                          onCheckedChange={(checked) =>
                            save({ ...prefs, overrides: { ...prefs.overrides, [type]: checked === true } })
                          }
                        />
                        {t(`types.${type}`)}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
