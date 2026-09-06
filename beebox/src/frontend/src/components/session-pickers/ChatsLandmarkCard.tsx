/**
 * Card-local components for the chats picker (`view: chat-picker` cards).
 * Lives under `components/` so appearance classes (rounded borders, hover
 * states, etc.) are allowed on raw elements.
 *
 * Session rows themselves are shared with the Landmarks page — see
 * `SessionRow` (docs/plans/top-nav-ia.md Track D).
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SessionRow, type SessionRowItem } from "./SessionRow";
import { DeadSessionSection, type DeadSessionRowItem } from "./DeadSessionRow";
import type { CardSymbolData } from "@shared/card-symbol";
import { CardMark } from "../ui/CardMark";

export interface PickerLandmark {
  /** Box-relative path; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: CardSymbolData | null;
  sessions: SessionRowItem[];
  olderSessions: SessionRowItem[];
  /** Chats with no transcript left — listed after the live ones, or not at all. */
  dead: DeadSessionRowItem[];
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
  const isEmpty = !hasFresh && !hasOlder && landmark.dead.length === 0;
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

        <DeadSessionSection sessions={landmark.dead} boxSlug={boxSlug} />
      </Stack>
    </Card>
  );
}

/** The landmark's mark at picker size — `CardMark` draws it. */
function LandmarkSymbol({ landmark, boxSlug, compact }: { landmark: PickerLandmark; boxSlug: string; compact: boolean }) {
  return <CardMark symbol={landmark.symbol} size={compact ? "md" : "lg"} boxSlug={boxSlug} fallback="📍" />;
}
