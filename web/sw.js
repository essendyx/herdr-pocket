// Service Worker: zeigt Push-Nachrichten und öffnet beim Antippen den Agent.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "herdr", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "herdr", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: d.pane || "herdr",
    data: { pane: d.pane || "" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const pane = (e.notification.data && e.notification.data.pane) || "";
  const url = pane ? "/#agent-" + pane.replace(/:/g, "-") : "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { c.postMessage({ type: "open", pane }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
