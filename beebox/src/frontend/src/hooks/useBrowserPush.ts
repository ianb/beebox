/**
 * This browser's Web Push opt-in for this box.
 *
 * Web Push needs a secure context + service worker. On iOS it works ONLY for a
 * Home-Screen-installed PWA (never a Safari tab), and permission must be
 * requested on a user gesture after install. We never call
 * subscription.unsubscribe() to disable (it traps Safari into refusing a new
 * subscribe without a fresh gesture) — disabling removes the endpoint
 * server-side only, so "on" is the box's answer, not the browser's. See
 * docs/implemented-plans/web-push-notifications.md (Track E).
 */

import { useEffect, useState } from "react";
import { errorMessage } from "@shared/error-guards";
import { trpc } from "../lib/trpc/client";
import { browserPushState, detectPushSupport, type BrowserPushState, type PushSupport } from "../lib/push-support";

export function useBrowserPush(): {
  state: BrowserPushState;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
} {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  // undefined until the browser has answered; null when it holds no subscription.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const vapidQuery = trpc.push.vapidPublicKey.useQuery(undefined, { enabled: support?.kind === "supported" });
  const subscribedQuery = trpc.push.isSubscribed.useQuery({ endpoint: endpoint ?? "" }, { enabled: typeof endpoint === "string" });
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const disableMutation = trpc.push.disable.useMutation();

  useEffect(() => {
    const s = detectPushSupport();
    setSupport(s);
    if (s.kind !== "supported") return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then(async (reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;

      const publicKey = vapidQuery.data?.publicKey;
      if (!publicKey) {
        setError("Push is not configured on the server (no VAPID key).");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // Modern browsers accept the base64url VAPID key as a string directly.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        setError("Subscription was missing keys; try again.");
        return;
      }
      await subscribeMutation.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        ua: navigator.userAgent,
      });
      setEndpoint(json.endpoint);
      await utils.push.isSubscribed.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (typeof endpoint !== "string") return;
    setBusy(true);
    setError(null);
    try {
      // Server-side only — never sub.unsubscribe() (iOS re-subscribe trap).
      await disableMutation.mutateAsync({ endpoint });
      await utils.push.isSubscribed.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const subscribed = endpoint === undefined ? null : endpoint === null ? false : (subscribedQuery.data?.subscribed ?? null);
  return {
    state: browserPushState({ support, permission, subscribed, publicKey: vapidQuery.data === undefined ? undefined : vapidQuery.data.publicKey }),
    busy,
    error: error ?? subscribedQuery.error?.message ?? vapidQuery.error?.message ?? null,
    enable,
    disable,
  };
}
