/**
 * Generates the tap test module source that doctest-hooks.ts's `load()` hook
 * feeds to esbuild, from the code blocks and examples doctest-parse.ts parses
 * out of a `.doctest.md` file.
 *
 * Every generated line records the markdown line it came from, so the loader
 * can put esbuild parse errors and runtime stack frames on the author's line.
 */

import { basename } from "node:path";
import { type CodeBlock, parseCodeBlocks, parseExamples, findIndentedFences } from "./doctest-parse.ts";
import { parseFenceInfo, FenceInfoError, type FenceInfo } from "./doctest-info.ts";
import { type GenLine, type LineMap, buildLineMap } from "./line-map.ts";
import { DoctestSyntaxError, formatSyntaxError, type BlockSpan } from "./doctest-errors.ts";
import { emitExamples, gen, verbatim, type ExampleSpan } from "./doctest-emit.ts";
import { moduleHeader, testHeader, teardownRegistration, declaresName } from "./doctest-runtime.ts";

export {
  type CodeBlock,
  parseCodeBlocks,
  type Example,
  type ThrowsExample,
  parseExamples,
  parseExample,
} from "./doctest-parse.ts";
export { type ExampleSpan } from "./doctest-emit.ts";

/** Default time an example may run before the still-running notice. */
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeneratedModule {
  source: string;
  lineMap: LineMap;
  blocks: BlockSpan[];
  examples: ExampleSpan[];
}

export interface GenerateOptions {
  filePath: string;
  /** Markdown lines of examples whose statement/expression split comes from esbuild. */
  oracle?: ReadonlySet<number>;
}

interface Classified {
  block: CodeBlock;
  info: FenceInfo;
  span: BlockSpan;
}

function spanOf(block: CodeBlock): BlockSpan {
  return {
    fence: block.line - 1,
    start: block.line,
    end: block.line + block.content.split("\n").length - 1,
    info: block.info,
  };
}

function classify(markdown: string, fileName: string): Classified[] {
  const blocks = parseCodeBlocks(markdown);
  const spans = blocks.map(spanOf);
  const fail = (line: number, problem: string): never => {
    throw new DoctestSyntaxError(formatSyntaxError({ fileName, markdown, line, problem, blocks: spans }));
  };
  for (const fence of findIndentedFences(markdown)) {
    let executable = true;
    try {
      executable = parseFenceInfo(fence.info).kind !== "prose";
    } catch (e) {
      if (!(e instanceof FenceInfoError)) throw e;
    }
    if (executable) {
      fail(fence.line, "this fence is indented, so doctest does not run it. Move it to column 0 " +
        "(out of the list item or quote), or give it a non-code language such as ```text.");
    }
  }
  return blocks.map((block, i) => {
    const span = spans[i] ?? spanOf(block);
    try {
      return { block, info: parseFenceInfo(block.info), span };
    } catch (e) {
      if (e instanceof FenceInfoError) return fail(span.fence, e.message);
      throw e;
    }
  });
}

/** The module source plus the maps the loader needs to report errors. */
export function generateTestModule(markdown: string, options: GenerateOptions): GeneratedModule {
  const { filePath } = options;
  const fileName = basename(filePath);
  const classified = classify(markdown, fileName);
  const blocks = classified.map((c) => c.span);
  const setups = classified.filter((c) => c.info.kind === "setup");
  const setupText = setups.map((c) => c.block.content).join("\n");
  const out: GenLine[] = moduleHeader({ declares: (name) => declaresName(setupText, name) });

  for (const { block } of setups) {
    out.push(gen(`// --- setup (${fileName}:${block.line}) ---`));
    out.push(...verbatim(block.content, { md: block.line, indent: "" }));
  }
  for (const { block } of classified.filter((c) => c.info.kind === "teardown")) {
    out.push(...teardownRegistration(verbatim(block.content, { md: block.line, indent: "    " })));
  }

  const examples: ExampleSpan[] = [];
  const oracle = options.oracle ?? new Set<number>();
  let open: { header: GenLine[]; body: GenLine[]; teardowns: GenLine[][] } | null = null;
  let pendingCleanup: GenLine[][] = [];
  let tests = 0;

  const closeTest = (): void => {
    if (!open) return;
    out.push(...open.header);
    for (const lines of open.teardowns) out.push(...teardownRegistration(lines, "__doctest_t"));
    out.push(...open.body, gen("  __doctest_watch.done();"), gen("});"));
    open = null;
  };

  for (const { block, info, span } of classified) {
    if (info.kind === "setup" || info.kind === "teardown" || info.kind === "prose") continue;
    const content = verbatim(block.content, { md: block.line, indent: "    " });
    if (info.kind === "cleanup" || info.kind === "continue-cleanup") {
      if (open) open.teardowns.push(content);
      else pendingCleanup.push(content);
      continue;
    }
    const parsed = parseExamples(block.content);
    if (parsed.length === 0) continue;
    const ctx = { filePath, blockLine: block.line, oracle, timeoutMs: info.timeoutMs ?? DEFAULT_TIMEOUT_MS, spans: examples };
    if (info.kind === "continue") {
      if (!open) {
        throw new DoctestSyntaxError(formatSyntaxError({
          fileName, markdown, line: span.fence, blocks,
          problem: "a ```ts continue block has no open test to continue — it would silently become a new test. " +
            "Make the first example block a plain ```ts block.",
        }));
      }
      open.body.push(gen(`  // --- continue (${fileName}:${block.line}) ---`), ...emitExamples(parsed, ctx));
      continue;
    }
    closeTest();
    const labelled = parsed.find((ex) => ex.expected !== null) ?? parsed[0];
    const label = (labelled?.expression.split("\n")[0] ?? "").trim();
    open = {
      header: testHeader({ name: `${fileName}:${block.line} — ${label}`, declares: (name) => declaresName(setupText, name) }),
      body: emitExamples(parsed, ctx),
      teardowns: pendingCleanup,
    };
    pendingCleanup = [];
    tests++;
  }
  closeTest();

  if (tests === 0) {
    throw new DoctestSyntaxError(formatSyntaxError({
      fileName, markdown, line: 1, blocks,
      problem: "no examples found: a doctest needs at least one ```ts block with code to run.",
    }));
  }
  return { source: out.map((l) => l.text).join("\n"), lineMap: buildLineMap(out), blocks, examples };
}

/** The generated module source. Kept for callers of the original API. */
export function generateTestSource(markdown: string, filePath: string): string {
  return generateTestModule(markdown, { filePath }).source;
}
