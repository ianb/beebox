#!/usr/bin/env tsx

/**
 * Split captured-page commentary and converge saved-page records onto the
 * `.webpage.card` type.
 *
 * Two conversions:
 *
 * 1. Fused capture commentary — a `*.commentary.card` with
 *    `defaultRef: attach/readable.md` and a `source:` URL (the old
 *    clerk-webpage-capture shape: readable markdown + frozen snapshot in
 *    `.attach/`, remarks in the body). Becomes:
 *      <base>.webpage.card                    (readable body + provenance)
 *      <base>.attach/page.frozen              (unchanged, if present)
 *      <base>.attach/<base>.commentary.card   (remarks; anchors made ref-free)
 *    and the old top-level commentary card + attach/readable.md are removed.
 *
 * 2. Saved-page record — a `*.record.card` under a `pages-saved`/`pages-todo`
 *    directory with an http(s) source (what clerk save-page used to write).
 *    Becomes <base>.webpage.card; a sibling <base>.frozen moves to
 *    <base>.attach/page.frozen.
 *
 * Commentary cards without a `source:` (hand-made repros, external-file
 * commentary) are left untouched — they still render through the legacy
 * CommentaryView path.
 *
 * Idempotent. Usage:
 *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/webpage-card.ts <boxRoot> --apply
 */

import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runMigration, type ConvertOutcome } from "./_harness.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** Split a card's frontmatter (parsed YAML) from its markdown body. */
function splitCard(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return { fm: {}, body: raw };
  const parsed: unknown = parseYaml(m[1] ?? "");
  return { fm: isRecord(parsed) ? parsed : {}, body: m[2] ?? "" };
}

/** `Foo.commentary.card` → `Foo` (strip the `.<type>.card` suffix). */
function cardBasename(fileName: string): string {
  if (!fileName.endsWith(".card")) return fileName;
  const noCard = fileName.slice(0, -".card".length);
  const lastDot = noCard.lastIndexOf(".");
  return lastDot === -1 ? noCard : noCard.slice(0, lastDot);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch (_e) {
    return false;
  }
}

/** Serialize frontmatter fields, dropping undefined and empty-string values. */
function buildCard(fields: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v === "") continue;
    clean[k] = v;
  }
  const fm = Object.keys(clean).length === 0 ? "" : stringifyYaml(clean);
  const tail = body === "" ? "" : `${body}${body.endsWith("\n") ? "" : "\n"}`;
  return `---\n${fm}---\n${tail}`;
}

/** First http(s) `ref` in a record's `sources` array, or null. */
function firstHttpRef(sources: unknown): string | null {
  if (!Array.isArray(sources)) return null;
  for (const s of sources) {
    const ref = isRecord(s) ? s["ref"] : undefined;
    if (typeof ref === "string" && /^https?:\/\//.test(ref)) return ref;
  }
  return null;
}

/**
 * The earliest capture template put provenance in the body as a line like
 * `[Original page](https://…) · captured 2026-…`, not in frontmatter. Pull the
 * source URL + captured date out and strip that line, so those cards migrate
 * too. Returns null when there's no such line.
 */
function bodyProvenance(body: string): { source: string; captured: string | undefined; remarks: string } | null {
  const link = body.match(/\[[^\]]*]\((https?:\/\/[^\s)]+)\)/);
  if (link === null) return null;
  const captured = body.match(/captured\s+(\S+)/);
  const remarks = body.replace(/^[^\n]*\[[^\]]*]\(https?:\/\/[^\s)]+\)[^\n]*\n+/, "");
  return { source: link[1] ?? "", captured: captured === null ? undefined : captured[1], remarks };
}

async function convertCommentary(absPath: string): Promise<ConvertOutcome> {
  const raw = await readFile(absPath, "utf8");
  const { fm, body } = splitCard(raw);
  // Only the fused web-page capture shape converts: a readable-backed default
  // ref. External-file commentary keeps working through the legacy path.
  if (fm["defaultRef"] !== "attach/readable.md") return "already";

  // Source/captured come from frontmatter (later shape) or, failing that, the
  // body provenance line (earliest shape). Remarks have that line stripped.
  let source = typeof fm["source"] === "string" ? fm["source"] : "";
  let captured = typeof fm["captured"] === "string" ? fm["captured"] : undefined;
  let remarks = body;
  if (source === "") {
    const prov = bodyProvenance(body);
    if (prov !== null && prov.source !== "") {
      source = prov.source;
      captured = prov.captured;
      remarks = prov.remarks;
    }
  }
  if (source === "") return "already"; // no URL anywhere — can't form a webpage card

  const dir = dirname(absPath);
  const base = cardBasename(basename(absPath));
  const attachDir = join(dir, `${base}.attach`);
  const readablePath = join(attachDir, "readable.md");
  if (!(await exists(readablePath))) return "already";
  const readable = await readFile(readablePath, "utf8");
  const frozenExists = await exists(join(attachDir, "page.frozen"));

  // The captured page becomes the webpage card: readable body + provenance.
  const webpage = buildCard(
    {
      title: fm["title"],
      source,
      captured,
      frozen: frozenExists ? { ref: "attach/page.frozen" } : undefined,
    },
    readable,
  );
  await writeFile(join(dir, `${base}.webpage.card`), webpage);

  // The remarks become an attach-scoped commentary. Anchors that pointed at
  // the readable doc now default to the containing page — strip the ref.
  const commentaryRemarks = remarks.replace(/\s*ref="attach\/readable\.md"/g, "");
  await writeFile(join(attachDir, `${base}.commentary.card`), buildCard({ title: fm["title"] }, commentaryRemarks));

  await rm(absPath);
  await rm(readablePath);
  return "converted";
}

async function convertRecord(absPath: string): Promise<ConvertOutcome> {
  // Only saved-page records (what clerk save-page wrote) convert; other
  // records are generic and stay records.
  if (!/\/(pages-saved|pages-todo)\//.test(absPath)) return "already";
  const raw = await readFile(absPath, "utf8");
  const { fm, body } = splitCard(raw);
  const url = firstHttpRef(fm["sources"]);
  if (url === null) return "already";

  const dir = dirname(absPath);
  const base = cardBasename(basename(absPath));
  const frozenSibling = join(dir, `${base}.frozen`);
  const frozenExists = await exists(frozenSibling);
  const name = typeof fm["name"] === "string" ? fm["name"] : base;

  const webpage = buildCard(
    {
      title: name,
      source: url,
      excerpt: fm["description"],
      frozen: frozenExists ? { ref: "attach/page.frozen" } : undefined,
    },
    body,
  );
  await writeFile(join(dir, `${base}.webpage.card`), webpage);
  if (frozenExists) {
    const attachDir = join(dir, `${base}.attach`);
    await mkdir(attachDir, { recursive: true });
    await rename(frozenSibling, join(attachDir, "page.frozen"));
  }
  await rm(absPath);
  return "converted";
}

/** Dispatch one card file to the right conversion. Exported for tests. */
export function convertFile(absPath: string): Promise<ConvertOutcome> {
  return absPath.endsWith(".commentary.card") ? convertCommentary(absPath) : convertRecord(absPath);
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigration({
    description: "Split capture commentary + converge saved-page records onto .webpage.card.",
    match: (name) => name.endsWith(".commentary.card") || name.endsWith(".record.card"),
    convert: (absPath) => convertFile(absPath),
  });
}
