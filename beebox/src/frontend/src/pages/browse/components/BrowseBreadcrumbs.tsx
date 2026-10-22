/**
 * Breadcrumb strip for the browse sidebar. Wraps links around the `/`
 * separators with no whitespace so the rendered path copies cleanly.
 */

import { Fragment } from "react";
import { attachDirOwnerBasename } from "@shared/attach-path";
import { areaDisplayLabel } from "@shared/display-path";

interface BrowseBreadcrumbsProps {
  dirPath: string;
  /** Where the root crumb `/` goes for a path under it: the content root, `_content`. */
  rootPath: string;
  onNavigate: (path: string) => void;
}

/**
 * A `<basename>.attach` segment is presented as the owning card (the `.attach`
 * scope reads as "inside the card"), so the crumb shows `<basename>`, not the
 * implementation-detail directory name. Navigation still targets the real path.
 */
function segmentLabel(seg: string): string {
  return attachDirOwnerBasename(seg) ?? seg;
}

/**
 * `_content` is the boxholder's home and displays bare — its segment is
 * dropped from the crumb trail entirely, so `_content/recipes` reads as just
 * `recipes`. A machinery area (`_config`, `_bookkeeping`, ...) has no bare
 * form, so its segment stays but relabels to the area's friendly name
 * (`_config` → `Config`) — display-path.ts's vocabulary.
 *
 * The root crumb `/` opens `rootPath` (the content root). Outside it — the
 * box root `""` and the machinery areas — the root crumb reads "Whole box"
 * and opens the box root, where the area names list.
 */
export function BrowseBreadcrumbs({ dirPath, rootPath, onNavigate }: BrowseBreadcrumbsProps) {
  const rawSegments = dirPath ? dirPath.split("/").filter(Boolean) : [];
  const isContentArea = rawSegments[0] === "_content";
  const segments = isContentArea ? rawSegments.slice(1) : rawSegments;
  const pathOffset = isContentArea ? 1 : 0;
  const underRoot = dirPath === rootPath || dirPath.startsWith(`${rootPath}/`);

  return (
    <div className="px-3 py-2 border-b text-sm break-words">
      <button
        id="bbx-browse-crumb-root"
        data-bbx-does={underRoot ? "goes to the top of the content" : "goes to the whole box"}
        onClick={() => onNavigate(underRoot ? rootPath : "")}
        className="text-primary hover:text-primary-dark hover:underline px-0.5"
      >{underRoot ? "/" : "Whole box"}</button>
      {segments.map((seg, i) => {
        const segPath = rawSegments.slice(0, pathOffset + i + 1).join("/");
        const isLast = i === segments.length - 1;
        const label = i === 0 && !isContentArea ? areaDisplayLabel(seg) : segmentLabel(seg);
        return (
          <Fragment key={segPath}>
            <wbr />
            {i > 0 || !underRoot ? <span className="text-warm-700 px-0.5">/</span> : null}
            {isLast ? (
              <span className="text-warm-700 font-medium px-0.5">{label}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-primary hover:text-primary-dark hover:underline px-0.5"
              >{label}</button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
