// Box → site importer (run via tsx: `pnpm --dir site import-box --box <path>`).
//
// The first slice of the "box authors the site" direction (plan public-site.md,
// "Direction shift (2026-08-19)"): a box defines `site-page` and `site-aside`
// card types, an agent authors pages there as ordinary card work, and this crude
// importer copies them into site/content/ so the existing static press builds
// them unchanged. Deliberately crude — an aside kept as its own card is INLINED
// into the page as a plain `{% aside kind label %}` block, so the generator needs
// no new tag and knows nothing about boxes.
//
// Fail-closed, same register as the build: a ref to a missing aside, an empty
// aside that isn't an open author elicitation, or malformed frontmatter stops
// the import with one line naming the file. Success prints one summary line.

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import { parseFrontmatter } from "./render.js";

const SITE_DIR = import.meta.dirname;
const CONTENT_DIR = path.join(SITE_DIR, "content");

const PAGE_SUFFIX = ".site-page.card";
const ASIDE_SUFFIX = ".site-aside.card";

const USAGE = "usage: pnpm --dir site import-box --box <path-to-box-content-root>";

class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

// Card frontmatter as this importer requires it. Strict, so a field the box
// grew but the site doesn't understand is a loud error rather than silent loss.
// `contains` is the one global card field allowed through (every card type gets
// it, and agents populate it as the retrieval summary) — it is not published.
const pageFieldsSchema = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  unlisted: z.boolean().optional(),
  contains: z.string().optional(),
});

const asideFieldsSchema = z.strictObject({
  kind: z.enum(["bee", "author", "generated"]),
  label: z.string().min(1),
  status: z.enum(["pending", "ready"]),
  "generated-from": z.string().optional(),
  contains: z.string().optional(),
});

interface Card<T> {
  /** Filename basename with the `.<type>.card` suffix removed — the slug/ref. */
  slug: string;
  /** Path used in error messages (relative to the box root). */
  file: string;
  fields: T;
  body: string;
}

interface CliArgs {
  box: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let box: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--box") {
      const value = argv[++i];
      if (value === undefined) throw new ImportError(`--box requires a value\n${USAGE}`);
      box = value;
    } else if (arg.startsWith("--box=")) {
      box = arg.slice("--box=".length);
    } else {
      throw new ImportError(`unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (box === undefined) throw new ImportError(`--box is required (no default box is guessed)\n${USAGE}`);
  return { box };
}

/** Every `*.card` file under `dir`, skipping dot-directories and node_modules. */
async function listCardFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listCardFiles(abs)));
    else if (entry.name.endsWith(".card")) out.push(abs);
  }
  return out;
}

async function readCard<T>(params: { abs: string; boxRoot: string; suffix: string; schema: z.ZodType<T> }): Promise<Card<T>> {
  const { abs, boxRoot, suffix, schema } = params;
  const file = path.relative(boxRoot, abs);
  const src = await fs.readFile(abs, "utf8");
  const { frontmatter, body } = parseFrontmatter(src, { file, schema });
  return { slug: path.basename(abs).slice(0, -suffix.length), file, fields: frontmatter, body };
}

type AsideCard = Card<z.infer<typeof asideFieldsSchema>>;

// The one body a pending author aside is allowed to publish. The card's own
// body is IGNORED for pending author asides — an agent writing prose into a
// pending elicitation cannot ship it; only status: ready (flipped by the
// boxholder, per the schema's instructions) imports the card body.
export const PENDING_AUTHOR_PLACEHOLDER =
  "> **[PLACEHOLDER — the author's words go here.]** This panel renders only\n" +
  "> the boxholder's own writing. Until that exists, it stays visibly empty —\n" +
  "> nothing here will be ghostwritten.";

// No quotes (attribute delimiter), no braces/%, no newlines: the label is
// interpolated into a Markdoc tag and must not be able to alter it.
const SAFE_LABEL_RE = /^[^\n\r"%{}]+$/;

/** The inlined form of one aside card: the tag the generator already renders. */
export function asideBlock(aside: AsideCard): string {
  if (!SAFE_LABEL_RE.test(aside.fields.label)) {
    throw new ImportError(`${aside.file}: aside label may not contain quotes, braces, "%", or newlines (it is interpolated into a {% aside %} tag)`);
  }
  const isPendingAuthor = aside.fields.kind === "author" && aside.fields.status === "pending";
  const body = isPendingAuthor ? PENDING_AUTHOR_PLACEHOLDER : aside.body.trim();
  if (body === "") {
    throw new ImportError(`${aside.file}: a ${aside.fields.status} ${aside.fields.kind} aside has an empty body (only a pending author aside may be empty)`);
  }
  if (/{%\s*\/?aside/.test(body)) {
    throw new ImportError(`${aside.file}: aside body contains an {% aside %} tag — asides cannot nest or be forwarded, and the sequence would break the inlined wrapper`);
  }
  return [
    `{% aside kind="${aside.fields.kind}" label="${aside.fields.label}" %}`,
    body,
    "{% /aside %}",
  ].join("\n");
}

const ASIDE_REF_RE = /{%\s*aside\s+ref="([^"]*)"\s*\/%}/g;
// Any aside tag still carrying a ref attribute after inlining — a form the
// strict regex above didn't recognize (spaces around =, single quotes, extra
// attrs). Left alone it would dodge the missing-aside fail-closed path.
const LOOSE_ASIDE_REF_RE = /{%\s*aside[^%}]*\bref\s*=/;

/** Replace every `{% aside ref="slug" /%}` with the referenced aside, inlined. */
export function inlineAsideRefs(params: { body: string; file: string; asides: ReadonlyMap<string, AsideCard> }): { body: string; used: number } {
  let used = 0;
  const body = params.body.replace(ASIDE_REF_RE, (_match, slug: string) => {
    const aside = params.asides.get(slug);
    if (!aside) {
      throw new ImportError(`${params.file}: aside ref "${slug}" has no ${slug}${ASIDE_SUFFIX} card in the box`);
    }
    used++;
    return asideBlock(aside);
  });
  if (LOOSE_ASIDE_REF_RE.test(body)) {
    throw new ImportError(`${params.file}: an {% aside … ref=… %} tag in an unrecognized form survived inlining — write it exactly as {% aside ref="slug" /%}`);
  }
  return { body, used };
}

function pageMarkdown(page: Card<z.infer<typeof pageFieldsSchema>>, body: string): string {
  const fields: Record<string, unknown> = { title: page.fields.title, summary: page.fields.summary };
  if (page.fields.unlisted !== undefined) fields["unlisted"] = page.fields.unlisted;
  // imported-from marks the file as importer-owned: the ownership check below
  // refuses to overwrite any content file without it (a hand-authored page).
  fields["imported-from"] = page.file;
  // lineWidth 0: never fold a long summary across lines — the emitted file is
  // hand-readable and diffs against its previous form line for line.
  return `---\n${YAML.stringify(fields, { lineWidth: 0 })}---\n\n${body.trimStart().trimEnd()}\n`;
}

/** Refuse to clobber a hand-authored content file: only importer-owned (or absent) targets are writable. */
async function assertTargetOwned(target: string, file: string): Promise<void> {
  let existing: string;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (_e) {
    return; // absent → free to create
  }
  if (!/^imported-from:/m.test(existing)) {
    throw new ImportError(
      `${file}: refusing to overwrite ${path.relative(SITE_DIR, target)} — it exists and is not importer-owned (no imported-from frontmatter)`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const boxRoot = path.resolve(args.box);
  const cardFiles = await listCardFiles(boxRoot);

  const asides = new Map<string, AsideCard>();
  for (const abs of cardFiles.filter((f) => f.endsWith(ASIDE_SUFFIX))) {
    const card = await readCard({ abs, boxRoot, suffix: ASIDE_SUFFIX, schema: asideFieldsSchema });
    const existing = asides.get(card.slug);
    if (existing) throw new ImportError(`${card.file}: duplicate aside slug "${card.slug}" (also ${existing.file})`);
    asides.set(card.slug, card);
  }

  const pageFiles = cardFiles.filter((f) => f.endsWith(PAGE_SUFFIX));
  if (pageFiles.length === 0) throw new ImportError(`no *${PAGE_SUFFIX} cards found under ${boxRoot}`);

  // Two phases: resolve and check EVERYTHING, then write. A failure in any
  // card leaves content/ untouched rather than partially updated.
  const writes: { target: string; content: string }[] = [];
  const seenSlugs = new Map<string, string>();
  let inlined = 0;
  for (const abs of pageFiles) {
    const page = await readCard({ abs, boxRoot, suffix: PAGE_SUFFIX, schema: pageFieldsSchema });
    const dup = seenSlugs.get(page.slug);
    if (dup) throw new ImportError(`${page.file}: duplicate page slug "${page.slug}" (also ${dup})`);
    seenSlugs.set(page.slug, page.file);
    const resolved = inlineAsideRefs({ body: page.body, file: page.file, asides });
    inlined += resolved.used;
    const target = path.join(CONTENT_DIR, `${page.slug}.md`);
    await assertTargetOwned(target, page.file);
    writes.push({ target, content: pageMarkdown(page, resolved.body) });
  }

  await fs.mkdir(CONTENT_DIR, { recursive: true });
  for (const write of writes) {
    await fs.writeFile(write.target, write.content, "utf8");
  }

  process.stdout.write(
    `site: imported ${pageFiles.length} page(s) from ${boxRoot}, inlining ${inlined} aside(s) → content/\n`,
  );
}

// Run only when invoked as the CLI — the test file imports this module for
// its pure functions and must not trigger an import run.
if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`site import-box failed: ${message}\n`);
    process.exitCode = 1;
  });
}
