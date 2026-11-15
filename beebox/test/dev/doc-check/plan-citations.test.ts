// # doc-check: code comments cite plans by name
//
// A plan path in a TypeScript or JavaScript comment is reported and rewritten
// to `plan:<name>`, which survives the plan's move to implemented-plans/.
// Strings and template literals are data and stay as written. A citation that
// names no plan is reported, and so are two plan files with one basename.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createParser } from "../../../src/lib/typescript/syntax.js";
import {
  findPlanCitationProblems, planFilesByName, planUniquenessProblems, repairPlanCitations,
} from "../../../src/dev/doc-check/plan-citations.js";

/** A parser for one test, closed when the test ends. */
function parserFor(t: { teardown: (fn: () => void) => void }): ReturnType<typeof createParser>["parse"] {
  const parser = createParser();
  t.teardown(() => { parser.close(); });
  return parser.parse;
}

const plans = planFilesByName([
  "beebox/docs/plans/README.md",
  "beebox/docs/plans/todos-ui.md",
  "beebox/docs/implemented-plans/secret-custody.md",
  "beebox/docs/implemented-plans/secret-custody.review.md",
  "beebox/docs/unimplemented-plans/parked.md",
  "beebox/src/core/x.ts",
]);

const source = `/**
 * Honest scope, per \`docs/implemented-plans/secret-custody.md\`, Track C,
 * and beebox/docs/plans/todos-ui.md:L40 (see ../../docs/implemented-plans/secret-custody.review.md).
 * Already cited: plan:parked. Mistyped: plan:secret-custodee.
 * Not a plan: docs/plans/README.md, https://example.com/docs/plans/todos-ui.md, research/plans/todos-ui.md.
 */
const fixture = "beebox/docs/plans/todos-ui.md";
const view = \`docs/implemented-plans/\${name}.md and docs/plans/todos-ui.md\`;
`;

// ## Comments are rewritten; strings, template literals, and non-plans are not
void test("Comments are rewritten; strings, template literals, and non-plans are not", async (t) => {
  const parse = parserFor(t);
  t.check(findPlanCitationProblems({ rel: "beebox/src/core/x.ts", content: source, plans, parse }), [
    { line: 2, kind: "path", token: "docs/implemented-plans/secret-custody.md", citation: "plan:secret-custody" },
    { line: 3, kind: "path", token: "beebox/docs/plans/todos-ui.md:L40", citation: "plan:todos-ui" },
    { line: 3, kind: "path", token: "../../docs/implemented-plans/secret-custody.review.md", citation: "plan:secret-custody.review" },
    { line: 4, kind: "unknown", token: "plan:secret-custodee" },
  ]);
  t.check(repairPlanCitations({ rel: "beebox/src/core/x.ts", content: source, plans, parse }).content, `/**
 * Honest scope, per \`plan:secret-custody\`, Track C,
 * and plan:todos-ui (see plan:secret-custody.review).
 * Already cited: plan:parked. Mistyped: plan:secret-custodee.
 * Not a plan: docs/plans/README.md, https://example.com/docs/plans/todos-ui.md, research/plans/todos-ui.md.
 */
const fixture = "beebox/docs/plans/todos-ui.md";
const view = \`docs/implemented-plans/\${name}.md and docs/plans/todos-ui.md\`;
`);
});

// ## A comment inside JSX counts in a .tsx file
void test("A comment inside JSX counts in a .tsx file", async (t) => {
  const parse = parserFor(t);
  const tsx = "const x = <div>{/* see docs/plans/todos-ui.md */}docs/plans/todos-ui.md</div>;\n";
  t.check(repairPlanCitations({ rel: "beebox/src/frontend/x.tsx", content: tsx, plans, parse }).content,
    "const x = <div>{/* see plan:todos-ui */}docs/plans/todos-ui.md</div>;\n");
});

// ## Two plan files with one basename are a problem
void test("Two plan files with one basename are a problem", async (t) => {
  t.check(planUniquenessProblems(planFilesByName(["beebox/docs/plans/a.md", "beebox/docs/implemented-plans/a.md", "beebox/docs/plans/b.md"])), [
    "duplicate plan basename: a.md — beebox/docs/plans/a.md, beebox/docs/implemented-plans/a.md (code cites plans by name; rename one)",
  ]);
});

// ## Comments after template and regex literals count; text that only looks like a comment does not
//
// A bare scanner loses its place after `${}` or a regex; the parser does not.
void test("Comments after template and regex literals count; text that only looks like a comment does not", async (t) => {
  const parse = parserFor(t);
  const tricky = "const a = `x ${y} // docs/plans/todos-ui.md`;\nconst r = /docs\\/plans/g; // see docs/plans/todos-ui.md\nconst s = \"/* docs/plans/todos-ui.md */\";\n";
  t.check(repairPlanCitations({ rel: "beebox/src/x.ts", content: tricky, plans, parse }).content,
    "const a = `x ${y} // docs/plans/todos-ui.md`;\nconst r = /docs\\/plans/g; // see plan:todos-ui\nconst s = \"/* docs/plans/todos-ui.md */\";\n");
  const jsx = "const x = <p>// docs/plans/todos-ui.md</p>;\n";
  t.check(repairPlanCitations({ rel: "beebox/src/x.tsx", content: jsx, plans, parse }).content, jsx);
});
