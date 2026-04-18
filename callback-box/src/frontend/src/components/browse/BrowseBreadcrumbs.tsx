/**
 * Breadcrumb strip for the browse sidebar. Wraps links around the `/`
 * separators with no whitespace so the rendered path copies cleanly.
 */

import { Fragment } from "react";

interface BrowseBreadcrumbsProps {
  dirPath: string;
  onNavigate: (path: string) => void;
}

export function BrowseBreadcrumbs({ dirPath, onNavigate }: BrowseBreadcrumbsProps) {
  const segments = dirPath ? dirPath.split("/").filter(Boolean) : [];

  return (
    <div className="px-3 py-2 border-b text-sm break-words">
      <button
        onClick={() => onNavigate("")}
        className="text-primary hover:text-primary-dark hover:underline px-0.5"
      >/</button>
      {segments.map((seg, i) => {
        const segPath = segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <Fragment key={segPath}>
            <wbr />
            {i > 0 ? <span className="text-warm-500 px-0.5">/</span> : null}
            {isLast ? (
              <span className="text-warm-700 font-medium px-0.5">{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-primary hover:text-primary-dark hover:underline px-0.5"
              >{seg}</button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
