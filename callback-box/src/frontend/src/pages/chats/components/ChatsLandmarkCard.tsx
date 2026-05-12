/**
 * Page-local components for the Chats picker. Lives under `components/`
 * so appearance classes (rounded borders, hover states, etc.) are
 * allowed on raw elements — the page itself sticks to primitives.
 */

import { Link } from "@tanstack/react-router";
import { href } from "../../../lib/routing";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";

export interface PickerSession {
  sessionId: string;
  label: string;
  lastActivity: string;
}

export interface PickerLandmark {
  /** Box-relative path; empty string for the root tile. */
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  sessions: PickerSession[];
}

export function ChatsLandmarkCard({
  landmark,
  boxSlug,
}: {
  landmark: PickerLandmark;
  boxSlug: string;
}) {
  return (
    <Card padding="md" border="subtle" shadow>
      <Stack gap="sm">
        <div className="flex items-center gap-3">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} />
          <Stack gap="xs">
            <Text as="h2" size="lg" weight="bold">{landmark.label}</Text>
            {landmark.dir ? (
              <Text as="span" size="xs" tone="muted">{landmark.dir}/</Text>
            ) : null}
          </Stack>
          <div className="ml-auto">
            <Link
              to={href(`/${boxSlug}/chat`)}
              search={{ session: "new", contextDir: landmark.dir } as never}
              className="px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
            >
              New
            </Link>
          </div>
        </div>

        {landmark.sessions.length === 0 ? (
          <Text as="p" size="sm" tone="muted">No recent chats here.</Text>
        ) : (
          <Stack gap="xs">
            {landmark.sessions.map((s) => (
              <SessionRow key={s.sessionId} session={s} boxSlug={boxSlug} />
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function LandmarkSymbol({ landmark, boxSlug }: { landmark: PickerLandmark; boxSlug: string }) {
  if (landmark.symbolSrc) {
    return (
      <img
        src={`/${boxSlug}/api/files/${landmark.symbolSrc}`}
        alt=""
        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <span className="text-3xl leading-none flex-shrink-0" aria-hidden>
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
    <Link
      to={href(`/${boxSlug}/chat`)}
      search={{ session: session.sessionId } as never}
      className="block px-3 py-2 rounded border border-subtle hover:border-info-400 hover:bg-info-50/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <Text as="div" size="sm" truncate className="flex-1">{session.label}</Text>
        <Text as="span" size="xs" tone="muted" className="flex-shrink-0">
          {formatRelativeTime(session.lastActivity)}
        </Text>
      </div>
    </Link>
  );
}
