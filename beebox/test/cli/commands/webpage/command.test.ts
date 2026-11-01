// # `bbx webpage save`: one command, one box function
//
// docs/plans/webpage-capture-tools.md. A real local HTTP server and a real box.
// A saved page is one commit, with the HTML as the card's annexable attachment.
// The box's `webpage.ts` can refuse a page or change it, and when it breaks,
// nothing is saved.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { webpageCommand } from "../../../../src/cli/commands/webpage/command.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const execFileAsync = promisify(execFile);

const ARTICLE = `<!DOCTYPE html><html><head><title>Raised beds</title></head><body><article><h1>Raised beds</h1>
<p>${"Raised beds warm early in spring and drain well through wet weeks. ".repeat(20)}</p></article></body></html>`;

interface Run { stdout: string; stderr: string; exitCode: number | string | undefined }

async function setup(t: Test): Promise<{ root: string; base: string; save: (argv: string[]) => Promise<Run> }> {
  const box = await makeTmpBox({ git: true });
  const server = http.createServer((req, res) => {
    if (req.url === "/article") { res.writeHead(200, { "content-type": "text/html" }); res.end(ARTICLE); return; }
    if (req.url === "/old") { res.writeHead(301, { location: "/article" }); res.end(); return; }
    if (req.url === "/stub") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head><title>Stub</title></head><body><p>hi</p></body></html>"); return; }
    if (req.url === "/changed") { res.writeHead(200, { "content-type": "text/html" }); res.end(ARTICLE.replaceAll("Raised beds", "Sunken beds")); return; }
    if (req.url === "/evil") { res.writeHead(302, { location: "/x?a=$(id)" }); res.end(); return; }
    if (req.url === "/locked") { res.writeHead(403, { "content-type": "text/html" }); res.end("<p>no</p>"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo; // eslint-disable-line no-restricted-syntax -- a listening TCP server's address
  const cwd = process.cwd();
  process.chdir(box.root);
  t.teardown(async () => {
    process.chdir(cwd);
    await new Promise((resolve) => server.close(resolve));
    await box.cleanup();
  });
  const save = async (argv: string[]): Promise<Run> => {
    const out = { stdout: "", stderr: "" };
    const realLog = console.log;
    const realError = console.error;
    console.log = (text: string) => { out.stdout += `${text}\n`; };
    console.error = (text: string) => { out.stderr += `${text}\n`; };
    process.exitCode = undefined;
    try {
      await webpageCommand.parseAsync(["save", ...argv], { from: "user" });
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    const exitCode = process.exitCode;
    process.exitCode = undefined;
    return { ...out, exitCode };
  };
  return { root: box.root, base: `http://127.0.0.1:${String(port)}`, save };
}

async function cardsIn(root: string): Promise<string[]> {
  return (await fs.readdir(path.join(root, "_content/inbox"))).filter((name) => name.endsWith(".webpage.card"));
}

/** The card's frontmatter lines for these keys, as written. */
function fields(text: string, keys: RegExp): string[] {
  return text.split("\n").filter((line) => keys.test(line));
}

async function writeBoxFunction(root: string, source: string): Promise<void> {
  await fs.mkdir(path.join(root, "src/tricks"), { recursive: true });
  await fs.writeFile(path.join(root, "src/tricks/webpage.ts"), source);
}

void test("A page becomes one commit: the card and its saved HTML", async (t) => {
  const { root, base, save } = await setup(t);
  const run = await save([`${base}/article`]);
  t.check(run.exitCode, undefined);
  const [card] = await cardsIn(root);
  if (card === undefined) throw new Error("no card");
  t.check(run.stdout, `Saved _content/inbox/${card}\n`);
  const text = await fs.readFile(path.join(root, "_content/inbox", card), "utf8");
  t.check(fields(text, /^\s+(via|snapshot):/), ["  via: http", "  snapshot: html-only"]);
  const frozen = path.join("_content/inbox", card.replace(".webpage.card", ".attach"), "page.frozen");
  t.check((await fs.readFile(path.join(root, frozen), "utf8")).split("<title>")[0], `<!DOCTYPE html><html><head><base href="${base}/article">`);
  const { stdout } = await execFileAsync("git", ["show", "--name-only", "--format=%s", "HEAD"], { cwd: root });
  t.check(stdout.trim().split("\n").filter((line) => line !== ""), ['Save web page: "Raised beds"', `_content/inbox/${card}`, frozen].toSorted((a, b) => (a.startsWith("Save") ? -1 : b.startsWith("Save") ? 1 : a.localeCompare(b))));
});

void test("A redirect to another page stops with the command to follow it, which the card then records", async (t) => {
  const { root, base, save } = await setup(t);
  const stopped = await save([`${base}/old`]);
  t.check(stopped.exitCode, 4);
  t.check(stopped.stdout, `Redirects to ${base}/article (301). Nothing was saved. Read the address; if it is a sign-in page, use the box browser. To follow:\nbbx webpage save ${base}/article --from ${base}/old\n`);
  t.check(await cardsIn(root), []);
  const followed = await save([`${base}/article`, "--from", `${base}/old`]);
  t.check(followed.stdout.split("\n")[1], `Redirected: ${base}/old -> ${base}/article`);
  const [card] = await cardsIn(root);
  t.check(fields(await fs.readFile(path.join(root, "_content/inbox", card ?? ""), "utf8"), /^\s+- http:.*\/old$|^\s+redirectedFrom:/), ["  redirectedFrom:", `    - ${base}/old`]);
});

void test("A blocked page is refused and saves nothing", async (t) => {
  const { root, base, save } = await setup(t);
  const run = await save([`${base}/locked`]);
  t.check(run.exitCode, 3);
  t.check(run.stdout.split("\n")[0], `Refused ${base}/locked: the site answered HTTP 403, with no challenge page seen: it may be blocking the box, or the page may not exist. Nothing was saved.`);
  t.check(await cardsIn(root), []);
});

void test("The box function can refuse, can change the page through standard, and stops the save when it breaks", async (t) => {
  const { root, base, save } = await setup(t);
  await writeBoxFunction(root, 'export default async () => ({ refuse: "a rule of this box" });\n');
  const refused = await save([`${base}/article`]);
  t.check([refused.exitCode, refused.stdout.split("\n")[0]], [3, `Refused ${base}/article: a rule of this box. Nothing was saved.`]);

  await writeBoxFunction(root, 'export default (r, { standard }) => standard({ ...r, html: r.html.replaceAll("Raised beds", "Sunken beds") });\n');
  t.check((await save([`${base}/article`])).exitCode, undefined);
  const [card] = await cardsIn(root);
  const text = await fs.readFile(path.join(root, "_content/inbox", card ?? ""), "utf8");
  t.check(fields(text, /^title:|^\s+function:/), ["title: Sunken beds", "  function: box"]);

  await writeBoxFunction(root, 'throw new Error("boom");\n');
  const broken = await save([`${base}/article`]);
  t.check([broken.exitCode, broken.stderr], [1, "webpage.ts failed, so nothing was saved: boom\n"]);
  await writeBoxFunction(root, "export default () => ({ nope: true });\n");
  t.check((await save([`${base}/article`])).exitCode, 1);
  t.check(await cardsIn(root), [card ?? ""]);
});

// A site's text must not run when the agent pastes the printed command.
void test("A redirect target with shell text is quoted in the printed command", async (t) => {
  const { base, save } = await setup(t);
  const run = await save([`${base}/evil`]);
  t.check(run.exitCode, 4);
  t.check(run.stdout.split("\n")[1], `bbx webpage save '${base}/x?a=$(id)' --from ${base}/evil`);
});

void test("--update replaces the page in place, keeps what it does not own, and survives bad results", async (t) => {
  const { root, base, save } = await setup(t);
  await save([`${base}/article`]);
  const [name] = await cardsIn(root);
  if (name === undefined) throw new Error("no card");
  const rel = path.join("_content/inbox", name);
  const file = path.join(root, rel);
  const attach = path.join(root, "_content/inbox", name.replace(".webpage.card", ".attach"));
  await fs.writeFile(attach + "/remarks.commentary.card", "---\ntitle: mine\n---\n");
  await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("---\n", "---\nmyField: kept\n").replace("  - href:", "  - label: mine\n    href:"));
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "edit"], { cwd: root });
  const head = async (): Promise<string> => (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout;
  const start = await head();

  t.check((await save(["--update", rel])).stdout, `Unchanged ${rel}\n`);
  t.check(await head(), start);

  // Nothing bad reaches the card: a refusal, a redirect, or a much shorter page.
  const original = await fs.readFile(file, "utf8");
  t.check((await save([`${base}/locked`, "--update", rel])).exitCode, 3);
  const stopped = await save([`${base}/old`, "--update", rel]);
  t.check([stopped.exitCode, stopped.stdout.split("\n")[1]], [4, `bbx webpage save ${base}/article --from ${base}/old --update ${rel}`]);
  t.check((await save([`${base}/stub`, "--update", rel])).exitCode, 3);
  t.check(await fs.readFile(file, "utf8"), original);

  t.check((await save([`${base}/changed`, "--update", rel])).stdout.split("\n")[0], `Updated ${rel}`);
  t.check(await cardsIn(root), [name]);
  const text = await fs.readFile(file, "utf8");
  t.check(fields(text, /^myField:|^title:|^\s+(- )?(href|label):/), ["myField: kept", "title: Sunken beds", "  - label: mine", `    href: ${base}/changed`]);
  t.check(await fs.readdir(attach), ["page.frozen", "remarks.commentary.card"]);
  t.check((await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: root })).stdout, 'Update web page: "Sunken beds"\n');

  t.check((await save(["--update", "_content/inbox/none.webpage.card"])).stderr, "bbx webpage save: no such card: _content/inbox/none.webpage.card\n");
  t.check((await save(["--update", rel, "--to", "_content"])).exitCode, 1);
});

// The cleanup path: a card re-read from its own copy, which stays as it was, with the original's provenance.
void test("--update --html re-reads a card from its own saved copy; --meta keeps the original provenance", async (t) => {
  const { root, save } = await setup(t);
  await fs.writeFile(path.join(root, "old.html"), ARTICLE);
  const meta = JSON.stringify({ retrieved: "2026-10-29T10:00:00Z", method: "curl", status: 200 });
  await save(["--html", "old.html", "--url", "https://garden.example/beds", "--meta", meta]);
  const [name] = await cardsIn(root);
  if (name === undefined) throw new Error("no card");
  const rel = path.join("_content/inbox", name);
  const text = await fs.readFile(path.join(root, rel), "utf8");
  t.check(fields(text, /^\s+retrieved:|^\s+method:|^\s+status:/), ["    retrieved: 2026-10-29T10:00:00Z", "    method: curl", "    status: 200"]);

  const copy = path.join("_content/inbox", name.replace(".webpage.card", ".attach"), "page.frozen");
  const before = await fs.readFile(path.join(root, copy), "utf8");
  await writeBoxFunction(root, 'export default (r, { standard }) => standard({ ...r, html: r.html.replaceAll("Raised beds", "Sunken beds") });\n');
  t.check((await save(["--update", rel, "--html", copy])).stdout, `Updated ${rel}\n`);
  t.check(await fs.readFile(path.join(root, copy), "utf8"), before);
  t.check((await save(["--update", rel, "--html", copy])).stdout, `Unchanged ${rel}\n`);

  // The hash stays that of the bytes first received, and a corrected title is a change.
  t.check(fields(await fs.readFile(path.join(root, rel), "utf8"), /^\s+sha256:/), fields(text, /^\s+sha256:/));
  await writeBoxFunction(root, 'export default async (r, { standard }) => ({ ...(await standard({ ...r, html: r.html.replaceAll("Raised beds", "Sunken beds") })), title: "Corrected" });\n');
  t.check((await save(["--update", rel, "--html", copy])).stdout, `Updated ${rel}\n`);
  t.check((await save(["--meta", "{not json", "https://a.example/"])).exitCode, 1);
  t.check((await save(["--meta", '{"retrieved":"yesterday"}', "https://a.example/"])).exitCode, 1);
});

// Modes for a caller that stores results itself or commits in batches.
void test("--json writes nothing; --no-commit leaves the commit to the caller", async (t) => {
  const { root, base, save } = await setup(t);
  const head = async (): Promise<string> => (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout;
  const start = await head();
  const printed = JSON.parse((await save([`${base}/article`, "--json"])).stdout) as { result: { title: string } }; // eslint-disable-line no-restricted-syntax -- this command's own output, checked next
  t.check(printed.result.title, "Raised beds");
  t.check(await cardsIn(root), []);
  const run = await save([`${base}/article`, "--no-commit"]);
  const [name] = await cardsIn(root);
  t.check(run.stdout, `Saved _content/inbox/${name ?? ""} (not committed)\n`);
  t.check(await head(), start);
});

void test("HTML on disk goes the same way, with its address", async (t) => {
  const { root, save } = await setup(t);
  await fs.writeFile(path.join(root, "old.html"), ARTICLE);
  t.check((await save(["--html", "old.html", "--url", "https://garden.example/beds"])).exitCode, undefined);
  const [card] = await cardsIn(root);
  const text = await fs.readFile(path.join(root, "_content/inbox", card ?? ""), "utf8");
  t.check(fields(text, /^\s+(- )?href:|^\s+via:/), ["  - href: https://garden.example/beds", "  via: file"]);
  t.check((await save(["--html", "old.html"])).exitCode, 1);
  await fs.writeFile(path.join(root, "old.html.gz"), gzipSync(ARTICLE));
  t.check((await save(["--html", "old.html.gz", "--url", "https://garden.example/gz"])).exitCode, undefined);
  t.check((await save(["--html", "missing.html", "--url", "https://garden.example/beds"])).exitCode, 1);
  t.check((await save([])).exitCode, 1);
  t.check((await save(["https://a.example/", "--browser"])).exitCode, 1);
  t.check((await save(["https://a.example/", "--to", "../outside"])).exitCode, 1);
});
