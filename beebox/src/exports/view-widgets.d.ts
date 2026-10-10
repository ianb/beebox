/**
 * Public type surface of `beebox/view-widgets`, in module form.
 * build-cli copies this to dist/view-widgets/index.d.ts (sibling of the
 * bundle) and the exports map names it via a `types` condition, so a box's
 * own `pnpm exec tsc` can typecheck `import { CardLink } from
 * "beebox/view-widgets"` — the engine-internal twin of this surface is
 * the ambient declaration in src/types/view-widgets.d.ts (backend code sees
 * that one; keep the two in sync).
 */
import type { ComponentType, ReactNode } from "react";

/**
 * The props a view's default export receives, and the card/file shapes in
 * them. Re-exported from the shipped source so a plugin view typed against
 * them matches what the host passes. The path is two directories up in both
 * places this file lives (src/exports/ here, dist/view-widgets/ in a release),
 * so it resolves for a box's `tsc` as well as in-repo.
 */
export type { ViewProps, ViewCard, ViewFile } from "../../src/core/views/types.js";

export const CardLink: ComponentType<{
  cardRef: string;
  view?: string;
  params?: Record<string, string>;
  children?: ReactNode;
}>;
export const CardRef: ComponentType<{
  cardRef: string;
  view?: string;
  params?: Record<string, string>;
  children?: ReactNode;
}>;
/**
 * The app's Markdown renderer for card text: `<Markdown card={card}>{card.body}</Markdown>`.
 * `card` (a view's `ViewCard` has both fields) resolves relative refs and gives
 * todos their card path and file lines. The view check rejects other ways of
 * rendering card text.
 */
export const Markdown: ComponentType<{ children: string; card: { path: string; bodyLineOffset: number } }>;
/** Supplies the node view host (and the box slug) so widgets resolve their context in `bbx view test`. */
export const NodeViewHostProvider: ComponentType<{ boxSlug?: string; children: ReactNode }>;
