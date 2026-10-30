/**
 * Landmark links + groups section of the context chip's menu — extracted
 * from the retired `LandmarkLinksButton` trigger (chunk 4 of
 * docs/implemented-plans/chat-header-chips.md). Owns the `trpc.landmarks.forDir` query.
 *
 * When the chat is scoped to a directory whose landmark carries
 * `navigation.links` (or `expand` fan-out), this surfaces those resolved
 * links as a curated bookmark list. Each item opens its target in the
 * companion sidebar (via `onPanel`) rather than navigating away.
 *
 * Three outcomes, each distinct (principle 4, resilient-and-never-silent):
 * a landmark with links renders them; a landmark with none (or no context at
 * all) renders nothing — the section is simply absent, but the chip and menu
 * around it remain; a query FAILURE renders an explicit "Couldn't load
 * landmark links" row, rather than being indistinguishable from "no links"
 * (the bug in the retired button). A section with rows opens with a divider.
 * The landmark card itself is not a row: the agent edits it, not the person
 * (docs/plans/box-screen.md, track 3).
 */

import { LandmarkGroupRows } from "../../../landmarks/LandmarkGroupRows";
import { trpc } from "../../../../lib/trpc/client";
import { useDropdownClose } from "../../../ui/Dropdown";
import { MenuDivider } from "../../../ui/dropdown-menu-item";

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

interface LandmarkLinksPanelProps {
  /** Box-relative dir the chat is scoped to (`""` for root, null for none). */
  contextDir: string | null;
  /** Open a link's target in the companion pane. */
  onPanel: (link: ResolvedLink) => void;
}

export function LandmarkLinksPanel({ contextDir, onPanel }: LandmarkLinksPanelProps) {
  const { data, isError, error, refetch } = trpc.landmarks.forDir.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );

  if (contextDir === null) return null;

  if (isError) {
    return (
      <div className="px-3 py-2 text-sm text-danger-dark border-t border-warm-200">
        Couldn&rsquo;t load landmark links: {error.message}.{" "}
        <button id="bbx-landmark-links-retry" type="button" onClick={() => void refetch()} className="underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }

  const landmark = data?.landmark ?? null;
  const links = landmark?.links ?? [];
  const groups = landmark?.groups ?? [];
  if (links.length === 0 && groups.length === 0) return null;

  return (
    <>
    <MenuDivider />
    <div className="py-1">
      {links.map((link) => (
        <MenuLink key={link.ref} link={link} onPanel={onPanel} />
      ))}
      {groups.map((group) => (
        <MenuGroup key={group.label} group={group} onPanel={onPanel} />
      ))}
    </div>
    </>
  );
}

function MenuLink({ link, onPanel }: { link: ResolvedLink; onPanel: (link: ResolvedLink) => void }) {
  const close = useDropdownClose();
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { close(); onPanel(link); }}
      className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
    >
      <span className="truncate">{link.label ?? link.title}</span>
      {!link.exists ? <span className="text-xs text-danger shrink-0">(missing)</span> : null}
    </button>
  );
}

function MenuGroup({ group, onPanel }: { group: ResolvedGroup; onPanel: (link: ResolvedLink) => void }) {
  return (
    <LandmarkGroupRows
      group={group}
      renderChild={(link) => <MenuLink link={link} onPanel={onPanel} />}
    />
  );
}
