/**
 * Node entry for the `beebox/view-widgets` bundle (dist/view-widgets).
 *
 * `bbx view test` renders a view to a string in Node, with no browser app around
 * it: no Router, no tRPC, no QueryClient. So the same widget components consume
 * a *node* view host here — `useResolvedRef` derives a title from the ref's
 * filename (no fetch), `renderInline` emits a minimal block, `openCard` is a
 * no-op (there is no surface to navigate). `bbx view test` wraps the rendered
 * view in `NodeViewHostProvider` (see src/cli/commands/view.ts), and the view's
 * own `import … from "beebox/view-widgets"` resolves CardLink/CardRef
 * here via the package `exports` map.
 *
 * This file lives under the frontend tsconfig (it renders frontend components);
 * build-cli.mjs bundles it to dist/view-widgets/index.js with React external.
 */

import { useMemo, type ReactNode } from "react";
// Relative (not `@shared/…`): this file is also the dist/view-widgets node
// bundle entry, built with `packages: "external"`, which would leave the
// aliased specifier unresolved at runtime. Relative paths bundle inline.
import { cardTypeFromName } from "../../../../shared/card-name";
import { ViewHostProvider, type ViewHost, type ResolvedRef } from "../../lib/view-host";
import { BoxSlugProvider } from "../../lib/box-slug";
import { LightboxProvider } from "../LightboxProvider";
import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";

export { CardLink, CardRef };

/** Filename-derived title (mirrors core/file-summary titleFromFilename — kept
 *  local so the node bundle doesn't pull in backend-only modules). */
function filenameTitle(ref: string): string {
  const noQuery = ref.split("?")[0] ?? ref;
  const base = noQuery.split("/").pop() ?? noQuery;
  const dot = base.indexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  return stem.replaceAll("_", " ").replaceAll("-", " ");
}

/** Card type from a card ref (nominal or positional naming), or "". */
function typeFromRef(ref: string): string {
  return cardTypeFromName(ref) ?? "";
}

function useNodeResolvedRef(cardRef: string): ResolvedRef {
  // No filesystem access from the rendered component; `bbx view test` is a smoke
  // render, so existence is assumed and the title is filename-derived.
  return { path: cardRef, title: filenameTitle(cardRef), type: typeFromRef(cardRef), exists: true };
}

const NODE_HOST: ViewHost = {
  openCard: () => {},
  useResolvedRef: useNodeResolvedRef,
  renderInline: (cardRef) => (
    <div className="text-sm text-warm-600">[inline card: {filenameTitle(cardRef)}]</div>
  ),
  basePath: "",
  boxSlug: "",
};

/**
 * Everything a view's widgets read from context in the app, supplied for a
 * Node render: the view host, the box slug `Markdown` builds URLs with, and
 * the lightbox its images register with. `boxSlug` defaults to "".
 */
export function NodeViewHostProvider({ boxSlug, children }: { boxSlug?: string; children: ReactNode }) {
  const slug = boxSlug ?? "";
  const host = useMemo(() => ({ ...NODE_HOST, boxSlug: slug }), [slug]);
  return (
    <ViewHostProvider value={host}>
      <BoxSlugProvider boxSlug={slug}>
        <LightboxProvider>{children}</LightboxProvider>
      </BoxSlugProvider>
    </ViewHostProvider>
  );
}
