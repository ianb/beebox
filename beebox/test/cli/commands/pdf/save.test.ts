// # `bbx pdf save`: a PDF saved like a web page
//
// docs/plans/knowledge-base-tools.md, Track B. A real local HTTP server, a real
// box, and a fake Docling. A saved PDF is one commit: the card and the original
// beside it, with the address, the hash, and the capture on the card. Bytes that
// are not a PDF (a sign-in page with status 200) are refused and save nothing.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { promisify } from "node:util";
import { makePdfSaveCommand } from "../../../../src/cli/commands/pdf/save.js";
import { createFakeDocling } from "../../../../src/services/docling/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { textPdf } from "../../../helpers/pdf-fixtures.js";

const execFileAsync = promisify(execFile);
const PDF = textPdf();
const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");

interface Run { stdout: string; stderr: string; exitCode: number | string | undefined }

async function setup(t: Test, options: { docling?: ReturnType<typeof createFakeDocling> | undefined }): Promise<{ root: string; base: string; save: (argv: string[]) => Promise<Run> }> {
  const box = await makeTmpBox({ git: true });
  const server = http.createServer((req, res) => {
    if (req.url === "/files/Benefits%20Guide.pdf") { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(PDF); return; }
    if (req.url === "/old") { res.writeHead(301, { location: "/files/Benefits%20Guide.pdf" }); res.end(); return; }
    if (req.url === "/moved") { res.writeHead(302, { location: "/login?next=$(id)" }); res.end(); return; }
    if (req.url === "/signin.pdf") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body>Please sign in</body></html>"); return; }
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
  const docling = options.docling ?? createFakeDocling({ markdown: "# Guide\n\nIncome limit {% x %} <b>raw</b>\n", pageCount: 1, figureCount: 0 });
  const save = async (argv: string[]): Promise<Run> => {
    const out = { stdout: "", stderr: "" };
    const realLog = console.log;
    const realError = console.error;
    const realWarn = console.warn;
    console.log = (text: string) => { out.stdout += `${text}\n`; };
    console.error = (text: string) => { out.stderr += `${text}\n`; };
    console.warn = () => { /* the extraction failure warning */ };
    process.exitCode = undefined;
    try {
      await makePdfSaveCommand({ docling }).parseAsync(argv, { from: "user" });
    } finally {
      console.log = realLog;
      console.error = realError;
      console.warn = realWarn;
    }
    const exitCode = process.exitCode;
    process.exitCode = undefined;
    return { ...out, exitCode };
  };
  return { root: box.root, base: `http://127.0.0.1:${String(port)}`, save };
}

async function cardsIn(root: string): Promise<string[]> {
  return (await fs.readdir(path.join(root, "_content/inbox"))).filter((name) => name.endsWith(".pdf.card"));
}

/** Cards and attach folders in the inbox. */
async function leftovers(root: string): Promise<string[]> {
  return (await fs.readdir(path.join(root, "_content/inbox"))).filter((name) => name.endsWith(".pdf.card") || name.endsWith(".attach"));
}

/** The card's frontmatter lines for these keys, as written. */
function fields(text: string, keys: RegExp): string[] {
  return text.split("\n").filter((line) => keys.test(line));
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

void test("A PDF URL becomes one commit: the card, the original beside it, the address and the hash", async (t) => {
  const { root, base, save } = await setup(t, {});
  const run = await save(["--name", "benefits", "--to", "_content/knowledge", `${base}/files/Benefits%20Guide.pdf`, "--meta", '{"retrieved":"2026-10-29T10:00:00Z","method":"curl"}']);
  t.check([run.exitCode, run.stdout], [undefined, "Saved _content/knowledge/benefits.pdf.card\n"]);
  const text = await fs.readFile(path.join(root, "_content/knowledge/benefits.pdf.card"), "utf8");
  // The extracted body is third-party text: its Markdoc tag and HTML are escaped.
  t.check(text.split("\n"), [
    "---",
    "format: pdf",
    "filename:",
    "  ref: attach/source.pdf",
    "  via:",
    "    channel: bbx-pdf-save",
    "    at: 2026-10-29T10:00:00Z",
    "  original-name: Benefits Guide.pdf",
    "  mime-type: application/pdf",
    `  size: ${String(PDF.length)}`,
    "sources:",
    `  - href: ${base}/files/Benefits%20Guide.pdf`,
    "    retrieved: 2026-10-29T10:00:00Z",
    "capture:",
    "  via: http",
    `  sha256: ${PDF_SHA256}`,
    "  requestHeaders: desktop-chrome-142",
    "  meta:",
    "    method: curl",
    "docling:",
    "  ref: attach/docling.json.gz",
    "  version: 2.117.0-fake",
    "metadata:",
    "  pages: 1",
    "---",
    "# Guide",
    "",
    "Income limit \\{% x %} \\<b>raw\\</b>",
    "",
  ]);
  t.check(sha256Of(await fs.readFile(path.join(root, "_content/knowledge/benefits.attach/source.pdf"))), PDF_SHA256);
  const { stdout } = await execFileAsync("git", ["show", "--name-only", "--format=%s", "HEAD"], { cwd: root });
  t.check(stdout, `Save PDF: "benefits"

_content/knowledge/benefits.attach/docling.json.gz
_content/knowledge/benefits.attach/page-001.webp
_content/knowledge/benefits.attach/source.pdf
_content/knowledge/benefits.attach/text-layer.txt
_content/knowledge/benefits.pdf.card
`);
});

// A server that answers 200 with a sign-in page is the failure the `%PDF-` check exists for.
void test("A reply that is not a PDF is refused with exit 3 and saves nothing", async (t) => {
  const { root, base, save } = await setup(t, {});
  const run = await save([`${base}/signin.pdf`]);
  t.check([run.exitCode, run.stdout], [3, `Refused: ${base}/signin.pdf is not a PDF (its type is text/html); it may be a sign-in page. Nothing was saved. If it is a sign-in page, use the box browser: bbx browser open <url>, or bbx browser ask.\n`]);
  t.check(await leftovers(root), []);
});

void test("A redirect to another address stops with a quoted command to follow it, which the card then records", async (t) => {
  const { root, base, save } = await setup(t, {});
  const hostile = await save([`${base}/moved`]);
  t.check([hostile.exitCode, hostile.stdout.split("\n")[1]], [4, `bbx pdf save '${base}/login?next=$(id)' --from ${base}/moved`]);
  const followed = await save([`${base}/files/Benefits%20Guide.pdf`, "--from", `${base}/old`]);
  t.check(followed.stdout.split("\n")[1], `Redirected: ${base}/old -> ${base}/files/Benefits%20Guide.pdf`);
  const [card] = await cardsIn(root);
  const text = await fs.readFile(path.join(root, "_content/inbox", card ?? ""), "utf8");
  t.check(fields(text, /^\s+redirectedFrom:|^\s+- http:\/\/[^ ]*\/old$/), ["  redirectedFrom:", `    - ${base}/old`]);
});

void test("A PDF file saves with the address given for it, and --name will not replace a card", async (t) => {
  const { root, base, save } = await setup(t, {});
  await fs.writeFile(path.join(root, "download.pdf"), PDF);
  const address = `${base}/files/guide.pdf`;
  const first = await save(["download.pdf", "--url", address, "--name", "guide", "--no-commit"]);
  t.check([first.exitCode, first.stdout], [undefined, "Saved _content/inbox/guide.pdf.card (not committed)\n"]);
  const text = await fs.readFile(path.join(root, "_content/inbox/guide.pdf.card"), "utf8");
  t.check(fields(text, /^\s+via: |^\s+(sha256|original-name):|^\s+- href:/), ["  original-name: download.pdf", `  - href: ${address}`, "  via: file", `  sha256: ${PDF_SHA256}`]);
  const again = await save(["download.pdf", "--url", address, "--name", "guide"]);
  t.check([again.exitCode, again.stderr], [1, "bbx pdf save: _content/inbox/guide.pdf.card already exists\n"]);
  t.check((await save(["download.pdf"])).stderr, "bbx pdf save: give a URL, or a PDF file with --url <web address>\n");
  t.check((await save([address, "--to", ".."])).stderr, "bbx pdf save: --to must be inside the box: ..\n");
});

void test("Failed extraction still saves the card, with the error and a note", async (t) => {
  const { root, base, save } = await setup(t, { docling: createFakeDocling({ failWith: "docling is not installed" }) });
  const run = await save([`${base}/files/Benefits%20Guide.pdf`, "--name", "guide"]);
  t.check([run.exitCode, run.stdout], [undefined, "Saved _content/inbox/guide.pdf.card\nNote: text extraction failed (docling is not installed); the card holds the original. Retry with bbx pdf reanalyze _content/inbox/guide.pdf.card.\n"]);
  t.check(fields(await fs.readFile(path.join(root, "_content/inbox/guide.pdf.card"), "utf8"), /^error:/), ["error: docling is not installed"]);
});

void test("A commit that fails leaves nothing behind", async (t) => {
  const { root, base, save } = await setup(t, {});
  await fs.writeFile(path.join(root, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await fs.writeFile(path.join(root, ".git/hooks/commit-msg"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await t.checkThrows(() => save([`${base}/files/Benefits%20Guide.pdf`, "--name", "guide"]), "CommitDidNotLandError");
  t.check(await leftovers(root), []);
});
