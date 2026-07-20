/**
 * One landmark rendered as a section: symbol + label header, plus a
 * grid of resolved link tiles. Click a tile to open the target card.
 *
 * The "Chat" button opens (or starts) a chat associated with this
 * landmark's directory — see chat-session-history.ts and
 * docs/landmarks.md for the association model.
 */

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { apiFileUrl } from "../../lib/view-url";
import { trpc } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

interface ResolvedGroup {
  label: string;
  children: ResolvedLink[];
  count: number;
}

interface Landmark {
  path: string;
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
  links: ResolvedLink[];
  groups: ResolvedGroup[];
  depth: number;
}

function PathLink({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  return (
    <Link
      to={href(`/${boxSlug}/browse/${dir}`)}
      className="inline-block self-start min-w-0 max-w-full px-2 py-0.5 -mx-2 rounded hover:bg-warm-100"
    >
      {/*
       * breakAll because a box path is one unbreakable token — browsers don't
       * offer a line-break opportunity at `/`, so a deep path overflows its
       * container and pushes the page wide on a phone. Wrapping (not truncate)
       * because the tail of a path is the part that identifies it; the sibling
       * link refs below truncate, but those have a label above them and this
       * doesn't.
       */}
      <Text as="span" size="xs" tone="muted" breakAll>{dir ? `${dir}/` : "/"}</Text>
    </Link>
  );
}

/*
 * Nesting indent, reduced below `sm`. The desktop steps (8/16/24/32 = up to
 * 8rem) are unchanged; on a 390px phone that deepest step alone ate a third of
 * the viewport before any content, which compounds with a long path to push the
 * page wide. Mobile steps are a quarter of desktop's — still legible as
 * hierarchy, without spending the screen on it.
 */
const INDENT_CLASSES = ["", "ml-2 sm:ml-8", "ml-4 sm:ml-16", "ml-6 sm:ml-24", "ml-8 sm:ml-32"];

export function LandmarkSection({ landmark, boxSlug }: { landmark: Landmark; boxSlug: string }) {
  const labelText = landmark.label || landmark.path;
  const indentClass = INDENT_CLASSES[Math.min(landmark.depth, INDENT_CLASSES.length - 1)];

  return (
    <Card padding="md" border="subtle" shadow className={indentClass}>
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

        {landmark.groups.map((group) => (
          <LandmarkGroup key={group.label} group={group} boxSlug={boxSlug} />
        ))}
      </Stack>
    </Card>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function LandmarkGroup({ group, boxSlug }: { group: ResolvedGroup; boxSlug: string }) {
  const [open, setOpen] = useState(false);
  const overflow = group.count - group.children.length;

  return (
    <Stack gap="xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 px-2 py-1 -mx-2 rounded text-left hover:bg-warm-100"
      >
        <ChevronIcon open={open} />
        <Text as="span" size="sm" weight="medium">{group.label}</Text>
        <Text as="span" size="xs" tone="muted">{group.count}</Text>
      </button>
      {open ? (
        <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {group.children.map((link) => (
            <LinkTile key={link.ref} link={link} boxSlug={boxSlug} />
          ))}
          {overflow > 0 ? (
            <Text as="div" size="xs" tone="muted" className="self-center">
              +{overflow} more
            </Text>
          ) : null}
        </div>
      ) : null}
    </Stack>
  );
}

function ChatButton({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const onClick = async () => {
    try {
      const { sessionId } = await utils.chat.lastSessionForDirectory.fetch({ contextDir: dir });
      if (sessionId) {
        // navigate()'s promise only rejects on a superseded/redirected
        // navigation (not a user-facing failure) -- fire-and-forget.
        void navigate({
          to: href(`/${boxSlug}/chat`),
          search: toSearch({ session: sessionId }),
        });
        return;
      }
      // No prior chat for this dir — start a new one. The backend reads
      // `contextDir` off the first send and spawns the SDK with `cwd` at
      // that directory; the association is persisted on session assignment.
      void navigate({
        to: href(`/${boxSlug}/chat`),
        search: toSearch({ session: "new", contextDir: dir }),
      });
    } catch (e) {
      // User-initiated action (policy rule 5): no toast affordance on this
      // button today, so log at error level as the interim signal.
      console.error(`[landmarks] failed to open chat for ${dir}:`, e);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
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
        src={apiFileUrl(boxSlug, landmark.symbolSrc)}
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
