/**
 * The in-app banner for a live notification (docs/plans/notifications.md,
 * Track A). Mounted once under the app shell; shows a `notification` bus event
 * whose loudness is `quiet` or `loud` (a `dot` is a badge only) until the
 * person dismisses it or follows its link. One at a time: a newer notification
 * replaces the one showing.
 *
 * The component owns its live region, which stays mounted while empty so a
 * screen reader announces a banner when it appears.
 */

import { useCallback, useState } from "react";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import type { EventMap } from "@backend/trpc/routers/events.js";
import { NotificationNotice } from "./NotificationNotice";

type LiveNotification = EventMap["notification"];

export function NotificationBanner() {
  const [shown, setShown] = useState<LiveNotification | null>(null);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const notification = busEventData(event, "notification");
      if (notification !== null && notification.loudness !== "dot") setShown(notification);
    }, []),
  });
  return (
    <div role="status" aria-live="polite" className={shown === null ? undefined : "px-3 pt-2"}>
      {shown === null ? null : (
        <NotificationNotice key={shown.id} idPrefix="bbx-notification-banner" title={shown.title} body={shown.body} url={shown.url}
          onDismiss={() => setShown(null)} />
      )}
    </div>
  );
}
