// Asides as cards: `site/cards/<slug>.site-aside.card` is one categorized aside
// — a voice (bee / author / generated) with visible provenance — that any page
// embeds with `{% aside ref="slug" /%}`. The fisheye tag renders that ref as an
// `<x-aside slug="…">` placeholder; embedAsides() below substitutes the real
// aside, following the same pattern as nuggets so the two behave alike.
//
// The enforcement that used to live in the box importer lives here now:
//
//  1. A `pending` `author` aside publishes the standard placeholder and NEVER
//     its own body. An open elicitation for the boxholder's words is exactly
//     where agent prose is most tempting and least allowed; only the boxholder
//     flipping `status: ready` publishes the card's text.
//  2. Any other aside with an empty body FAILS the build — an aside that says
//     nothing is a mistake, not a design.
//  3. An unknown ref, or an aside body that itself refs another aside, fails
//     the build naming the page and the slug.

import fs from "node:fs/promises";
import { z } from "zod";
import { asideTag, isAsideKind } from "./fisheye.js";
import type { CardFile } from "./cards.js";
import { bodyChildren, parseFrontmatter, renderNode, transformBody } from "./render.js";

/** A hard, fail-closed aside failure: bad frontmatter, empty body, bad ref. */
export class AsideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsideError";
  }
}

// `contains` is the one box-global field allowed through (every card type has
// it, as the agent-written retrieval summary) — it is never published.
export const asideFieldsSchema = z.strictObject({
  kind: z.enum(["bee", "author", "generated"]),
  label: z.string().min(1),
  status: z.enum(["pending", "ready"]),
  "generated-from": z.string().optional(),
  contains: z.string().optional(),
});

export type AsideFields = z.infer<typeof asideFieldsSchema>;

export interface AsideCard {
  slug: string;
  /** site/-relative posix path, used in error messages. */
  file: string;
  fields: AsideFields;
  body: string;
}

/** The one body a pending author aside is allowed to publish. */
export const PENDING_AUTHOR_PLACEHOLDER =
  "> **[PLACEHOLDER — the author's words go here.]** This panel renders only\n" +
  "> the boxholder's own writing. Until that exists, it stays visibly empty —\n" +
  "> nothing here will be ghostwritten.";

/** Read and strictly validate every `site-aside` card, keyed by ref slug. */
export async function loadAsides(files: readonly CardFile[]): Promise<Map<string, AsideCard>> {
  const asides = new Map<string, AsideCard>();
  for (const card of files) {
    const src = await fs.readFile(card.abs, "utf8");
    const { frontmatter, body } = parseFrontmatter(src, { file: card.file, schema: asideFieldsSchema });
    asides.set(card.slug, { slug: card.slug, file: card.file, fields: frontmatter, body: body.trim() });
  }
  return asides;
}

/**
 * The markdown an aside publishes — the standard placeholder for an open author
 * elicitation, the card's own body otherwise. Throws on an empty body, which is
 * legal only in that one pending-author case.
 */
export function asidePublishedBody(aside: AsideCard): string {
  const { kind, status } = aside.fields;
  if (kind === "author" && status === "pending") return PENDING_AUTHOR_PLACEHOLDER;
  if (aside.body === "") {
    throw new AsideError(
      `${aside.file}: a ${status} ${kind} aside has an empty body (only a pending author aside may be empty)`,
    );
  }
  return aside.body;
}

export interface RenderedAside {
  html: string;
  linkTargets: string[];
}

/**
 * Render one aside card to the HTML of the shared `asideTag` shape — byte-for-
 * byte what an inline `{% aside kind label %}` block produces for the same
 * content, because both build the same tree.
 */
export function renderAside(aside: AsideCard, params: { pageSitePath: string; base: string }): RenderedAside {
  const { kind, label } = aside.fields;
  // The schema's enum and the renderer's kinds are declared separately; this
  // keeps a drift between them a build failure rather than a broken class name.
  if (!isAsideKind(kind)) throw new AsideError(`${aside.file}: unknown aside kind "${kind}"`);
  const { content, linkTargets } = transformBody(asidePublishedBody(aside), {
    file: aside.file,
    pageSitePath: params.pageSitePath,
    base: params.base,
  });
  const html = renderNode(asideTag({ kind, label, children: bodyChildren(content) }));
  if (html.includes("<x-aside")) {
    throw new AsideError(`${aside.file}: aside body references another aside — asides do not nest`);
  }
  return { html, linkTargets };
}

const ASIDE_PLACEHOLDER_RE = /<x-aside slug="([^"]*)"><\/x-aside>/g;

/**
 * Substitute the `<x-aside slug="…">` placeholders a page rendered with the
 * real asides. An unknown slug fails the build naming the page and the slug.
 */
export function embedAsides(
  html: string,
  params: { asides: ReadonlyMap<string, AsideCard>; base: string; pageSitePath: string },
): RenderedAside {
  const linkTargets: string[] = [];
  const out = html.replace(ASIDE_PLACEHOLDER_RE, (_match, slug: string) => {
    const aside = params.asides.get(slug);
    if (!aside) {
      throw new AsideError(
        `${params.pageSitePath} references unknown aside "${slug}" (no cards/${slug}.site-aside.card)`,
      );
    }
    const rendered = renderAside(aside, { pageSitePath: params.pageSitePath, base: params.base });
    linkTargets.push(...rendered.linkTargets);
    return rendered.html;
  });
  return { html: out, linkTargets };
}

/**
 * The flat markdown form of a referenced aside for a page's `.md` twin: label
 * and published body, no disclosure. A pending author aside flattens to the
 * placeholder, same as it renders.
 */
export function flatAside(slug: string, asides: ReadonlyMap<string, AsideCard>): string {
  const aside = asides.get(slug);
  // An unknown slug already failed the build in embedAsides; this guard only
  // keeps the twin pass from ever being the thing that throws.
  if (!aside) return "";
  return `**${aside.fields.label}**\n\n${asidePublishedBody(aside)}`;
}
