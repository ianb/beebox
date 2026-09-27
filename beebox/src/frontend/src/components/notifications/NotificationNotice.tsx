/**
 * One notification as a dismissible banner: its title, the first line of its
 * body, and optionally a link to where it points. Presentational; the live
 * app-shell banner and the chat's `chat:new` banner both render it.
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { CloseButton } from "../ui/CloseButton";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

export interface NotificationNoticeProps {
  title: string;
  body: string;
  /** Root-relative deep link (`targetUrl`); absent when the banner already sits where it points. */
  url?: string | undefined;
  /** Show the whole body rather than its first line. */
  fullBody?: boolean;
  onDismiss: () => void;
  /** `bbx-` id prefix for this banner's controls. */
  idPrefix: string;
}

/** Split a root-relative URL into what the router's Link takes. */
function linkParts(url: string): { to: string; search: Record<string, string>; hash: string } {
  const parsed = new URL(url, window.location.origin);
  return { to: parsed.pathname, search: Object.fromEntries(parsed.searchParams), hash: parsed.hash.replace(/^#/, "") };
}

export function NotificationNotice({ title, body, url, fullBody, onDismiss, idPrefix }: NotificationNoticeProps) {
  const shownBody = fullBody === true ? body.trim() : (body.split("\n").find((line) => line.trim() !== "") ?? "");
  const link = url === undefined ? null : linkParts(url);
  return (
    <Row gap="sm" align="start" className="rounded-lg border border-info-light bg-info-50 px-3 py-2">
      <Stack gap="xs" className="flex-1 min-w-0">
        <Text weight="semibold" size="sm">{title}</Text>
        {shownBody === "" ? null : <Text as="p" size="sm" tone="muted" className="whitespace-pre-line">{shownBody}</Text>}
        {link === null ? null : (
          <Link id={`${idPrefix}-open`} to={href(link.to)} search={toSearch(link.search)} hash={link.hash === "" ? undefined : link.hash}
            onClick={onDismiss} className="self-start text-sm text-primary hover:text-primary-dark hover:underline">
            Open
          </Link>
        )}
      </Stack>
      <CloseButton id={`${idPrefix}-dismiss`} size="sm" label={`Dismiss notification: ${title}`} onClick={onDismiss} />
    </Row>
  );
}
