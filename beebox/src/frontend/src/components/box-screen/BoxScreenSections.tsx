/**
 * The box screen's navigation sections (docs/plans/box-screen.md, track 2):
 * "Pick up where you left off", "In this box", and "Boxes". Each section is a
 * labelled list of links; the first recent chat is styled as the primary
 * action.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { href, toSearch } from "../../lib/routing";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import type { RouterOutput } from "../../lib/trpc/client";
import type { KnownBox } from "../../lib/boxes";
import { Heading } from "../ui/Heading";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { CardMark } from "../ui/CardMark";

type BoxScreenHome = RouterOutput["quickChat"]["home"];
type RecentChat = BoxScreenHome["recentChats"][number];

/** A titled section whose heading names its landmark region. */
export function BoxScreenSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Stack gap="sm">
        <Heading level={2} id={id}>{title}</Heading>
        {children}
      </Stack>
    </section>
  );
}

const TILE = "flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-lg border";
const PRIMARY_TILE = `${TILE} bg-primary border-primary text-white hover:bg-primary-dark`;
const PLAIN_TILE = `${TILE} bg-white border-warm-200 text-warm-900 hover:bg-warm-50`;

function RecentChatLink({ chat, boxSlug, primary }: { chat: RecentChat; boxSlug: string; primary: boolean }) {
  return (
    <li>
      <Link id={`bbx-box-screen-recent-${chat.sessionId}`} to={href(`/${boxSlug}/chat`)} search={toSearch({ session: chat.sessionId })}
        className={primary ? PRIMARY_TILE : PLAIN_TILE}>
        {chat.landmark === null || chat.landmark.symbol === null ? null : <span className="shrink-0 leading-none" aria-hidden>{chat.landmark.symbol}</span>}
        <span className="min-w-0 truncate font-medium">{chat.label}</span>
        {/* The last chat may have no landmark; its own label then stands alone. */}
        {chat.landmark === null ? null : <span className={`ml-auto shrink-0 text-xs ${primary ? "text-white/80" : "text-warm-500"}`}>{chat.landmark.label}</span>}
      </Link>
    </li>
  );
}

export function RecentChatList({ chats, boxSlug }: { chats: RecentChat[]; boxSlug: string }) {
  if (chats.length === 0) return <Text as="p" size="sm" tone="muted">No recent chats.</Text>;
  return (
    <ul className="flex flex-col gap-2">
      {chats.map((chat, index) => <RecentChatLink key={chat.sessionId} chat={chat} boxSlug={boxSlug} primary={index === 0} />)}
    </ul>
  );
}

const PAGE_LINK = "inline-flex items-center min-h-[40px] px-3 rounded-full border border-warm-200 bg-white text-sm text-warm-800 hover:bg-warm-50";

function PageLink({ id, to, children }: { id: string; to: string; children: ReactNode }) {
  return <li><Link id={id} to={to} className={PAGE_LINK}>{children}</Link></li>;
}

/** Dashboard, Browse, History, and Storage summary, then the box's own `nav.card` shortcuts. */
export function BoxPageLinks({ boxSlug, shortcuts }: { boxSlug: string; shortcuts: BoxScreenHome["shortcuts"] }) {
  const view = (path: string) => href(`/${boxSlug}/views/${path}`);
  return (
    <ul className="flex flex-wrap gap-2">
      <PageLink id="bbx-box-screen-dashboard" to={view(SYSTEM_CARD_PATHS.dashboard)}>Dashboard</PageLink>
      <PageLink id="bbx-box-screen-browse" to={view(SYSTEM_CARD_PATHS.browse)}>Browse</PageLink>
      <PageLink id="bbx-box-screen-history" to={view(SYSTEM_CARD_PATHS.history)}>History</PageLink>
      <PageLink id="bbx-box-screen-inventory" to={view(SYSTEM_CARD_PATHS.inventory)}>Storage summary</PageLink>
      {/* Keyed by position as well: a card may list one target under two labels. */}
      {shortcuts.map((shortcut, index) => (
        <PageLink key={`${index}:${shortcut.to}`} id={`bbx-box-screen-shortcut-${index}`} to={href(`/${boxSlug}${shortcut.to}`)}>{shortcut.label}</PageLink>
      ))}
    </ul>
  );
}

/** The other boxes, each opening its own box screen. */
export function OtherBoxes({ boxes }: { boxes: KnownBox[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {boxes.map((box) => (
        <li key={box.slug}>
          <Link id={`bbx-box-screen-box-${box.slug}`} to={href(`/${box.slug}/box`)} className={PLAIN_TILE}>
            <CardMark symbol={box.symbol ?? null} size="sm" boxSlug={box.slug} />
            <span className="min-w-0 truncate font-medium">{box.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
