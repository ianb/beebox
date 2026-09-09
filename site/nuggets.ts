// Nuggets: committed excerpts of repo content (site/nuggets/<slug>.md) that the
// site may publish. Frontmatter is `source` (repo-relative, allowlisted), `span`
// (a VERBATIM excerpt of that source — the one locator format), and `status`.
//
// Two enforcement rules live here, in code rather than convention:
//
//  1. `status: proposed` is agent-drafted text the boxholder has not
//     reinterpreted. It NEVER renders — renderNugget refuses it, and the build
//     lists the refused slugs. Only `reinterpreted` (his rewrite) and `excerpt`
//     (the source's own words) publish.
//  2. The span is re-located in its source at every build. Exactly one verbatim
//     match → current; zero or more than one → the nugget renders with a visible
//     stale marker. A missing source, or one outside the allowlist, FAILS the
//     build naming the nugget and the path (fail-closed — no publishing a
//     citation we cannot check).
//
// Span matching here is strictly verbatim, deliberately unlike the extraction
// pipeline's whitespace-tolerant recovery (story/span-locate.ts): ingest is
// repairing an agent's copy of the text, while this is a drift signal — any
// edit to the source, whitespace included, should show as stale.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { escapeHtml, parseFrontmatter, renderBody } from "./render.js";
import { countOccurrences } from "./story/span-locate.js";

/** Repo roots a nugget may cite. Closed set — everything else fails the build. */
const ALLOWED_SOURCE_PREFIXES = [
  "issues/",
  "callback-box/docs/",
  "research/",
  "beebox/docs/",
  "beebox/user-stories/",
] as const;
const ALLOWED_SOURCE_FILES: ReadonlySet<string> = new Set(["README.md"]);

const ALLOWLIST_TEXT = [...ALLOWED_SOURCE_PREFIXES, ...ALLOWED_SOURCE_FILES].join(", ");

/** A hard, fail-closed nugget failure: bad frontmatter, bad path, missing source. */
export class NuggetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NuggetError";
  }
}

// Body rules: `proposed` and `reinterpreted` carry publishable prose in the
// body. For `excerpt` the span IS the content (the source's own words), so an
// empty or absent body is legal there and only there — the plan leaves this
// silent, and requiring a body would force restating the span.
export const nuggetStatuses = ["proposed", "reinterpreted", "excerpt"] as const;
export type NuggetStatus = (typeof nuggetStatuses)[number];

export const nuggetFrontmatterSchema = z.strictObject({
  source: z.string().min(1),
  span: z.string().min(1),
  status: z.enum(nuggetStatuses),
});

/** Span re-location verdict: unique match, or drift (zero / more than one). */
export type NuggetSpanState = "current" | "missing" | "ambiguous";

export interface Nugget {
  /** Slug = the nugget filename without its .md extension. */
  slug: string;
  /** site/-relative posix path, used in error messages. */
  file: string;
  source: string;
  span: string;
  status: NuggetStatus;
  /** Publishable text; empty only for `excerpt`, where the span is the content. */
  body: string;
  spanState: NuggetSpanState;
}

function isAllowedSource(source: string): boolean {
  if (source.startsWith("/") || source.includes("..") || source.includes("\\")) return false;
  if (ALLOWED_SOURCE_FILES.has(source)) return true;
  return ALLOWED_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
}

async function readNuggetFileNames(nuggetsDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(nuggetsDir, { withFileTypes: true });
  } catch (_err) {
    return []; // no nuggets/ directory → a site with no nuggets, which is legal
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b));
}

function spanState(sourceText: string, span: string): NuggetSpanState {
  const found = countOccurrences(sourceText, span);
  if (found === 1) return "current";
  return found === 0 ? "missing" : "ambiguous";
}

/**
 * Read, validate, and span-check every nugget. Throws NuggetError (one line,
 * file+line) on frontmatter errors, a non-allowlisted source, a missing source
 * file, or a body that is required but empty. Span drift is NOT a throw — it
 * comes back as `spanState` and renders as a visible marker.
 */
export async function loadNuggets(params: { nuggetsDir: string; repoRoot: string }): Promise<Nugget[]> {
  const { nuggetsDir, repoRoot } = params;
  const nuggets: Nugget[] = [];
  for (const name of await readNuggetFileNames(nuggetsDir)) {
    const file = `nuggets/${name}`;
    const slug = name.slice(0, -".md".length);
    const raw = await fs.readFile(path.join(nuggetsDir, name), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw, { file, schema: nuggetFrontmatterSchema });

    if (!isAllowedSource(frontmatter.source)) {
      throw new NuggetError(
        `${file}:1 source "${frontmatter.source}" is outside the publishable allowlist (${ALLOWLIST_TEXT})`,
      );
    }
    const trimmedBody = body.trim();
    if (trimmedBody === "" && frontmatter.status !== "excerpt") {
      throw new NuggetError(`${file}:1 status "${frontmatter.status}" requires a body (only excerpt may be empty)`);
    }
    // Fail-closed both ways: an excerpt's content IS its span. A body on an
    // excerpt would publish other words under the source's citation.
    if (trimmedBody !== "" && frontmatter.status === "excerpt") {
      throw new NuggetError(`${file}:1 status "excerpt" must have no body — the span is the content`);
    }

    const sourceText = await fs.readFile(path.join(repoRoot, frontmatter.source), "utf8").catch((e: unknown) => {
      throw new NuggetError(
        `${file}:1 source file cannot be read: ${frontmatter.source} ` +
          `(${e instanceof Error ? e.message.split("\n")[0] : String(e)})`,
      );
    });

    nuggets.push({
      slug,
      file,
      source: frontmatter.source,
      span: frontmatter.span,
      status: frontmatter.status,
      body: trimmedBody,
      spanState: spanState(sourceText, frontmatter.span),
    });
  }
  return nuggets;
}

/**
 * The repo-relative source paths the nugget files cite, deduped and sorted —
 * fed into the generator's input manifest so an edit to a cited source triggers
 * a router rebuild (without it a span could drift with no stale marker ever
 * appearing). Lenient on purpose: a nugget that fails to parse or cites a
 * disallowed path is skipped HERE and fails loudly in loadNuggets; this
 * function only widens the rebuild trigger set, so it must never throw.
 */
export async function listNuggetSourceRefs(nuggetsDir: string): Promise<string[]> {
  const sources = new Set<string>();
  for (const name of await readNuggetFileNames(nuggetsDir)) {
    try {
      const raw = await fs.readFile(path.join(nuggetsDir, name), "utf8");
      const { frontmatter } = parseFrontmatter(raw, {
        file: `nuggets/${name}`,
        schema: nuggetFrontmatterSchema,
      });
      if (isAllowedSource(frontmatter.source)) sources.add(frontmatter.source);
    } catch (_err) {
      continue; // unparseable → loadNuggets reports it; nothing to add here
    }
  }
  return [...sources].toSorted((a, b) => a.localeCompare(b));
}

/** True for nuggets the site is allowed to publish (everything but `proposed`). */
export function isRenderable(nugget: Nugget): boolean {
  return nugget.status !== "proposed";
}

const STALE_TEXT: Record<Exclude<NuggetSpanState, "current">, string> = {
  missing: "stale: this excerpt is no longer in the source",
  ambiguous: "stale: this excerpt now appears more than once in the source",
};

/**
 * Render one nugget to HTML: its publishable text (or, for an `excerpt`, the
 * span itself), provenance, and a visible stale marker when the span no longer
 * matches its source exactly once. Refuses `proposed` — the AI-words rule is
 * enforced here rather than trusted to callers.
 */
const NUGGET_PLACEHOLDER_RE = /<x-nugget slug="([^"]*)"><\/x-nugget>/g;

/**
 * Substitute the `{% nugget slug="…" /%}` placeholders a page rendered
 * (`<x-nugget slug="…">`, emitted by the fisheye `nugget` tag) with the real
 * rendered nuggets. An unknown slug fails the build naming the page — same
 * fail-closed row as a missing source.
 */
export function embedNuggets(
  html: string,
  params: { nuggets: readonly Nugget[]; base: string; pageSitePath: string },
): string {
  return html.replace(NUGGET_PLACEHOLDER_RE, (_match, slug: string) => {
    const nugget = params.nuggets.find((n) => n.slug === slug);
    if (!nugget) {
      throw new NuggetError(`${params.pageSitePath} embeds unknown nugget slug "${slug}" (no nuggets/${slug}.md)`);
    }
    return renderNugget(nugget, { base: params.base, pageSitePath: params.pageSitePath });
  });
}

export function renderNugget(nugget: Nugget, params: { base: string; pageSitePath: string }): string {
  if (!isRenderable(nugget)) {
    throw new NuggetError(`nugget "${nugget.slug}" has status "proposed" and must not be rendered`);
  }
  const text = nugget.body === "" ? nugget.span : nugget.body;
  const { html } = renderBody(text, { file: nugget.file, pageSitePath: params.pageSitePath, base: params.base });
  // A nugget body embedding another nugget would ship an inert <x-nugget>
  // that bypassed the unknown-slug check. Refuse until nesting is a designed
  // feature rather than an accident.
  if (html.includes("<x-nugget")) {
    throw new NuggetError(`nugget "${nugget.slug}" embeds another nugget in its body — nuggets cannot nest`);
  }
  const stale =
    nugget.spanState === "current"
      ? ""
      : `\n<p class="nugget-stale">${escapeHtml(STALE_TEXT[nugget.spanState])}</p>`;
  return [
    `<figure class="nugget" id="nugget-${escapeHtml(nugget.slug)}" data-status="${nugget.status}">`,
    html.trim(),
    `<figcaption>from <code>${escapeHtml(nugget.source)}</code></figcaption>${stale}`,
    "</figure>",
  ].join("\n");
}
