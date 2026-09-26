/**
 * The `chat:new` banner (docs/plans/notifications.md, Track A). A tap on a
 * `chat:new` notification opens `/<box>/chat?session=new&notification=<id>`;
 * this loads that intent, shows it above the composer, and hands it to the
 * send funnel (`opened-notification-store.ts`) so the first message carries it
 * as context. After that send, or on dismiss, the banner goes and the id leaves
 * the URL. An id the log no longer has (rotated away) shows nothing.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { trpc } from "../../lib/trpc";
import { href, toSearch } from "../../lib/routing";
import { ErrorText } from "../ui/ErrorText";
import { NotificationNotice } from "./NotificationNotice";
import {
  clearOpenedNotification,
  getOpenedNotification,
  setOpenedNotification,
  subscribeOpenedNotification,
} from "./opened-notification-store";

// A numeric-looking id arrives as a number from the router's JSON search parsing.
const notificationSearch = z.object({ notification: z.coerce.string().optional() });

export function ChatNotificationBanner() {
  const location = useLocation();
  const chatPage = location.pathname.endsWith("/chat");
  const parsed = notificationSearch.safeParse(useSearch({ strict: false }));
  const id = chatPage && parsed.success ? parsed.data.notification : undefined;
  const query = trpc.notifications.get.useQuery({ id: id ?? "" }, { enabled: id !== undefined, staleTime: Infinity });
  const opened = useSyncExternalStore(subscribeOpenedNotification, getOpenedNotification, getOpenedNotification);
  const offered = useRef<string | null>(null);
  const navigate = useNavigate();
  const intent = id !== undefined && query.data ? query.data.intent : null;

  useEffect(() => {
    if (intent === null) return;
    offered.current = intent.id;
    setOpenedNotification({ id: intent.id, title: intent.title, body: intent.body, at: intent.at });
    return () => clearOpenedNotification({ id: intent.id });
  }, [intent]);

  useEffect(() => {
    if (id !== undefined && query.data === null) console.warn(`[notifications] notification ${id} is not in the log (rotated away?); no banner`);
  }, [id, query.data]);

  // Sent or dismissed: drop the id from the URL so a reload does not offer it again.
  useEffect(() => {
    if (opened !== null || id === undefined || offered.current !== id) return;
    offered.current = null;
    const { notification: _dropped, ...rest } = location.search;
    void navigate({ to: href(location.pathname), search: toSearch(rest), replace: true, state: (old) => old });
  }, [opened, id, location.pathname, location.search, navigate]);

  if (id === undefined) return null;
  if (query.error) return <div role="alert" className="px-3 pt-2"><ErrorText>Could not load the notification: {query.error.message}</ErrorText></div>;
  if (opened === null || opened.id !== id) return null;
  return (
    <div role="status" className="px-3 pt-2">
      <NotificationNotice idPrefix="bbx-chat-notification" title={opened.title} body={opened.body} fullBody
        onDismiss={() => clearOpenedNotification({ id: opened.id })} />
    </div>
  );
}
