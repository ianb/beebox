/**
 * The generated code around the author's code: the module header (helpers
 * every doctest gets), each test's header, and teardown registration.
 *
 * Runner-internal names carry a `__doctest_` prefix so they cannot collide
 * with the author's. The two names authors use on purpose — `t` (the tap
 * test) and `print` — are bound per test only when setup does not declare
 * the same name; a setup `const t = await makeTestServer()` used to be
 * shadowed by tap's test object and failed as "t2.request is not a function".
 */

import type { GenLine } from "./line-map.ts";
import { gen } from "./doctest-emit.ts";

/** The lines of some code that start at brace depth 0 (outside any function or block). */
function topLevelLines(code: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (const line of code.split("\n")) {
    if (depth === 0 && quote === null) out.push(line);
    for (let i = 0; i < line.length; i++) {
      const c = line[i] ?? "";
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") break;
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("({[".includes(c)) depth++;
      else if (")}]".includes(c)) depth = Math.max(0, depth - 1);
    }
    if (quote !== "`") quote = null;
  }
  return out;
}

/**
 * Whether setup code declares a name at module scope. A textual check over
 * top-level lines only; a declaration inside a helper function does not
 * count. A miss leaves the older behaviour (the runner's binding shadows the
 * author's).
 */
export function declaresName(setupText: string, name: string): boolean {
  const n = name.replace(/\$/g, "\\$");
  const patterns = [
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var|function|class|async\\s+function)\\s+${n}\\b`),
    new RegExp(`^\\s*import\\s+${n}\\b`),
    new RegExp(`^\\s*import\\s[^;]*(?:[\\s{,]${n}\\s*[,}]|\\bas\\s+${n}\\b)`),
    new RegExp(`^\\s*(?:const|let|var)\\s*[{[][^=]*?(?:[\\s{,[]${n}\\s*[,}\\]]|:\\s*${n}\\s*[,}])`),
  ];
  const lines = topLevelLines(setupText);
  return lines.some((line) => patterns.some((re) => re.test(line)));
}

const EVENTUALLY = [
  "async function __doctest_eventually(fn, opts = {}) {",
  "  const { label = 'condition', timeoutMs = 5000, intervalMs = 25 } = opts;",
  "  const deadline = Date.now() + timeoutMs;",
  "  for (;;) {",
  "    let value; let error;",
  "    try { value = await fn(); } catch (e) { error = e; }",
  "    if (!error && value !== false && value !== undefined && value !== null) return value;",
  "    if (Date.now() >= deadline) {",
  "      const last = error ? `error: ${error?.message ?? error}` : `value: ${JSON.stringify(value)}`;",
  "      const err = new Error(`${label} was not true after ${timeoutMs}ms; last ${last}`);",
  "      err.name = 'EventuallyTimeout';",
  "      if (error) err.cause = error;",
  "      throw err;",
  "    }",
  "    await new Promise((r) => setTimeout(r, intervalMs));",
  "  }",
  "}",
];

// A per-test watch: before each example the test marks which example is
// running; if one is still running after its timeout, a TAP comment names it.
// The test is not ended — ending it would start its teardowns while the body
// still runs. The file-level timeout still ends a real hang, now preceded by
// the name of the example that hung.
const WATCH = [
  "function __doctest_makeWatch(t) {",
  "  let timer = null;",
  "  const done = () => { if (timer) clearTimeout(timer); timer = null; };",
  "  const mark = (where, ms) => {",
  "    done();",
  "    timer = setTimeout(() => t.comment(`still running after ${ms / 1000}s: ${where}`), ms);",
  "    timer.unref?.();",
  "  };",
  "  return { mark, done };",
  "}",
];

export function moduleHeader(opts: { declares: (name: string) => boolean }): GenLine[] {
  const lines = [
    'import { test as __doctest_test, t as __doctest_root } from "tap";',
    // Trailing newlines are trimmed from string results: expected values in a
    // code block cannot express them.
    "function __doctest_trim(v) { return typeof v === 'string' ? v.replace(/\\n+$/, '') : v; }",
    // print() lines drain into the next assertion, joined with its result.
    "function __doctest_withPrints(prints, value) {",
    "  if (prints.length === 0) return __doctest_trim(value);",
    "  const lines = prints.splice(0);",
    "  if (value !== undefined && value !== null) {",
    "    if (typeof value === 'string') { lines.push(value.replace(/\\n+$/, '')); }",
    "    else { try { lines.push(JSON.stringify(value, null, 2)); } catch { lines.push(String(value)); } }",
    "  }",
    "  return lines.join('\\n');",
    "}",
    ...EVENTUALLY,
    ...WATCH,
  ];
  if (!opts.declares("eventually")) lines.push("const eventually = __doctest_eventually;");
  return lines.map(gen);
}

export function testHeader(opts: { name: string; fence: number; declares: (name: string) => boolean }): GenLine[] {
  const lines = [
    `__doctest_test(${JSON.stringify(opts.name)}, async (__doctest_t) => {`,
    "  const __doctest_prints = [];",
    "  const __doctest_watch = __doctest_makeWatch(__doctest_t);",
    "  __doctest_t.teardown(() => __doctest_watch.done());",
  ];
  if (!opts.declares("t")) lines.push("  const t = __doctest_t;");
  if (!opts.declares("print")) lines.push("  const print = (s) => void __doctest_prints.push(String(s));");
  // The registration line maps to the block's fence, so tap's location for
  // the test as a whole names the block rather than a nearby line.
  return lines.map((text, i) => (i === 0 ? { text, md: opts.fence, col: 0 } : gen(text)));
}

/**
 * Register a cleanup (per test) or teardown (per file) block. Registration is
 * emitted ahead of the test body, so a failing example cannot skip it.
 *
 * tap runs teardowns LIFO and abandons the rest once one throws, so one
 * cleanup that cannot run would skip every earlier cleanup and leak exactly
 * the handles they exist to release. That is reachable: a cleanup whose
 * `continue` block never ran references a `const` still in its temporal dead
 * zone. The failure is reported instead — visible, and it strands nothing.
 */
export function teardownRegistration(body: GenLine[], owner = "__doctest_root"): GenLine[] {
  const perTest = owner !== "__doctest_root";
  const report = perTest
    // console.error names it (tap has usually closed the test's plan by
    // teardown time, so its own diagnostic degrades to a generic "assertion
    // after Promise resolution"); t.error still makes the exit non-zero.
    ? [
        '      console.error("doctest cleanup block failed:", __doctest_cleanupError);',
        `      ${owner}.error(__doctest_cleanupError, "doctest cleanup block failed");`,
      ]
    : [
        '      console.error("doctest teardown block failed:", __doctest_cleanupError);',
        "      process.exitCode = 1;",
      ];
  return [
    gen(`  ${owner}.teardown(async () => {`),
    gen("    try {"),
    ...body,
    gen("    } catch (__doctest_cleanupError) {"),
    ...report.map(gen),
    gen("    }"),
    gen("  });"),
  ];
}
