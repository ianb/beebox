// # `bbx view check` advice: the source rules
//
// `sourceAdvice` reads one view file and reports patterns the views doc
// forbids, as `<file>:<line>` per rule. `viewSourceAdvice` runs it over a view
// and the local files it imports. The IME rule is a port of the ESLint rule
// `ime-safe-enter`; both run the preset's shared cases.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing } from "@ianbicking/tap-check/check";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imeSafeEnterCases } from "@ianbicking/personal-vibe-check/rules/ime-safe-enter.cases";
import * as ts from "../../../src/lib/typescript/syntax.js";
import { sourceAdvice } from "../../../src/core/views/advice/source.js";
import { viewSourceAdvice } from "../../../src/core/views/advice/core.js";
import { ADVICE_MESSAGES } from "../../../src/core/views/advice/types.js";
import { generateViewsDoc } from "../../../src/core/views/doc/core.js";

/** A finder for one test: each finding as `<rule> <line>`, in report order. */
function finder(t: { teardown: (fn: () => void) => void }): (source: string) => string[] {
  const parser = ts.createParser();
  t.teardown(() => { parser.close(); });
  return (source) => sourceAdvice({ ts, parse: parser.parse }, { fileName: "v.tsx", source })
    .flatMap((a) => a.where.map((w) => `${a.rule} ${w.slice("v.tsx:".length)}`));
}

void test("shared IME cases: the port agrees with the ESLint rule on every case", async (t) => {
  const findings = finder(t);
  // 24 valid and 20 invalid; each invalid case reports once.
  const wrong = [
    ...imeSafeEnterCases.valid.filter((code) => findings(code).length > 0),
    ...imeSafeEnterCases.invalid.filter((code) => findings(code).join(",") !== "enter-without-ime-check 1"),
  ];
  t.check([imeSafeEnterCases.valid.length, imeSafeEnterCases.invalid.length, wrong], [24, 20, []]);
});

void test("IME: parentheses do not change the decision", async (t) => {
  const findings = finder(t);
  t.check(findings("<input onKeyDown={(e) => { if (((e.key) === \"Enter\") && (!(e.nativeEvent.isComposing))) submit(); }} />"), []);
  t.check(findings("<input onKeyDown={((e) => { if ((e.key === \"Enter\")) submit(); })} />"), ["enter-without-ime-check 1"]);
  // A handler named by a parameter is not resolved; a shadowing const is.
  t.check(findings("function f(onKey) { return <input onKeyDown={onKey} />; }"), []);
  t.check(findings("const onKey = 1;\nfunction f() { const onKey = (e) => { if (e.key === \"Enter\") go(); }; return <input onKeyDown={onKey} />; }"), ["enter-without-ime-check 2"]);
});

void test("clickable-non-control: a plain element with onClick and no role", async (t) => {
  const findings = finder(t);
  t.check(findings(`<div>
  <div onClick={go}>a</div>
  <li onClick={go} />
  <div role="button" onClick={go}>b</div>
  <div {...props} onClick={go}>c</div>
  <button onClick={go}>d</button>
  <Card onClick={go} />
</div>`), ["clickable-non-control 2", "clickable-non-control 3"]);
});

void test("viewport-height: 100vh in any literal, and banned height classes", async (t) => {
  const findings = finder(t);
  t.check(findings(`const a = { height: "100vh" };
const b = \`calc(100vh - \${x}px)\`;
const c = <div className="md:min-h-screen p-2" />;
const d = "h-[100vh]";
const e = { height: "100dvh" };
const f = "min-h-dvh h-screenful";`), ["viewport-height 1", "viewport-height 2", "viewport-height 3", "viewport-height 4"]);
});

void test("date-string-parse: new Date of text, a name, or a property read", async (t) => {
  const findings = finder(t);
  t.check(findings(`new Date("2026-08-14");
new Date(\`\${y}-01-01\`);
new Date(iso + "T12:00");
new Date(due);
new Date(card.frontmatter.due as string);
new Date(card["due"]);
new Date(file.mtimeMs);
new Date(startMs);
new Date(1700000000000);
new Date(a - b);
new Date(Date.now());
new Date();
new Date(2026, 7, 14);`), [
    "date-string-parse 1", "date-string-parse 2", "date-string-parse 3",
    "date-string-parse 4", "date-string-parse 5", "date-string-parse 6",
  ]);
});

void test("utc-today: toISOString cut to the date", async (t) => {
  const findings = finder(t);
  t.check(findings(`const a = new Date().toISOString().slice(0, 10);
const b = d.toISOString().substring(0, 10);
const c = now.toISOString().split("T")[0];
const e = d.toISOString().slice(0, 16);
const f = s.slice(0, 10);
const g = d.toISOString();`), ["utc-today 1", "utc-today 2", "utc-today 3"]);
});

// Each message names the views.md section that states the rule.
void test("every message names its views.md section", async (t) => {
  const sections = Object.values(ADVICE_MESSAGES).map((m) => /views\.md, "([^"]+)"/.exec(m)?.[1] ?? m);
  t.check(new Set(sections), new Set(["Controls People Can Use", "Dates", "Styling"]));
  const doc = generateViewsDoc();
  t.check(["Controls People Can Use", "Dates", "Styling"].filter((s) => !doc.includes(`## ${s}\n`)), []);
});

// The guide cannot teach what the advice reports.
void test("no tsx example in the generated views doc gets source advice", async (t) => {
  const findings = finder(t);
  const blocks = [...generateViewsDoc().matchAll(/`{3}tsx\n([\S\s]*?)`{3}/g)].flatMap((m) => m[1] ?? []);
  t.check(blocks.slice(5), containing([any(String)]));
  t.check(blocks.flatMap((b) => findings(b).map((f) => `${f}: ${b.slice(0, 40)}`)), []);
});

void test("viewSourceAdvice follows local imports and merges by rule", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "advice-source-"));
  t.teardown(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "lib"));
  await writeFile(join(root, "v.tsx"), `import { when } from "./lib/dates";
export default function V() {
  return <p>{new Date(when).getDate()}</p>;
}
`);
  await writeFile(join(root, "lib", "dates.ts"), `export const when = "2026-08-14";
export const today = new Date().toISOString().slice(0, 10);
export const later = new Date(when);
`);
  t.check(await viewSourceAdvice(join(root, "v.tsx"), { root }), [
    { rule: "date-string-parse", message: ADVICE_MESSAGES["date-string-parse"], where: ["views/v.tsx:3", "views/lib/dates.ts:3"] },
    { rule: "utc-today", message: ADVICE_MESSAGES["utc-today"], where: ["views/lib/dates.ts:2"] },
  ]);
});
