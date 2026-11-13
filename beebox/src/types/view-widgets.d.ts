/**
 * Ambient types for the public `beebox/view-widgets` specifier as seen
 * from backend code (`bbx view check` dynamic-imports it). The real implementation
 * is the esbuild bundle at dist/view-widgets/index.js (built from
 * src/frontend/src/components/view-widgets/node-entry.tsx). External boxes
 * get this same surface in module form via src/exports/view-widgets.d.ts
 * (shipped as the bundle's sibling index.d.ts) — keep the two in sync.
 */
declare module "beebox/view-widgets" {
  import type { ComponentType, ReactNode } from "react";
  import type { Schema } from "@markdoc/markdoc";

  /**
   * The props a view's default export receives, and the card/file shapes in
   * them. Import-type queries, not re-exports: an ambient module may not
   * import or re-export through a relative specifier (TS2439, which
   * skipLibCheck would hide and turn these into `any`), so the lint rule's
   * preferred `import type` form is unavailable here.
   */
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- TS2439: an ambient module cannot use a relative import declaration; `import()` is the one legal form
  export type ViewProps = import("../core/views/types.js").ViewProps;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- TS2439, as above
  export type ViewCard = import("../core/views/types.js").ViewCard;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- TS2439, as above
  export type ViewFile = import("../core/views/types.js").ViewFile;

  export const CardLink: ComponentType<{ cardRef: string; view?: string; params?: Record<string, string>; children?: ReactNode }>;
  /**
   * A reference chip with Open and Expand. `embed` renders the card frameless and inline instead
   * (a live figure), with `caption` shown beneath; keep `cardRef` a literal attribute so `bbx mv` tracks it.
   */
  export const CardRef: ComponentType<{ cardRef: string; view?: string; params?: Record<string, string>; children?: ReactNode; embed?: boolean; caption?: string }>;
  /**
   * The app's Markdown renderer for card text: `<Markdown card={card}>{card.body}</Markdown>`.
   * An image-syntax embed of a card, `![Caption](/_content/figures/Atom.figure.card?element=H)`,
   * renders that card inline (a live figure) with the alt text as its caption; images and
   * external URLs stay images.
   */
  export const Markdown: ComponentType<{
    children: string;
    card: { path: string; bodyLineOffset: number };
    /** The type's scoped tags (`CardSchemaConfig.markdocTags`). */
    tags?: Readonly<Record<string, Schema>>;
    /** Components by the name a scoped tag's transform emits. */
    components?: Partial<Record<string, ComponentType<Record<string, unknown>>>>;
  }>;
  /** Supplies the node view host (and the box slug) so widgets resolve their context in `bbx view check`. */
  export const NodeViewHostProvider: ComponentType<{ boxSlug?: string; children: ReactNode }>;
}
