/**
 * Page-local components for the Chats picker. Lives under `components/`
 * so appearance classes (rounded borders, hover states, etc.) are
 * allowed on raw elements — the page itself sticks to primitives.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { apiFileUrl } from "../../lib/view-url";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
  /** Box-relative path of the session's husk card. */
  huskPath: string;
}

export interface PickerLandmark {
  /** Box-relative path; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  sessions: PickerSession[];
  olderSessions: PickerSession[];
}

export function ChatsLandmarkCard({
  landmark,
  boxSlug,
}: {
  landmark: PickerLandmark;
  boxSlug: string;
}) {
  const hasFresh = landmark.sessions.length > 0;
  const hasOlder = landmark.olderSessions.length > 0;
  const isEmpty = !hasFresh && !hasOlder;
  const [showOlder, setShowOlder] = useState(false);
  return (
    <Card padding={isEmpty ? "sm" : "md"} border="subtle" shadow={!isEmpty} muted={isEmpty}>
      <Stack gap="sm">
        <div className="flex items-center gap-3">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} compact={isEmpty} />
          <Stack gap="xs">
            <Text as="h2" size={isEmpty ? "base" : "lg"} weight="bold">{landmark.label}</Text>
            {landmark.dir ? (
              <Text as="span" size="xs" tone="muted">{landmark.dir}/</Text>
            ) : null}
          </Stack>
          <div className="ml-auto">
            <Link
              to={href(`/${boxSlug}/chat`)}
              search={toSearch({ session: "new", contextDir: landmark.dir })}
              className="px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
            >
              New
            </Link>
          </div>
        </div>

        {hasFresh ? (
          <Stack gap="xs">
            {landmark.sessions.map((s) => (
              <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
            ))}
          </Stack>
        ) : null}

        {hasOlder ? (
          <Stack gap="xs">
            <button
              type="button"
              onClick={() => setShowOlder((v) => !v)}
              className="self-start text-xs text-info-dark hover:underline"
            >
              {showOlder ? "Hide" : "Show"} older ({landmark.olderSessions.length})
            </button>
            {showOlder ? (
              <Stack gap="xs">
                {landmark.olderSessions.map((s) => (
                  <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
                ))}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

function LandmarkSymbol({
  landmark,
  boxSlug,
  compact,
}: {
  landmark: PickerLandmark;
  boxSlug: string;
  compact?: boolean;
}) {
  if (landmark.symbolSrc) {
    return (
      <img
        src={apiFileUrl(boxSlug, landmark.symbolSrc)}
        alt=""
        className={compact ? "w-8 h-8 rounded-full object-cover flex-shrink-0" : "w-12 h-12 rounded-full object-cover flex-shrink-0"}
      />
    );
  }
  return (
    <span className={compact ? "text-xl leading-none flex-shrink-0" : "text-3xl leading-none flex-shrink-0"} aria-hidden>
      {landmark.symbol || "📍"}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function SessionRow({ session, boxSlug }: { session: PickerSession; boxSlug: string }) {
  return (
    <div className="flex items-stretch gap-1">
      <Link
        to={href(`/${boxSlug}/chat`)}
        search={toSearch({ session: session.sessionId })}
        className="block flex-1 px-3 py-2 rounded border border-subtle hover:border-info-400 hover:bg-info-50/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          <Text as="div" size="sm" className="flex-1 line-clamp-2">{session.label}</Text>
          <Text as="span" size="xs" tone="muted" className="flex-shrink-0">
            {formatRelativeTime(session.lastActivity)}
          </Text>
        </div>
      </Link>
      {/* The session's husk card — the durable, editable face of this chat. */}
      <Link
        to={href(`/${boxSlug}/browse/${session.huskPath}`)}
        title="Open this chat's card"
        aria-label="Open this chat's card"
        className="flex items-center px-2 rounded border border-subtle text-warm-400 hover:text-info-dark hover:border-info-400 transition-colors"
      >
        <Text as="span" size="xs">card</Text>
      </Link>
    </div>
  );
}
