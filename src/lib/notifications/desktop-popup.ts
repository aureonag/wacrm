// Shows ONE desktop pop-up, the way each browser can:
//   - Chrome / Edge: through the service worker, with the buttons
//     ("Abrir" / "Ver notificações");
//   - Safari / Firefox (macOS and others): the classic Notification, without
//     buttons — they do not support actions, and Safari can refuse the
//     service-worker path. Clicking the pop-up itself opens the item.
// If the first way fails for any reason the second is tried, and only if both
// fail an error is thrown (so the "Testar" button can tell the person why).

export interface DesktopPopup {
  title: string;
  body: string;
  /** Same tag replaces instead of stacking. */
  tag: string;
  /** Notification id (to mark it read when opened from the pop-up). */
  id?: string;
  /** Where the pop-up and its "Abrir" button lead (null: only the list). */
  url: string | null;
  listUrl: string;
  labels: { open: string; list: string };
  /** Classic pop-ups: what a click does (the service worker handles the others). */
  onClick: () => void;
}

const ICON = "/brand/aureon-symbol.png";

type ActionOptions = NotificationOptions & { actions?: { action: string; title: string }[] };

/** Chrome and Edge report how many buttons a pop-up may have; Safari and Firefox do not. */
export function supportsPopupButtons(): boolean {
  if (typeof Notification === "undefined") return false;
  return Number((Notification as unknown as { maxActions?: number }).maxActions) > 0;
}

/** The registration of our worker once it is ACTIVE (showNotification needs that), or null. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  } catch {
    return null;
  }
}

export async function showDesktopPopup(p: DesktopPopup): Promise<"worker" | "classic"> {
  if (typeof Notification === "undefined") throw new Error("Notification API not available");
  if (Notification.permission !== "granted") throw new Error("permission is " + Notification.permission);

  if (supportsPopupButtons()) {
    const registration = await activeRegistration();
    if (registration) {
      const options: ActionOptions = {
        body: p.body,
        icon: ICON,
        badge: ICON,
        tag: p.tag,
        data: { id: p.id ?? null, url: p.url, listUrl: p.listUrl },
        actions: [...(p.url ? [{ action: "open", title: p.labels.open }] : []), { action: "list", title: p.labels.list }],
      };
      try {
        await registration.showNotification(p.title, options);
        return "worker";
      } catch (err) {
        console.warn("[desktop-popup] worker pop-up failed, trying the classic one:", err);
      }
    }
  }

  const popup = new Notification(p.title, { body: p.body, icon: ICON, tag: p.tag });
  popup.onclick = () => {
    window.focus();
    p.onClick();
    popup.close();
  };
  return "classic";
}
