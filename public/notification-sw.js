// Service worker of the CRM's desktop pop-ups.
//
// The page asks the browser to show a pop-up (registration.showNotification),
// and this worker only decides what a click does: on the pop-up itself or on
// one of its buttons ("Abrir" / "Ver notificações"). It focuses the CRM tab
// that is already open and tells it where to go (so it can also mark the
// notification as read); if no tab is open it opens a new one.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const wantsList = event.action === "list";
  const target = (wantsList ? data.listUrl : data.url || data.listUrl) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({
          type: "wacrm-open-notification",
          id: data.id || null,
          url: target,
          // Opening the list does not mean the item was read.
          markRead: !wantsList && !!data.url,
        });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
