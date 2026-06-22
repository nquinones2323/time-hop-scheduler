const CACHE_NAME = "family-clock-v2";
const FILES_TO_CACHE = ["./index.html", "./manifest.json", "./icon.svg", "./app.js", "./app-core.js", "./api.js", "./config.js", "./push-client.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

self.addEventListener("fetch", (event) => {
  // Never cache API calls — this app now has a live backend, and serving a
  // stale cached API response would silently show wrong schedule data.
  // Cache-first is only appropriate for the static app shell.
  if (event.request.url.includes("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

// --- Push notifications ---
// This is the piece that lets an alert reach the lock screen even when the
// app isn't open — the server (see server/src/lib/scheduler.js) sends a
// push payload, and this handler is what actually shows the OS-level
// notification. Everything before this point in the file is the original
// v1/v2 offline-caching behavior, unchanged.
self.addEventListener("push", (event) => {
  let payload = { title: "Family Time Tracker", body: "It's time for something back home." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // If the payload isn't valid JSON for some reason, fall back to the
    // generic message above rather than letting the push silently fail to
    // show anything — a vague notification is better than a missed one.
  }

  const title = payload.emoji ? `${payload.emoji} ${payload.title}` : payload.title;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      tag: payload.tag, // same tag replaces a prior unread notification for the same item, instead of stacking duplicates
      icon: "./icon.svg",
      badge: "./icon.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Bring an existing tab to the front if one's open, otherwise open one.
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
