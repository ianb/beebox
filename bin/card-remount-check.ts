/**
 * Dev check: a card being read must not remount its body when only the
 * workspace around it changes.
 *
 * Writes a fixture into a test box (a long doc card with headings, external
 * citations, and an embedded interactive figure), opens it in the companion
 * pane, scrolls the figure near the top, then pins and unpins the card's own
 * tab. Pinning changes workspace state and nothing in the card. The check
 * fails if the figure's picker, its drawing, or a citation is a new DOM node
 * afterwards, or if the scroller moved without the reader scrolling.
 *
 * Usage: bin/card-remount-check [--box-dir <dir>]   (default: this worktree's test1 clone)
 * Issue: issues/bugs/2026-10-26-card-contents-button-flickers-on-a-card-with-an-embedded-widget.md
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

/** The check could not run; distinct from a remount, which it reports and exits 1. */
class CheckSetupError extends Error {
  constructor(problem: string) {
    super(`card-remount-check could not run: ${problem}`);
    this.name = "CheckSetupError";
  }
}
class MissingBoxDirError extends CheckSetupError {
  constructor() {
    super("--box-dir needs a directory");
    this.name = "MissingBoxDirError";
  }
}
class NotABoxError extends CheckSetupError {
  constructor(dir: string) {
    super(`${dir} is not a box (no _content/)`);
    this.name = "NotABoxError";
  }
}
class PageResultError extends CheckSetupError {
  constructor(got: unknown) {
    super(`the page returned ${JSON.stringify(got)}`);
    this.name = "PageResultError";
  }
}
class PageNotReadyError extends CheckSetupError {
  constructor(last: unknown) {
    super(`the card did not render its figure; last: ${JSON.stringify(last)}`);
    this.name = "PageNotReadyError";
  }
}
class PinButtonMissingError extends CheckSetupError {
  constructor() {
    super("no Pin button on the card's tab");
    this.name = "PinButtonMissingError";
  }
}
const CARD = "_content/docs/Remount_Repro.doc.card";
const TITLE = "Remount Repro";

function boxDir(argv: readonly string[]): string {
  const at = argv.indexOf("--box-dir");
  if (at !== -1) {
    const dir = argv.at(at + 1);
    if (dir === undefined) throw new MissingBoxDirError();
    return dir;
  }
  return join(homedir(), "src/box-worktrees", basename(REPO_ROOT), "test1");
}

const SKETCH = `// D3 figure: two atom pickers; the drawing updates when a pick changes.
export default function (d3, { mount }) {
  const atoms = ["H", "C", "N", "O", "Cl"];
  const radius = { H: 20, C: 34, N: 32, O: 30, Cl: 44 };
  const root = d3.select(mount).append("div");
  const row = root.append("div");
  const picks = ["C", "O"];
  const svg = root.append("svg").attr("width", 300).attr("height", 160);
  const draw = () => {
    svg.selectAll("*").remove();
    svg.append("line").attr("x1", 90).attr("y1", 80).attr("x2", 210).attr("y2", 80).attr("stroke", "#888").attr("stroke-width", 6);
    picks.forEach((atom, i) => {
      const g = svg.append("g").attr("transform", \`translate(\${90 + i * 120},80)\`);
      g.append("circle").attr("r", radius[atom]).attr("fill", i === 0 ? "#4ea3ff" : "#ff7a59");
      g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").text(atom);
    });
  };
  picks.forEach((initial, i) => {
    const select = row.append("select").attr("aria-label", \`Atom \${i + 1}\`).on("change", (event) => {
      picks[i] = event.target.value;
      draw();
    });
    select.selectAll("option").data(atoms).join("option").attr("value", (d) => d).property("selected", (d) => d === initial).text((d) => d);
  });
  draw();
  return () => root.remove();
}
`;

function docCard(): string {
  const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
  const sections = Array.from({ length: 8 }, (_, index) => {
    const n = index + 1;
    const paragraphs = [1, 2, 3].map((p) => `Paragraph ${p} of section ${n}. ${filler}`).join("\n\n");
    const extra = n === 2 ? "\n\n![Atoms](../figures/Atoms.figure.card)"
      : n === 4 ? '\n\n{% source href="https://www.britannica.com/science/chemical-bonding" %}\nA block citation in section 4.\n{% /source %}'
        : "";
    return `## Section ${n}\n\n${paragraphs}${extra}`;
  });
  return `---\ntitle: ${TITLE}\n---\nIntro. {% source href="https://en.wikipedia.org/wiki/Chemical_bond" %}Bonds hold atoms together.{% /source %}\n\n${sections.join("\n\n")}\n`;
}

function writeFixture(box: string): void {
  if (!existsSync(join(box, "_content"))) throw new NotABoxError(box);
  const files: Record<string, string> = {
    "_content/figures/Atoms.figure.card": "---\nruntime: d3\nentry: attach/sketch.ts\ntitle: Atoms\n---\nTwo atom pickers and a drawing (card-remount-check fixture).\n",
    "_content/figures/Atoms.attach/sketch.ts": SKETCH,
    [CARD]: docCard(),
  };
  for (const [path, content] of Object.entries(files)) {
    const full = join(box, path);
    if (existsSync(full) && readFileSync(full, "utf8") === content) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function browse(...args: string[]): string {
  return execFileSync(join(REPO_ROOT, "bin/browse"), args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Evaluates `expression` in the page and parses its JSON result. */
function evalJson(expression: string): unknown {
  const raw: unknown = JSON.parse(browse("eval", `JSON.stringify(${expression})`));
  if (typeof raw !== "string") throw new PageResultError(raw);
  return JSON.parse(raw);
}

const INSTALL = `(() => {
  const article = document.querySelector(".bbx-card-contents")?.closest("article");
  const select = article?.querySelector("select");
  if (!article || !select) return "not ready";
  let scroller = article.parentElement;
  while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const nodes = () => ({ picker: article.querySelector("select"), drawing: article.querySelector("svg circle")?.closest("svg"),
    citation: article.querySelector("figure[data-source-href]"), heading: article.querySelector("[data-card-outline] h2") });
  scroller.scrollTop = Math.max(0, select.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 120);
  const before = nodes();
  const scrollTop = scroller.scrollTop;
  window.__remount = { scroller, nodes, before, scrollTop };
  return "ready";
})()`;

const PIN = `(() => {
  const button = [...document.querySelectorAll("button")].find((b) => /^(Pin|Unpin) ${TITLE}$/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
  if (!button) return "no pin button";
  button.click();
  return "clicked";
})()`;

const REPORT = `(() => {
  const { scroller, nodes, before, scrollTop } = window.__remount;
  const now = nodes();
  return { replaced: Object.keys(before).filter((k) => before[k] !== now[k]), scrollTop: [scrollTop, scroller.scrollTop] };
})()`;

function waitUntilReady(): void {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const got = evalJson(INSTALL);
    if (got === "ready") return;
    if (Date.now() > deadline) throw new PageNotReadyError(got);
    browse("wait", "500");
  }
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function main(): number {
  writeFixture(boxDir(process.argv.slice(2)));
  browse("set", "viewport", "1440", "900");
  browse("open", `/chat?card=${encodeURIComponent(CARD)}`);
  waitUntilReady();
  // Pin, then unpin: two workspace changes that leave the card as it was.
  for (let i = 0; i < 2; i++) {
    if (evalJson(PIN) !== "clicked") throw new PinButtonMissingError();
    browse("wait", "1500");
  }
  const result = evalJson(REPORT);
  if (typeof result !== "object" || result === null || !("replaced" in result) || !("scrollTop" in result)
    || !isStrings(result.replaced) || !Array.isArray(result.scrollTop)) throw new PageResultError(result);
  const replaced = result.replaced;
  const [start, end]: unknown[] = result.scrollTop;
  if (replaced.length === 0 && start === end) {
    console.log("ok: pinning the tab left the card body in place");
    return 0;
  }
  console.error(`FAIL: pinning the tab remounted ${replaced.join(", ") || "nothing"}; scroll moved ${start} -> ${end} with no reader scroll`);
  return 1;
}

process.exitCode = main();
