/**
 * Node entry for the `beebox/view-widgets` bundle (dist/view-widgets).
 *
 * `bbx view check` renders a view to a string in Node, with no browser app around
 * it: no Router, no tRPC, no QueryClient. So the same widget components consume
 * a *node* view host here — `useResolvedRef` derives a title from the ref's
 * filename (no fetch), `renderInline` emits a minimal block, `openCard` is a
 * no-op (there is no surface to navigate). `bbx view check` wraps the rendered
 * view in `NodeViewHostProvider` (see src/cli/commands/view/command.ts), and the view's
 * own `import … from "beebox/view-widgets"` resolves CardLink/CardRef/Markdown
 * here via the package `exports` map.
 *
 * This file lives under the frontend tsconfig (it renders frontend components);
 * build-cli.mjs bundles it to dist/view-widgets/index.js with React external.
 */

import { useMemo, type ReactNode } from "react";
// Relative (not `@shared/…`): this file is also the dist/view-widgets node
// bundle entry, built with `packages: "external"`, which would leave the
// aliased specifier unresolved at runtime. Relative paths bundle inline.
import { cardTypeFromName, titleFromFilename } from "../../../shared/card-name";
import { ViewHostProvider, type ViewHost, type ResolvedRef } from "../lib/view-host";
import { BoxSlugProvider } from "../lib/box-slug";
import { LightboxProvider } from "../components/LightboxProvider";
import { CardLink } from "../components/view-widgets/CardLink";
import { CardRef } from "../components/view-widgets/CardRef";
import { ViewMarkdown } from "../components/view-widgets/ViewMarkdown";
import { Text } from "../components/ui/Text";

export { CardLink, CardRef, ViewMarkdown as Markdown };

/** Filename-derived title; a `?query` suffix on the ref is ignored. */
function filenameTitle(ref: string): string {
  return titleFromFilename(ref.split("?")[0] ?? ref);
}

/** Card type from a card ref (nominal or positional naming), or "". */
function typeFromRef(ref: string): string {
  return cardTypeFromName(ref) ?? "";
}

function useNodeResolvedRef(cardRef: string): ResolvedRef {
  // No filesystem access from the rendered component; `bbx view check` is a smoke
  // render, so existence is assumed and the title is filename-derived.
  return { path: cardRef, title: filenameTitle(cardRef), type: typeFromRef(cardRef), exists: true };
}

const NODE_HOST: ViewHost = {
  openCard: () => {},
  useResolvedRef: useNodeResolvedRef,
  renderInline: (cardRef) => (
    <Text as="div" tone="subtle" size="sm">[inline card: {filenameTitle(cardRef)}]</Text>
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
