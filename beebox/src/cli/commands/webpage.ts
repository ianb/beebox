/**
 * `bbx webpage save`: make a webpage card from a URL, from the page open in the
 * box browser, or from HTML already on disk (docs/plans/webpage-capture-tools.md).
 *
 * It runs in the agent's shell, so a URL reaches only what `curl` could. Exit
 * codes: 0 saved, 1 failed, 3 refused, 4 a redirect the agent should read first.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import { PAGE_READ } from "../../core/browser/page-read.js";
import { runWebpageFunction } from "../../core/webpage/box-function/core.js";
import { fetchPage } from "../../core/webpage/fetch.js";
import { isRefusal, type CapturedResponse, type PageResult } from "../../core/webpage/response.js";
import { writeWebpageCard } from "../../core/webpage/write.js";
import { stageAndCommitPaths } from "../../lib/git/core/operations.js";
import { BOX_DIRS, requireBoxRoot } from "../../lib/paths/core.js";
import { safeFilename } from "../../lib/safe-filename.js";
import { errnoCode } from "../../shared/error-guards.js";
import { postToBox } from "../lib/browser-post.js";

const EXIT_REFUSED = 3;
const EXIT_REDIRECT = 4;
const NAME_ATTEMPTS = 5;

interface WebpageOptions {
  browser?: boolean;
  html?: string;
  url?: string;
  from: string[];
  to?: string;
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

/** `dir` relative to the box root, or null when it leaves the box. */
function boxRelativeDir(boxRoot: string, dir: string): string | null {
  const relative = path.relative(boxRoot, path.resolve(boxRoot, dir));
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ? null : relative;
}

/** The HTML as saved: a `<base>` so its relative images and styles still resolve. */
function savedHtml(html: string, url: string): string {
  const base = `<base href="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head === null) return base + html;
  const end = head.index + head[0].length;
  return html.slice(0, end) + base + html.slice(end);
}

/** Write the card under a name no other capture holds, and commit it. */
async function saveCard(input: { boxRoot: string; dir: string; response: CapturedResponse; page: PageResult; usedBoxFunction: boolean }): Promise<string> {
  const { boxRoot, dir, response, page, usedBoxFunction } = input;
  const stamp = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
  for (let attempt = 1; ; attempt += 1) {
    const cardRel = path.join(dir, `${safeFilename(page.title, "Page")}_${stamp}_${randomBytes(2).toString("hex")}.webpage.card`);
    try {
      const paths = await writeWebpageCard({
        boxRoot,
        cardRel,
        title: page.title,
        url: response.url,
        capturedAt: new Date().toISOString(),
        markdown: page.markdown,
        siteName: page.siteName ?? undefined,
        byline: page.byline ?? undefined,
        excerpt: page.excerpt ?? undefined,
        frozenHtml: savedHtml(response.html, response.url),
        exclusive: true,
        capture: {
          via: response.via,
          snapshot: "html-only",
          ...(response.redirectedFrom.length === 0 ? {} : { redirectedFrom: response.redirectedFrom }),
          ...(usedBoxFunction ? { function: "box" as const } : {}),
          ...(page.note === null || page.note === undefined ? {} : { note: page.note }),
        },
      });
      await stageAndCommitPaths(boxRoot, { paths, message: `Save web page: "${page.title}"`, trailers: { "Created-By": "bbx-webpage" } });
      return cardRel;
    } catch (e) {
      if (errnoCode(e) !== "EEXIST" || attempt >= NAME_ATTEMPTS) throw e;
    }
  }
}

async function browserResponse(): Promise<CapturedResponse | string> {
  const posted = await postToBox("page", {});
  if (!posted.ok) return posted.message;
  const page = PAGE_READ.safeParse(posted.json);
  if (!page.success) return `bbx webpage save: the box server's reply has the wrong shape: ${posted.text.slice(0, 200)}`;
  if (!/^https?:\/\//i.test(page.data.url)) return `The box browser is on no web page (${page.data.url}). Open one with bbx browser open.`;
  return { url: page.data.url, requestedUrl: page.data.url, redirectedFrom: [], status: null, headers: {}, contentType: "text/html", html: page.data.html, via: "browser" };
}

/** A page saved earlier: `--url` says where it came from, because the file cannot. */
async function fileResponse({ file, url, boxRoot }: { file: string; url: string; boxRoot: string }): Promise<CapturedResponse | string> {
  if (!/^https?:\/\//i.test(url)) return `bbx webpage save: --url must be the page's web address: ${url}`;
  let html: string;
  try {
    html = await fs.readFile(path.resolve(boxRoot, file), "utf8");
  } catch (e) {
    return `bbx webpage save: could not read ${file}: ${e instanceof Error ? e.message : String(e)}`;
  }
  return { url, requestedUrl: url, redirectedFrom: [], status: null, headers: {}, contentType: "text/html", html, via: "file" };
}

async function run(url: string | undefined, options: WebpageOptions): Promise<void> {
  const sources = [url !== undefined, options.browser === true, options.html !== undefined].filter(Boolean).length;
  if (sources !== 1) {
    fail("bbx webpage save: give one of: a URL, --browser for the page open in the box browser, or --html <file> --url <address>");
    return;
  }
  if ((options.html === undefined) !== (options.url === undefined)) {
    fail("bbx webpage save: --html and --url go together");
    return;
  }
  const boxRoot = await requireBoxRoot();
  const dir = boxRelativeDir(boxRoot, options.to ?? BOX_DIRS.inbox);
  if (dir === null) {
    fail(`bbx webpage save: --to must be a folder inside the box: ${options.to ?? ""}`);
    return;
  }
  let response: CapturedResponse;
  if (url === undefined) {
    const read = options.html !== undefined && options.url !== undefined
      ? await fileResponse({ file: options.html, url: options.url, boxRoot })
      : await browserResponse();
    if (typeof read === "string") {
      fail(read);
      return;
    }
    response = read;
  } else {
    const fetched = await fetchPage({ url, from: options.from });
    if (fetched.kind === "failed") {
      fail(fetched.message);
      return;
    }
    if (fetched.kind === "redirect") {
      const fromFlags = fetched.chain.map((earlier) => `--from ${earlier}`).join(" ");
      console.log(`Redirects to ${fetched.target} (${String(fetched.status)}). Nothing was saved. Read the address; if it is a sign-in page, use the box browser. To follow:`);
      console.log(`bbx webpage save ${fetched.target} ${fromFlags}`);
      process.exitCode = EXIT_REDIRECT;
      return;
    }
    response = fetched.response;
  }
  const outcome = await runWebpageFunction({ boxRoot, response });
  if (!outcome.ok) {
    fail(outcome.message);
    return;
  }
  if (isRefusal(outcome.result)) {
    console.log(`Refused ${response.url}: ${outcome.result.refuse}. Nothing was saved.`);
    if (response.via !== "file") console.log(response.via === "http" ? "Try the box browser: bbx browser open <url>, then bbx webpage save --browser." : "If a person can get past it: bbx browser ask.");
    process.exitCode = EXIT_REFUSED;
    return;
  }
  const card = await saveCard({ boxRoot, dir, response, page: outcome.result, usedBoxFunction: outcome.usedBoxFunction });
  console.log(`Saved ${card}`);
  if (response.redirectedFrom.length > 0) console.log(`Redirected: ${[...response.redirectedFrom, response.url].join(" -> ")}`);
  if (outcome.result.note !== null && outcome.result.note !== undefined) console.log(`Note: ${outcome.result.note}`);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const saveCommand = new Command("save")
  .description("Make a webpage card from a URL, the page open in the box browser, or a saved HTML file")
  .argument("[url]", "The page to get over HTTP")
  .option("--browser", "Use the page open in the box browser")
  .option("--html <file>", "Use HTML already on disk; give its address with --url")
  .option("--url <address>", "Where the --html page came from")
  .option("--from <url>", "An earlier address, when following a redirect (repeat for each)", collect, [])
  .option("--to <dir>", "The folder for the card (default: the inbox)")
  .addHelpText("after", `
Exit codes: 0 saved, 1 failed, 3 refused, 4 a redirect to read first.

A box can add src/tricks/webpage.ts. Every page goes through its default export,
which returns { title, markdown }, { refuse: "why" }, or what standard returns:

  export default async function (response, { standard }) {
    if (response.url.includes("forum.example") && response.html.includes("Please sign in")) {
      return { refuse: "forum sign-in page" };
    }
    return standard(response);
  }

response: url, requestedUrl, redirectedFrom, status (null from the browser or a
file), headers, contentType, html, via. If the function fails, nothing is saved.
`)
  .action(run);

export const webpageCommand = new Command("webpage").description("Webpage cards").addCommand(saveCommand);
