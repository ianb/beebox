/**
 * The `PlacePill`'s here menu, reduced form (docs/plans/top-nav-ia.md Track
 * C1): "Open <dir>/" plus the landmark's curated links and groups, rendered
 * as plain navigations to the card route.
 *
 * The full form — the chat's own `ContextMenuBody`, whose rows open in the
 * companion pane (`onZoomView`) and which adds "Recent files ›" — needs chat
 * state the bar doesn't have. It arrives via the chrome slot in C2; this
 * reduced menu is what non-chat pages get, and the fallback while the chat
 * slot hasn't mounted.
 */

import { useState } from "react";
import { MenuItem, MenuDivider } from "./ui/dropdown-menu-item";
import { href } from "../lib/routing";
import { useViewNavigate } from "../hooks/useViewNavigate";

export interface HereLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

export interface HereGroup {
  label: string;
  children: HereLink[];
  /** Total members, which may exceed the resolved `children`. */
  count: number;
}

function linkText(link: HereLink): string {
  return link.label !== null && link.label.length > 0 ? link.label : link.title;
}

/**
 * A landmark bookmark. A missing target still renders — visibly marked, not
 * hidden — but as an inert row: there's nothing to navigate to.
 */
function HereLinkRow({ link, boxSlug }: { link: HereLink; boxSlug: string }) {
  if (!link.exists) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-warm-400">
        <span className="min-w-0 truncate">{linkText(link)}</span>
        <span className="ml-auto shrink-0 text-xs text-danger">(missing)</span>
      </div>
    );
  }
  return (
    <MenuItem to={href(`/${boxSlug}/card/${link.ref}`)}>
      <span className="block min-w-0 truncate">{linkText(link)}</span>
    </MenuItem>
  );
}

function GroupChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
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

function HereGroupRows({ group, boxSlug }: { group: HereGroup; boxSlug: string }) {
  const [open, setOpen] = useState(false);
  const overflow = group.count - group.children.length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 hover:bg-warm-100 flex items-center gap-2 text-warm-800"
      >
        <GroupChevron open={open} />
        <span className="truncate font-medium">{group.label}</span>
        <span className="text-xs text-warm-500 shrink-0 ml-auto">{group.count}</span>
      </button>
      {open ? (
        <div className="border-l border-warm-200 ml-5">
          {group.children.map((link) => (
            <HereLinkRow key={link.ref} link={link} boxSlug={boxSlug} />
          ))}
          {overflow > 0 ? (
            <div className="px-3 py-2 text-xs text-warm-500">+{overflow} more</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `dir` is the landmark's own directory — the here half only renders when a
 * landmark resolved for it, so there is always a directory to open.
 */
export function HereMenuBody({
  dir,
  landmarkPath,
  boxSlug,
  links,
  groups,
}: {
  dir: string;
  landmarkPath: string;
  boxSlug: string;
  links: HereLink[];
  groups: HereGroup[];
}) {
  const openView = useViewNavigate();
  const hasBookmarks = links.length > 0 || groups.length > 0;
  return (
    <>
      <MenuItem id="bbx-here-menu-open-dir" to={href(dir === "" ? `/${boxSlug}/browse` : `/${boxSlug}/browse/${dir}`)}>
        Open {dir === "" ? "/" : `${dir}/`}
      </MenuItem>
      <MenuItem id="bbx-here-menu-landmark-card" onClick={() => openView({
        path: landmarkPath, viewer: null, params: {}, viewState: null,
      }, { label: "Landmark card" })}>Landmark card</MenuItem>
      {hasBookmarks ? <MenuDivider /> : null}
      {links.map((link) => (
        <HereLinkRow key={link.ref} link={link} boxSlug={boxSlug} />
      ))}
      {groups.map((group) => (
        <HereGroupRows key={group.label} group={group} boxSlug={boxSlug} />
      ))}
    </>
  );
}
