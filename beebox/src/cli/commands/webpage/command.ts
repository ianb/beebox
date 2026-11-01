/**
 * `bbx webpage save`: make or update a webpage card from a URL, from the page
 * open in the box browser, or from HTML already on disk
 * (docs/plans/webpage-capture-tools.md).
 *
 * It runs in the agent's shell, so a URL reaches only what `curl` could. Exit
 * codes: 0 saved, 1 failed, 3 refused, 4 a redirect the agent should read first.
 * On anything but exit 0, an existing card is left as it was.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { frontmatterFence, parseFrontmatterObject } from "../../../cards/frontmatter.js";
import { assertAnnexBox } from "../../../core/annex/assert-annex-box.js";
import { runWebpageFunction } from "../../../core/webpage/box-function/core.js";
import { fetchPage, REQUEST_HEADERS_NAME } from "../../../core/webpage/fetch.js";
import { isRefusal, type CapturedResponse, type PageResult } from "../../../core/webpage/response.js";
import { updateWebpageCard, writeWebpageCard } from "../../../core/webpage/write.js";
import { stageAndCommitPaths } from "../../../lib/git/core/operations.js";
import { BOX_DIRS, requireBoxRoot } from "../../../lib/paths/core.js";
import { safeFilename } from "../../../lib/safe-filename.js";
import type { WebpageCaptureFields } from "../../../schemas/webpage.js";
import { attachmentPath } from "../../../shared/attach-path.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { browserResponse, fileResponse, WebpageSaveError } from "./sources.js";

const EXIT_REFUSED = 3;
const EXIT_REDIRECT = 4;
const NAME_ATTEMPTS = 5;
const WEBPAGE_SUFFIX = ".webpage.card";
/** An update that keeps less than this share of a card's text is probably a wrong page. */
const SHRINK_FLOOR = 0.1;
const SHRINK_CHECK_MIN_CHARS = 1000;

interface WebpageOptions {
  browser?: boolean;
  html?: string;
  url?: string;
  from: string[];
  to?: string;
  update?: string;
  meta?: string;
  json?: boolean;
  commit: boolean;
}

/** What `--meta` holds: `retrieved` is the capture time, the rest is kept on the card. */
const META = z.looseObject({ retrieved: z.iso.datetime({ offset: true }).optional() });

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

/** One shell word: a redirect target is the site's text, and the agent may paste this line. */
function shellWord(text: string): string {
  return /^[\w%&+,./:=?@-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

/** `target` relative to the box root, or an error when it leaves the box, by path or through a link. */
async function insideBox({ boxRoot, target, flag }: { boxRoot: string; target: string; flag: string }): Promise<string> {
  const refused = new WebpageSaveError({ detail: `bbx webpage save: ${flag} must be inside the box: ${target}` });
  const absolute = path.resolve(boxRoot, target);
  const relative = path.relative(boxRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw refused;
  const realRoot = await fs.realpath(boxRoot);
  let existing = absolute;
  for (;;) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
      existing = path.dirname(existing);
    }
  }
  if (existing !== realRoot && !existing.startsWith(`${realRoot}${path.sep}`)) throw refused;
  return relative;
}

/** The HTML as saved: a `<base>` so its relative images and styles still resolve. `capture.sha256` keeps the original's hash. */
function savedHtml(html: string, url: string): string {
  const base = `<base href="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head === null) return base + html;
  const end = head.index + head[0].length;
  return html.slice(0, end) + base + html.slice(end);
}

interface SaveInput {
  boxRoot: string;
  response: CapturedResponse;
  page: PageResult;
  usedBoxFunction: boolean;
  meta: Record<string, unknown>;
  capturedAt: string;
  commit: boolean;
}

function captureFields({ response, page, usedBoxFunction, meta }: SaveInput): WebpageCaptureFields {
  const kept = { ...page.meta, ...meta };
  return {
    via: response.via,
    snapshot: "html-only",
    ...(response.redirectedFrom.length === 0 ? {} : { redirectedFrom: response.redirectedFrom }),
    ...(usedBoxFunction ? { function: "box" as const } : {}),
    ...(page.note === null || page.note === undefined ? {} : { note: page.note }),
    ...(response.sha256 === null ? {} : { sha256: response.sha256 }),
    ...(response.via === "http" ? { requestHeaders: REQUEST_HEADERS_NAME } : {}),
    ...(Object.keys(kept).length === 0 ? {} : { meta: kept }),
  };
}

const optional = (value: string | null | undefined): string | undefined => value ?? undefined;

/** Write a new card under a name no other capture holds, and commit it unless told not to. */
async function saveNewCard(input: SaveInput & { dir: string }): Promise<string> {
  const { boxRoot, dir, response, page, capturedAt, commit } = input;
  const stamp = capturedAt.replace(/[.:]/g, "-").slice(0, 19);
  for (let attempt = 1; ; attempt += 1) {
    const cardRel = path.join(dir, `${safeFilename(page.title, "Page")}_${stamp}_${randomBytes(2).toString("hex")}${WEBPAGE_SUFFIX}`);
    let paths: string[];
    try {
      paths = await writeWebpageCard({
        boxRoot, cardRel, title: page.title, url: response.url, capturedAt, markdown: page.markdown,
        siteName: optional(page.siteName), byline: optional(page.byline), excerpt: optional(page.excerpt),
        frozenHtml: savedHtml(response.html, response.url), exclusive: true, capture: captureFields(input),
      });
    } catch (e) {
      if (errnoCode(e) !== "EEXIST" || attempt >= NAME_ATTEMPTS) throw e;
      continue;
    }
    if (commit) {
      try {
        await stageAndCommitPaths(boxRoot, { paths, message: `Save web page: "${page.title}"`, trailers: { "Created-By": "bbx-webpage" } });
      } catch (e) {
        // A failed save leaves nothing for a later sweep to commit.
        for (const rel of paths) await fs.rm(path.join(boxRoot, rel), { force: true });
        throw e;
      }
    }
    return cardRel;
  }
}

interface ExistingCard {
  rel: string;
  fields: Record<string, unknown>;
  body: string;
  /** The address recorded on the card. */
  href: string | undefined;
}

async function readExistingCard({ boxRoot, card }: { boxRoot: string; card: string }): Promise<ExistingCard> {
  const rel = await insideBox({ boxRoot, target: card, flag: "--update" });
  if (!rel.endsWith(WEBPAGE_SUFFIX)) throw new WebpageSaveError({ detail: `bbx webpage save: --update takes a ${WEBPAGE_SUFFIX} file: ${card}` });
  let text: string;
  try {
    text = await fs.readFile(path.join(boxRoot, rel), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") throw new WebpageSaveError({ detail: `bbx webpage save: no such card: ${card}` });
    throw e;
  }
  const fields = parseFrontmatterObject(text);
  const fence = frontmatterFence(text);
  if (fields === null || fence === null) throw new WebpageSaveError({ detail: `bbx webpage save: ${card} has no readable frontmatter` });
  const sources = z.array(z.looseObject({ href: z.string().optional() })).safeParse(fields["sources"]);
  return { rel, fields, body: text.slice(fence.bodyStart), href: sources.success ? sources.data[0]?.href : undefined };
}

function parseMeta(text: string | undefined): { retrieved: string | undefined; meta: Record<string, unknown> } {
  if (text === undefined) return { retrieved: undefined, meta: {} };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new WebpageSaveError({ detail: `bbx webpage save: --meta is not JSON: ${e instanceof Error ? e.message : String(e)}` });
  }
  const parsed = META.safeParse(json);
  if (!parsed.success) throw new WebpageSaveError({ detail: `bbx webpage save: --meta: ${z.prettifyError(parsed.error)}` });
  const { retrieved, ...meta } = parsed.data;
  return { retrieved, meta };
}

function checkFlags(url: string | undefined, options: WebpageOptions): void {
  const sources = [url !== undefined, options.browser === true, options.html !== undefined].filter(Boolean).length;
  if (sources > 1 || (sources === 0 && options.update === undefined)) {
    throw new WebpageSaveError({ detail: "bbx webpage save: give one of: a URL, --browser for the page open in the box browser, or --html <file> --url <address>" });
  }
  if (options.html === undefined && options.url !== undefined) throw new WebpageSaveError({ detail: "bbx webpage save: --url goes with --html" });
  if (options.html !== undefined && options.url === undefined && options.update === undefined) throw new WebpageSaveError({ detail: "bbx webpage save: --html needs --url, unless --update names a card with an address" });
  if (options.update !== undefined && options.to !== undefined) throw new WebpageSaveError({ detail: "bbx webpage save: --to does not go with --update; the card stays where it is" });
}

/** The saved HTML to write on an update, or undefined to leave it: re-reading a card's own copy leaves that copy alone. */
async function updatedHtml({ boxRoot, cardRel, options, response }: { boxRoot: string; cardRel: string; options: WebpageOptions; response: CapturedResponse }): Promise<string | undefined> {
  if (options.html !== undefined && path.resolve(boxRoot, options.html) === path.resolve(boxRoot, attachmentPath(cardRel, "page.frozen"))) return undefined;
  return savedHtml(response.html, response.url);
}

async function updateCard(input: SaveInput & { card: ExistingCard; options: WebpageOptions }): Promise<void> {
  const { boxRoot, card, response, page, capturedAt, commit, options } = input;
  const before = card.body.trim().length;
  if (before >= SHRINK_CHECK_MIN_CHARS && page.markdown.trim().length < before * SHRINK_FLOOR) {
    console.log(`Refused to update ${card.rel}: the new text has ${String(page.markdown.trim().length)} characters where the card has ${String(before)}, so this is probably not the same page. The card is unchanged.`);
    process.exitCode = EXIT_REFUSED;
    return;
  }
  const frozenHtml = await updatedHtml({ boxRoot, cardRel: card.rel, options, response });
  // A card's own copy stays what it was, which may be Clerk's self-contained one.
  const { snapshot: _snapshot, ...withoutSnapshot } = captureFields(input);
  const previous = z.looseObject({ snapshot: z.literal("html-only").optional() }).safeParse(card.fields["capture"]);
  const keepsHtmlOnly = frozenHtml !== undefined || previous.data?.snapshot !== undefined;
  const paths = await updateWebpageCard({
    boxRoot, cardRel: card.rel, current: card.fields, currentBody: card.body, title: page.title, url: response.url, capturedAt, markdown: page.markdown,
    siteName: optional(page.siteName), byline: optional(page.byline), excerpt: optional(page.excerpt), frozenHtml,
    capture: keepsHtmlOnly ? { ...withoutSnapshot, snapshot: "html-only" } : withoutSnapshot,
  });
  if (paths.length === 0) {
    console.log(`Unchanged ${card.rel}`);
    return;
  }
  if (commit) await stageAndCommitPaths(boxRoot, { paths, message: `Update web page: "${page.title}"`, trailers: { "Created-By": "bbx-webpage" } });
  console.log(`Updated ${card.rel}${commit ? "" : " (not committed)"}`);
}

async function getResponse({ url, options, boxRoot, card }: { url: string | undefined; options: WebpageOptions; boxRoot: string; card: ExistingCard | null }): Promise<CapturedResponse | null> {
  if (options.browser === true) return browserResponse();
  if (options.html !== undefined) {
    const address = options.url ?? card?.href;
    if (address === undefined) throw new WebpageSaveError({ detail: "bbx webpage save: the card records no address; give --url" });
    return fileResponse({ file: options.html, url: address, boxRoot });
  }
  const address = url ?? card?.href;
  if (address === undefined) throw new WebpageSaveError({ detail: "bbx webpage save: the card records no address; give a URL" });
  const fetched = await fetchPage({ url: address, from: options.from });
  if (fetched.kind === "failed") throw new WebpageSaveError({ detail: fetched.message });
  if (fetched.kind === "page") return fetched.response;
  const words = ["bbx webpage save", shellWord(fetched.target), ...fetched.chain.flatMap((earlier) => ["--from", shellWord(earlier)])];
  if (card !== null) words.push("--update", shellWord(card.rel));
  console.log(`Redirects to ${fetched.target} (${String(fetched.status)}). Nothing was saved. Read the address; if it is a sign-in page, use the box browser. To follow:`);
  console.log(words.join(" "));
  process.exitCode = EXIT_REDIRECT;
  return null;
}

async function run(url: string | undefined, options: WebpageOptions): Promise<void> {
  checkFlags(url, options);
  const { retrieved, meta } = parseMeta(options.meta);
  const boxRoot = await requireBoxRoot();
  const card = options.update === undefined ? null : await readExistingCard({ boxRoot, card: options.update });
  const dir = await insideBox({ boxRoot, target: options.to ?? BOX_DIRS.inbox, flag: "--to" });
  if (options.json !== true) await assertAnnexBox(boxRoot, "bbx webpage save");
  const response = await getResponse({ url, options, boxRoot, card });
  if (response === null) return;
  const outcome = await runWebpageFunction({ boxRoot, response });
  if (!outcome.ok) throw new WebpageSaveError({ detail: outcome.message });
  const { result } = outcome;
  if (options.json === true) {
    const { html: _html, headers: _headers, ...about } = response;
    console.log(JSON.stringify({ response: about, result, ...(outcome.usedBoxFunction ? { function: "box" } : {}) }));
    if (isRefusal(result)) process.exitCode = EXIT_REFUSED;
    return;
  }
  if (isRefusal(result)) {
    console.log(`Refused ${response.url}: ${result.refuse}. Nothing was saved${card === null ? "" : `, and ${card.rel} is unchanged`}.`);
    if (response.via === "http") console.log("If it is a block, try the box browser: bbx browser open <url>, then bbx webpage save --browser.");
    if (response.via === "browser") console.log("If a person can get past it: bbx browser ask.");
    process.exitCode = EXIT_REFUSED;
    return;
  }
  const input: SaveInput = { boxRoot, response, page: result, usedBoxFunction: outcome.usedBoxFunction, meta, capturedAt: retrieved ?? new Date().toISOString(), commit: options.commit };
  if (card !== null) {
    await updateCard({ ...input, card, options });
  } else {
    console.log(`Saved ${await saveNewCard({ ...input, dir })}${options.commit ? "" : " (not committed)"}`);
  }
  if (process.exitCode !== undefined) return;
  if (response.redirectedFrom.length > 0) console.log(`Redirected: ${[...response.redirectedFrom, response.url].join(" -> ")}`);
  if (result.note !== null && result.note !== undefined) console.log(`Note: ${result.note}`);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const saveCommand = new Command("save")
  .description("Make or update a webpage card from a URL, the page open in the box browser, or a saved HTML file")
  .argument("[url]", "The page to get over HTTP")
  .option("--browser", "Use the page open in the box browser")
  .option("--html <file>", "Use HTML already on disk, plain or gzipped; give its address with --url")
  .option("--url <address>", "Where the --html page came from")
  .option("--from <url>", "An earlier address, when following a redirect (repeat for each)", collect, [])
  .option("--to <dir>", "The folder for a new card (default: the inbox)")
  .option("--update <card>", "Replace this card's page in place; with no source, get the address it records")
  .option("--meta <json>", 'Provenance to keep in capture.meta; "retrieved" (ISO time) becomes the capture time')
  .option("--json", "Print the result and write nothing, for a caller that stores it another way")
  .option("--no-commit", "Leave the card uncommitted, for a caller that commits in batches")
  .addHelpText("after", `
Exit codes: 0 saved, 1 failed, 3 refused, 4 a redirect to read first.

A box can add src/tricks/webpage.ts. Every page goes through its default export,
which returns { title, markdown, meta? }, { refuse: "why" }, or what standard returns:

  export default async function (response, { standard }) {
    if (response.url.includes("forum.example") && response.html.includes("Please sign in")) {
      return { refuse: "forum sign-in page" };
    }
    return standard(response);
  }

response: url, requestedUrl, redirectedFrom, status (null from the browser or a
file), headers, contentType, html, sha256, via. If the function fails, nothing is saved.

Re-read a card from its own saved copy, with no network:
  bbx webpage save --update <card> --html <card's attach>/page.frozen
`)
  .action(async (url: string | undefined, options: WebpageOptions) => {
    try {
      await run(url, options);
    } catch (e) {
      if (!(e instanceof WebpageSaveError)) throw e;
      fail(e.message);
    }
  });

export const webpageCommand = new Command("webpage").description("Webpage cards").addCommand(saveCommand);
