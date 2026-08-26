// Service worker for the Callback Box PWA: installability + Web Push.
//
// Plain JS, served as-is (not bundled). One SW registration controls the
// whole base scope ("/" in prod, "/<worktree>/" through the dev router), so
// it serves every box under that origin. The box a notification targets is
// carried in the payload's `data.url` (a fully-qualified deep link), not
// inferred from scope. See docs/plans/web-push-notifications.md (Track A).
//
// Payload contract (JSON the server sends, web-push-notifications.md):
//   { title: string, body: string, url: string, tag?: string }

// Take control of open pages as soon as an updated SW activates, so a newly
// deployed push handler governs already-open tabs without a manual reload.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Keep installability: a fetch handler (even a pass-through) is what makes the
// app installable on some engines. We don't intercept — let the network serve.
self.addEventListener("fetch", () => {});

function parsePush(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (_e) {
    // Non-JSON payload (or none): fall back to a plain-text body.
    return { title: "Callback Box", body: event.data.text(), url: "/" };
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePush(event);
  if (!payload) return;
  const title = payload.title || "Callback Box";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      data: { url: payload.url || "/" },
      tag: payload.tag,
      // The sending box's own mark when the payload carries one (sendPush
      // fills it in), so a notification says which box is talking. Falls back
      // to the shared app icon for an older payload or a box with no mark.
      icon: payload.icon || "/icons/icon-192.png",
      badge: payload.icon || "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an already-open tab on the target page if there is one.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin + target) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a fresh window to the deep link.
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});

// The user agent can rotate a subscription's keys; when it does it fires this
// event with the new subscription. Re-post it to the server so the stored
// endpoint stays current. Safari may not fire this, but handling it is cheap
// and correct. The subscribe endpoint is resolved relative to the SW scope,
// which is the box/base origin the page registered under.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const sub = event.newSubscription;
      if (!sub) return;
      // Send the old endpoint too so the server can transfer that endpoint's
      // box opt-ins to the new one. Resolved against the SW scope (the
      // box/base origin), which the dev router proxies to the backend.
      const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
      try {
        await fetch(new URL("api/push/resubscribe", self.registration.scope).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldEndpoint, subscription: sub.toJSON() }),
        });
      } catch (e) {
        // Best-effort: the next page visit re-subscribes anyway.
        console.warn("[sw] pushsubscriptionchange re-post failed:", e);
      }
    })(),
  );
});
