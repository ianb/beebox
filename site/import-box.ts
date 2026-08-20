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

/** The inlined form of one aside card: the tag the generator already renders. */
function asideBlock(aside: AsideCard): string {
  if (aside.fields.label.includes("\"")) {
    throw new ImportError(`${aside.file}: aside label contains a double quote, which the inlined {% aside %} attribute cannot carry`);
  }
  const body = aside.body.trim();
  if (body === "" && aside.fields.kind !== "author") {
    throw new ImportError(`${aside.file}: a ${aside.fields.kind} aside has an empty body (only a pending author aside may be empty)`);
  }
  return [
    `{% aside kind="${aside.fields.kind}" label="${aside.fields.label}" %}`,
    body,
    "{% /aside %}",
  ].join("\n");
}

const ASIDE_REF_RE = /{%\s*aside\s+ref="([^"]*)"\s*\/%}/g;

/** Replace every `{% aside ref="slug" /%}` with the referenced aside, inlined. */
function inlineAsideRefs(params: { body: string; file: string; asides: ReadonlyMap<string, AsideCard> }): { body: string; used: number } {
  let used = 0;
  const body = params.body.replace(ASIDE_REF_RE, (_match, slug: string) => {
    const aside = params.asides.get(slug);
    if (!aside) {
      throw new ImportError(`${params.file}: aside ref "${slug}" has no ${slug}${ASIDE_SUFFIX} card in the box`);
    }
    used++;
    return asideBlock(aside);
  });
  return { body, used };
}

function pageMarkdown(page: Card<z.infer<typeof pageFieldsSchema>>, body: string): string {
  const fields: Record<string, unknown> = { title: page.fields.title, summary: page.fields.summary };
  if (page.fields.unlisted !== undefined) fields["unlisted"] = page.fields.unlisted;
  // lineWidth 0: never fold a long summary across lines — the emitted file is
  // hand-readable and diffs against its previous form line for line.
  return `---\n${YAML.stringify(fields, { lineWidth: 0 })}---\n\n${body.trimStart().trimEnd()}\n`;
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

  let inlined = 0;
  for (const abs of pageFiles) {
    const page = await readCard({ abs, boxRoot, suffix: PAGE_SUFFIX, schema: pageFieldsSchema });
    const resolved = inlineAsideRefs({ body: page.body, file: page.file, asides });
    inlined += resolved.used;
    await fs.mkdir(CONTENT_DIR, { recursive: true });
    await fs.writeFile(path.join(CONTENT_DIR, `${page.slug}.md`), pageMarkdown(page, resolved.body), "utf8");
  }

  process.stdout.write(
    `site: imported ${pageFiles.length} page(s) from ${boxRoot}, inlining ${inlined} aside(s) → content/\n`,
  );
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`site import-box failed: ${message}\n`);
  process.exitCode = 1;
});
