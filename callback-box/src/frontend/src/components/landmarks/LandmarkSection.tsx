/**
 * One landmark rendered as a section of the merged activity surface: symbol
 * + label header, its chats (rows + older disclosure + New chat), and its
 * resolved link tiles. Click a tile to open the target card.
 *
 * Links are capped at the first `LINK_CAP` tiles with an inline "Show all"
 * disclosure — there is no landmark full-form page to click through to
 * (docs/plans/top-nav-ia.md Track D). Sessions come from `chat.byLandmark`,
 * joined by directory upstream in `LandmarksList`; see docs/landmarks.md for
 * the chat/directory association model.
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { apiFileUrl } from "../../lib/view-url";
import type { SessionRowItem } from "../session-pickers/SessionRow";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ChevronIcon } from "./ChevronIcon";
import { LandmarkSessions } from "./LandmarkSessions";

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
 * How many link tiles show before the "Show all" disclosure. Six fills two
 * desktop columns three rows deep — enough that most landmarks show whole,
 * short enough that a link-heavy one doesn't bury the next landmark's chats.
 */
const LINK_CAP = 6;

export function LandmarkSection({
  landmark,
  boxSlug,
  sessions,
}: {
  landmark: Landmark;
  boxSlug: string;
  /** This landmark's chat bucket, or null when the box has no session data. */
  sessions: { sessions: SessionRowItem[]; olderSessions: SessionRowItem[] } | null;
}) {
  const labelText = landmark.label || landmark.path;

  return (
    <Card padding="md" border="subtle" shadow>
      <Stack gap="md">
        <div className="flex items-center gap-3">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} />
          {/* min-w-0 flex-1: the path below wraps break-all, so a shrink-to-fit
              header column would break a short path mid-word. */}
          <Stack gap="xs" className="min-w-0 flex-1">
            <Text as="h2" size="lg" weight="bold">{labelText}</Text>
            <PathLink dir={landmark.dir} boxSlug={boxSlug} />
          </Stack>
        </div>

        <LandmarkSessions
          bucket={{
            dir: landmark.dir,
            sessions: sessions === null ? [] : sessions.sessions,
            olderSessions: sessions === null ? [] : sessions.olderSessions,
          }}
          boxSlug={boxSlug}
        />

        <LandmarkLinks links={landmark.links} boxSlug={boxSlug} />

        {landmark.groups.map((group) => (
          <LandmarkGroup key={group.label} group={group} boxSlug={boxSlug} />
        ))}
      </Stack>
    </Card>
  );
}

/**
 * The link grid, capped: the first `LINK_CAP` tiles always show, the rest sit
 * behind an inline disclosure rather than a click-through (no full-form view
 * exists to click through to).
 */
function LandmarkLinks({ links, boxSlug }: { links: ResolvedLink[]; boxSlug: string }) {
  const [showAll, setShowAll] = useState(false);
  if (links.length === 0) return null;
  const visible = showAll ? links : links.slice(0, LINK_CAP);

  return (
    <Stack gap="xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {visible.map((link) => (
          <LinkTile key={link.ref} link={link} boxSlug={boxSlug} />
        ))}
      </div>
      {links.length > LINK_CAP ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="flex items-center gap-2 self-start px-2 py-1 -mx-2 rounded text-left hover:bg-warm-100"
        >
          <ChevronIcon open={showAll} />
          <Text as="span" size="sm">{showAll ? "Show fewer" : "Show all"}</Text>
          <Text as="span" size="xs" tone="muted">{links.length}</Text>
        </button>
      ) : null}
    </Stack>
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
