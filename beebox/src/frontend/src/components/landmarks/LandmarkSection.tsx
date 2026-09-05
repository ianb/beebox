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
import { apiFileUrl, isExternalUrl, type ViewTarget } from "../../lib/view-url";
import { resolveContentTarget } from "../../lib/view-url";
import { toDisplayPath } from "@shared/display-path";
import type { SessionRowItem } from "../session-pickers/SessionRow";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ChevronIcon } from "./ChevronIcon";
import { LandmarkSessions } from "./LandmarkSessions";

export interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

export interface ResolvedGroup {
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

/*
 * Nesting indent, reduced below `sm`. The desktop steps (8/16/24/32 = up to
 * 8rem) are unchanged; on a 390px phone that deepest step alone ate a third
 * of the viewport before any content. Mobile steps are a quarter of
 * desktop's — still legible as hierarchy, without spending the screen on it.
 * (Removed with the activity ordering, restored with the directory grouping
 * — the indent is what makes the grouping legible.)
 */
const INDENT_CLASSES = ["", "ml-2 sm:ml-8", "ml-4 sm:ml-16", "ml-6 sm:ml-24", "ml-8 sm:ml-32"];

function PathLink({ dir, boxSlug }: { dir: string; boxSlug: string }) {
  // The root landmark has no meaningful path — a bare "/" under its title
  // reads as leftover plumbing (a field-test operator stared at it and
  // guessed "a separator with the parts missing"). The tile's label carries
  // its identity; skip the line entirely for root.
  if (dir === "") return null;
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
      <Text as="span" size="xs" tone="muted" breakAll>{`${toDisplayPath(dir)}/`}</Text>
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
  const labelText = landmark.label || toDisplayPath(landmark.path);
  const indentClass = INDENT_CLASSES[Math.min(landmark.depth, INDENT_CLASSES.length - 1)];

  return (
    <Card padding="md" border="subtle" shadow className={indentClass}>
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
export function LandmarkLinks({
  links,
  boxSlug,
  onNavigate,
  compact,
}: {
  links: ResolvedLink[];
  boxSlug: string;
  onNavigate?: (target: ViewTarget) => void;
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (links.length === 0) return null;
  const visible = showAll ? links : links.slice(0, LINK_CAP);

  return (
    <Stack gap="xs">
      <div className={`grid grid-cols-1 gap-2 ${compact === true ? "" : "sm:grid-cols-2"}`}>
        {visible.map((link) => (
          <LinkTile key={link.ref} link={link} boxSlug={boxSlug} onNavigate={onNavigate} />
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

export function LandmarkGroup({
  group,
  boxSlug,
  onNavigate,
  compact,
}: {
  group: ResolvedGroup;
  boxSlug: string;
  onNavigate?: (target: ViewTarget) => void;
  compact?: boolean;
}) {
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
        <div className={`ml-6 grid grid-cols-1 gap-2 ${compact === true ? "" : "sm:grid-cols-2"}`}>
          {group.children.map((link) => (
            <LinkTile key={link.ref} link={link} boxSlug={boxSlug} onNavigate={onNavigate} />
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

export function LandmarkSymbol({
  landmark,
  boxSlug,
  compact,
}: {
  landmark: Pick<Landmark, "symbol" | "symbolSrc">;
  boxSlug: string;
  compact?: boolean;
}) {
  const isCompact = compact === true;
  if (landmark.symbolSrc) {
    return (
      <img
        src={apiFileUrl(boxSlug, landmark.symbolSrc)}
        alt=""
        className={`${isCompact ? "w-9 h-9" : "w-14 h-14"} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <span className={`${isCompact ? "text-2xl" : "text-4xl"} leading-none flex-shrink-0`} aria-hidden>
      {landmark.symbol || "📍"}
    </span>
  );
}

function LinkTile({
  link,
  boxSlug,
  onNavigate,
}: {
  link: ResolvedLink;
  boxSlug: string;
  onNavigate?: (target: ViewTarget) => void;
}) {
  const display = link.label !== null && link.label.length > 0 ? link.label : link.title;
  // Box-rooted refs (leading `/`) get the display form; attach/relative refs
  // and external URLs (handled separately below) pass through as-is.
  const refDisplay = link.ref.startsWith("/") ? toDisplayPath(link.ref) : link.ref;

  if (isExternalUrl(link.ref)) {
    return (
      <a href={link.ref} target="_blank" rel="noopener noreferrer" className="block">
        <Card padding="sm" border="subtle" className="hover:border-info-400 transition-colors">
          <Text as="div" size="sm" weight="medium">{display}</Text>
          <Text as="div" size="xs" tone="muted" truncate>{link.ref}</Text>
        </Card>
      </a>
    );
  }

  if (!link.exists) {
    return (
      <Card padding="sm" border="subtle" muted>
        <Text as="div" size="sm" weight="medium" tone="muted">{display}</Text>
        <Text as="div" size="xs" tone="muted">Missing</Text>
      </Card>
    );
  }

  const target = resolveContentTarget(undefined, link.ref);
  if (onNavigate !== undefined && target !== null) {
    return (
      <button type="button" onClick={() => onNavigate(target)} className="block w-full text-left">
        <Card padding="sm" border="subtle" className="hover:border-info-400 transition-colors">
          <Text as="div" size="sm" weight="medium">{display}</Text>
          <Text as="div" size="xs" tone="muted" truncate>{refDisplay}</Text>
        </Card>
      </button>
    );
  }

  return (
    <Link to={href(`/${boxSlug}/card/${link.ref}`)} className="block">
      <Card padding="sm" border="subtle" className="hover:border-info-400 transition-colors">
        <Text as="div" size="sm" weight="medium">{display}</Text>
        <Text as="div" size="xs" tone="muted" truncate>{refDisplay}</Text>
      </Card>
    </Link>
  );
}
