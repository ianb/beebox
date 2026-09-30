/**
 * What the loader returns for a `.doctest.md`: a small entry module, and the
 * generated test module (the "body") that the entry imports.
 *
 * The split exists so a load failure becomes a failing TAP test. Before it,
 * an esbuild error or a throwing setup block was printed above the TAP
 * stream and the file reported `1..0 # no tests found`; agents filter test
 * output with head/tail/grep and usually lost the one useful line.
 */

import { basename } from "node:path";
import { transformSync } from "esbuild";
import { generateTestModule } from "./doctest-generate.ts";
import { DoctestSyntaxError, formatSyntaxError, parseErrorHints } from "./doctest-errors.ts";
import { rewriteInlineSourceMap, type LineMap } from "./line-map.ts";

/** The query that marks the body module's URL. */
export const BODY_QUERY = "?doctest-body";

interface EsbuildFailure {
  text: string;
  line: number;
}

function esbuildFailure(e: unknown): EsbuildFailure | null {
  if (typeof e !== "object" || e === null || !("errors" in e) || !Array.isArray(e.errors)) return null;
  const first: unknown = e.errors[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return null;
  const location = "location" in first ? first.location : null;
  const line = typeof location === "object" && location !== null && "line" in location ? Number(location.line) : 1;
  return { text: String(first.text), line };
}

/** The markdown line for a generated line, or the nearest mapped line above it. */
function nearestMd(lineMap: LineMap, generatedLine: number): number {
  for (let i = generatedLine - 1; i >= 0; i--) {
    const md = lineMap.md[i];
    if (md !== null && md !== undefined) return md;
  }
  return 1;
}

/**
 * Generate and transform the body module. When esbuild rejects an example,
 * that example's statement/expression split is redone by asking esbuild
 * (see doctest-split.ts `oracleSplit`) and the module is regenerated; only
 * if that fails too is the error reported, placed on the markdown line.
 */
export function loadDoctestBody(markdown: string, filePath: string): string {
  const oracle = new Set<number>();
  const mdLines = markdown.split("\n");
  for (let attempt = 0; ; attempt++) {
    const mod = generateTestModule(markdown, { filePath, oracle });
    let code: string;
    try {
      ({ code } = transformSync(mod.source, { loader: "ts", format: "esm", sourcefile: filePath, sourcemap: "inline" }));
    } catch (e) {
      const failure = esbuildFailure(e);
      if (!failure) throw e;
      const line = nearestMd(mod.lineMap, failure.line);
      const example = mod.examples.find((x) => line >= x.start && line <= x.end);
      if (example && !oracle.has(example.start) && attempt < 200) {
        oracle.add(example.start);
        continue;
      }
      const prevExpectedGap = (mdLines[line - 2] ?? "x").trim() === "" &&
        mod.examples.some((x) => x.end === line - 2 && x.hasExpected);
      throw new DoctestSyntaxError(formatSyntaxError({
        fileName: basename(filePath),
        markdown,
        line,
        problem: failure.text,
        blocks: mod.blocks,
        hints: parseErrorHints({ problem: failure.text, text: mdLines[line - 1] ?? "", prevExpectedGap }),
      }));
    }
    return rewriteInlineSourceMap(code, { lineMap: mod.lineMap, markdown });
  }
}

/**
 * The entry module. It runs in the test process, so it is plain JavaScript.
 * A failure to import the body is described from the error itself: a
 * DoctestSyntaxError already names its line; any other error is placed on
 * the markdown line from its (source-mapped) stack, and named by the block
 * it is in and that block's first lines.
 */
export function doctestEntrySource(url: string): string {
  const filePath = new URL(url).pathname;
  return `import { test as __doctest_test } from "tap";
import { readFileSync as __doctest_read } from "node:fs";
const __doctest_path = ${JSON.stringify(decodeURIComponent(filePath))};
const __doctest_name = ${JSON.stringify(basename(decodeURIComponent(filePath)))};
function __doctest_describe(e) {
  const message = String(e?.message ?? e);
  if (e?.name === "DoctestSyntaxError" || /^\\S+\\.doctest\\.md:\\d+: /.test(message)) {
    const [first, ...rest] = message.split("\\n");
    const line = Number.parseInt(first.split(":")[1] ?? "", 10);
    return {
      title: "DoctestSyntaxError " + first,
      details: { at: { fileName: __doctest_path, lineNumber: Number.isFinite(line) ? line : 1 }, stack: "", error: rest.join("\\n") },
    };
  }
  const stack = String(e?.stack ?? message);
  const at = stack.split(__doctest_path + ":")[1];
  const line = at ? Number.parseInt(at, 10) : NaN;
  const what = (e?.name ?? "Error") + ": " + message.split("\\n")[0];
  if (!Number.isFinite(line)) return { title: __doctest_name + " failed to load: " + what, details: { stack } };
  const md = __doctest_read(__doctest_path, "utf8").split("\\n");
  let fence = line - 1;
  while (fence > 0 && !md[fence - 1].startsWith("\`\`\`")) fence--;
  const info = (md[fence - 1] ?? "").slice(3).trim();
  const kind = /\\bsetup\\b/.test(info) ? "setup block" : "block";
  const source = md.slice(fence, fence + 2).map((l, i) => "  " + (fence + 1 + i) + " | " + l).join("\\n");
  return {
    title: kind + " at " + __doctest_name + ":" + fence + " threw " + what,
    details: { at: { fileName: __doctest_path, lineNumber: line }, block: source, error: stack, stack: "" },
  };
}
try {
  await import(${JSON.stringify(url + BODY_QUERY)});
} catch (e) {
  const { title, details } = __doctest_describe(e);
  __doctest_test(__doctest_name, (t) => { t.fail(title, details); t.end(); });
}
`;
}
