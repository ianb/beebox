/**
 * A card type's scoped Markdoc tags and the components that render them in
 * `CardBody`, keyed by card type. The tags match the type's
 * `CardSchemaConfig.markdocTags`; a type with none is absent. Every map here
 * is a module constant: a component map made per render remounts the body
 * (`docs/implemented-plans/stable-card-body.md`).
 */

import type { ComponentType } from "react";
import type { Schema } from "@markdoc/markdoc";
import { compositionTags } from "@shared/composition/tags";
import { CARD_EMBED_COMPONENTS } from "../FigureEmbed";
import { lazyOverlay } from "../../lib/lazy-component";
import { CompositionBlock, EditorialBlock, EditorialInline, type ComposeEditorProps } from "./Composition";
import type { MarkdownComponentOverrides } from "../Markdown/body";

export interface CardTypeMarkdown {
  tags: Readonly<Record<string, Schema>>;
  /** Includes `CARD_EMBED_COMPONENTS`. */
  components: MarkdownComponentOverrides;
  /** Replaces a composition block in compose mode (`Composition.tsx`). */
  composeEditor: ComponentType<ComposeEditorProps> | null;
}

// eslint-disable-next-line no-restricted-syntax -- widen a specifically-typed component to the shared override-map type; Markdoc only calls it with the props declared for its tag in `compositionTags`
const cast = <T,>(c: T) => c as unknown as ComponentType<Record<string, unknown>>;

// Lazy: CodeMirror loads only when someone presses Compose. It renders into
// the block's host, so it shows nothing of its own in `CardBody` while loading.
const ComposeEditor = lazyOverlay(() => import("./compose/ComposeEditor"), (m) => m.ComposeEditor);

const CARD_TYPE_MARKDOWN: Readonly<Record<string, CardTypeMarkdown>> = {
  doc: {
    tags: compositionTags,
    components: {
      ...CARD_EMBED_COMPONENTS,
      CompositionBlock: cast(CompositionBlock),
      EditorialInline: cast(EditorialInline),
      EditorialBlock: cast(EditorialBlock),
    },
    composeEditor: ComposeEditor,
  },
};

export function cardTypeMarkdown(type: string | undefined): CardTypeMarkdown | undefined {
  return type === undefined ? undefined : CARD_TYPE_MARKDOWN[type];
}
