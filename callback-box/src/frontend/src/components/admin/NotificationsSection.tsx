/**
 * Web Push enable/disable for this box, plus iOS install coaching.
 *
 * Web Push needs a secure context + service worker. On iOS it works ONLY for a
 * Home-Screen-installed PWA (never a Safari tab), and permission must be
 * requested on a user gesture after install — so on iOS Safari we coach
 * Add-to-Home-Screen instead of showing a dead button. We never call
 * subscription.unsubscribe() to disable (it traps Safari into refusing a new
 * subscribe without a fresh gesture) — disabling removes the endpoint
 * server-side only. See docs/plans/web-push-notifications.md (Track E).
 */

import { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";
import { errorMessage } from "../../lib/error-guards";

// iOS Safari's non-standard `navigator.standalone` (whether the page is
// running as an installed Home-Screen app) isn't in the DOM lib types.
declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

type Support =
  | { kind: "supported" }
  | { kind: "needs-install" } // iOS Safari, not yet a Home-Screen app
  | { kind: "unsupported" };

function detectSupport(): Support {
  const hasPush =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (hasPush) return { kind: "supported" };

  // iOS Safari (not installed) lacks Push until added to the Home Screen.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true);
  if (isIOS && !standalone) return { kind: "needs-install" };

  return { kind: "unsupported" };
}

export function NotificationsSection() {
  const [support, setSupport] = useState<Support | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vapidQuery = trpc.push.vapidPublicKey.useQuery(undefined, {
    enabled: support?.kind === "supported",
  });
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const disableMutation = trpc.push.disable.useMutation();

  useEffect(() => {
    const s = detectSupport();
    setSupport(s);
    if (s.kind !== "supported") return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch((e) => setError(errorMessage(e)));
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
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      // Server-side only — never sub.unsubscribe() (iOS re-subscribe trap).
      await disableMutation.mutateAsync({ endpoint });
      setEndpoint(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <Text as="h2" size="lg" weight="semibold">Notifications</Text>
      <Stack gap="sm" className="mt-2">
        <Text as="p" size="sm" tone="muted">
          Get a push notification on this device when the box needs you — health alerts and
          questions waiting for an answer.
        </Text>

        {support === null ? null : support.kind === "unsupported" ? (
          <Text as="p" size="sm" tone="muted">
            This browser doesn&apos;t support web push notifications.
          </Text>
        ) : support.kind === "needs-install" ? (
          <Text as="p" size="sm">
            On iPhone or iPad, add this app to your Home Screen first: tap the Share button,
            then &ldquo;Add to Home Screen.&rdquo; Open it from the Home Screen icon, then come
            back here to enable notifications.
          </Text>
        ) : endpoint ? (
          <Row gap="sm" align="center">
            <Text as="p" size="sm">Notifications are on for this device.</Text>
            <Button intent="secondary" onClick={disable} loading={busy} loadingLabel="Disabling…">
              Disable
            </Button>
          </Row>
        ) : permission === "denied" ? (
          <Text as="p" size="sm">
            Notifications are blocked for this site. Re-enable them in your browser&apos;s site
            settings, then reload.
          </Text>
        ) : (
          <Button intent="primary" onClick={enable} loading={busy} loadingLabel="Enabling…">
            Enable notifications
          </Button>
        )}

        {error ? (
          <div className="p-3 bg-danger-50 border border-danger-100 rounded">
            <Text size="sm" tone="danger">{error}</Text>
          </div>
        ) : null}
      </Stack>
    </div>
  );
}
