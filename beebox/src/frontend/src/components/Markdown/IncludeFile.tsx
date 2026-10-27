/**
 * An include line in an agent instruction file (`lib/include-lines.ts`),
 * shown as "includes <path>" with a link to the included file.
 *
 * The path resolves against the including file's folder. A path outside the
 * box's viewable areas (the root `.beebox/` folder, for one) has no page to
 * open, so it reads "not viewable here"; a path that resolves but has no file
 * reads "missing".
 */

import type { ComponentType, ReactNode } from "react";
import { trpc } from "../../lib/trpc/client";
import { resolveContentTarget } from "../../lib/view-url";

export interface IncludeFileContext {
  basePath: string | undefined;
  /** The Markdown renderer's own link, so the include opens like any relative link. */
  Link: ComponentType<{ href?: string; children?: ReactNode }>;
}

const ROW_CLASS = "bbx-include-file my-1 text-sm text-card-soft";

export function makeIncludeFileComponent(ctx: IncludeFileContext): (props: { path?: string }) => ReactNode {
  return function IncludeFile({ path }: { path?: string }): ReactNode {
    if (path === undefined || path === "") return null;
    const target = resolveContentTarget(ctx.basePath, path);
    if (target === null) {
      return (
        <div className={ROW_CLASS} title="This file is outside the parts of the box this app shows">
          includes <code>{path}</code> <span className="text-card-soft">(not viewable here)</span>
        </div>
      );
    }
    return <IncludedLink path={path} boxPath={target.path} Link={ctx.Link} />;
  };
}

function IncludedLink({ path, boxPath, Link }: { path: string; boxPath: string; Link: IncludeFileContext["Link"] }) {
  const kind = trpc.files.kind.useQuery({ path: boxPath });
  if (kind.data?.kind === "missing") {
    return (
      <div className={ROW_CLASS} title={`No file at ${boxPath}`}>
        includes <code>{path}</code> <span className="text-card-danger">(missing)</span>
      </div>
    );
  }
  return (
    <div className={ROW_CLASS}>
      includes <Link href={path}><code>{path}</code></Link>
      {kind.error ? <span className="ml-1 text-card-soft" title={kind.error.message}>(could not check)</span> : null}
    </div>
  );
}
