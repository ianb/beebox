/**
 * One landmark rendered as a section: symbol + label header, plus a
 * grid of resolved link tiles. Click a tile to open the target card.
 *
 * The "Chat" button opens (or starts) a chat associated with this
 * landmark's directory — see chat-session-history.ts and
 * docs/landmarks.md for the association model.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { href } from "../../../lib/routing";
import { trpc } from "../../../lib/trpc";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

interface Landmark {
  path: string;
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  links: ResolvedLink[];
}

function PathLink({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  return (
    <Link to={href(`/${boxSlug}/browse/${dir}`)} className="hover:underline">
      <Text as="span" size="xs" tone="muted">{dir ? `${dir}/` : "/"}</Text>
    </Link>
  );
}

export function LandmarkSection({ landmark, boxSlug }: { landmark: Landmark; boxSlug: string }) {
  const labelText = landmark.label || landmark.path;

  return (
    <Card padding="md" border="subtle" shadow>
      <Stack gap="md">
        <div className="flex items-center gap-3">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} />
          <Stack gap="xs">
            <Text as="h2" size="lg" weight="bold">{labelText}</Text>
            <PathLink dir={landmark.dir} boxSlug={boxSlug} />
          </Stack>
          <div className="ml-auto">
            <ChatButton dir={landmark.dir} boxSlug={boxSlug} />
          </div>
        </div>

        {landmark.links.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {landmark.links.map((link) => (
              <LinkTile key={link.ref} link={link} boxSlug={boxSlug} />
            ))}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}

function ChatButton({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const onClick = async () => {
    const { sessionId } = await utils.chat.lastSessionForDirectory.fetch({ contextDir: dir });
    if (sessionId) {
      navigate({
        to: href(`/${boxSlug}/chat`),
        search: { session: sessionId } as never,
      });
      return;
    }
    // No prior chat for this dir — start a new one. The backend reads
    // `contextDir` off the first send and spawns the SDK with `cwd` at
    // that directory; the association is persisted on session assignment.
    navigate({
      to: href(`/${boxSlug}/chat`),
      search: { session: "new", contextDir: dir } as never,
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded text-sm font-medium bg-info-50 text-info-dark border border-info-200 hover:bg-info-100 transition-colors"
    >
      Chat
    </button>
  );
}

function LandmarkSymbol({ landmark, boxSlug }: { landmark: Landmark; boxSlug: string }) {
  if (landmark.symbolSrc) {
    return (
      <img
        src={`/${boxSlug}/api/files/${landmark.symbolSrc}`}
        alt=""
        className="w-14 h-14 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <span className="text-4xl leading-none flex-shrink-0" aria-hidden>
      {landmark.symbol || "📍"}
    </span>
  );
}

function LinkTile({ link, boxSlug }: { link: ResolvedLink; boxSlug: string }) {
  const display = link.label !== null && link.label.length > 0 ? link.label : link.title;

  if (!link.exists) {
    return (
      <Card padding="sm" border="subtle" muted>
        <Text as="div" size="sm" weight="medium" tone="muted">{display}</Text>
        <Text as="div" size="xs" tone="muted">Missing</Text>
      </Card>
    );
  }

  return (
    <Link to={href(`/${boxSlug}/card/${link.ref}`)} className="block">
      <Card padding="sm" border="subtle" className="hover:border-info-400 transition-colors">
        <Text as="div" size="sm" weight="medium">{display}</Text>
        <Text as="div" size="xs" tone="muted" truncate>{link.ref}</Text>
      </Card>
    </Link>
  );
}
