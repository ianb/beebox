/**
 * Universal raw-body Markdoc parse+validate pass for card-lint.
 *
 * Every card with a markdown body gets its body parsed with Markdoc and run
 * through `Markdoc.validate(ast, markdocConfig)` here. Before this, only
 * commentary cards got that check — via their own schema `validate` hook
 * (`src/schemas/commentary.tsx`) — so a `{% todo status="Done" %}` typo or a
 * `source-ref-xor-href` violation in an ordinary memo was silent
 * (`docs/plans/todo-annotation.md`, Track 1 chunk 2 — "a prerequisite for
 * every validation claim"). Findings surface as **warnings**, not errors:
 * this is a brand-new universal check, and an existing-box survey hasn't
 * yet justified flipping it to commit-blocking (see the plan's Track 1
 * chunk 2 note for the warning→error follow-up).
 *
 * `card-lint.ts` skips calling this for any schema that sets
 * `ownMarkdocValidation` (commentary) so a violation isn't reported twice
 * at two different severities.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { markdocConfig } from "../shared/markdoc-config.js";
import type { LintIssue } from "../cards/index.js";
import { errorMessage } from "../lib/error-guards.js";

// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node ESM
// imports resolve to the CJS bundle, which only exposes a default export.
// Destructure off it — same pattern as `body-refs.ts` / `markdoc-config.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, validate } = Markdoc;

/**
 * Parse+validate a card body against the shared Markdoc vocabulary. Returns
 * one warning-severity `LintIssue` per violation, including a parse failure
 * — reported rather than silently swallowed. This is the opposite posture
 * from `body-refs.ts`'s ref walker, which is fine losing a few ref warnings
 * to a rare parse failure because the agent "still gets the parse error via
 * the separate Markdoc.validate path"; for most card types (all but
 * commentary) THIS is that separate path, so it can't itself swallow the
 * failure.
 */
export function lintBodyMarkdoc(bodyText: string): LintIssue[] {
  if (bodyText === "") return [];
  let ast: Node;
  try {
    ast = parse(bodyText);
  } catch (e) {
    return [
      {
        type: "validation",
        severity: "warning",
        message: `Body failed to parse as Markdoc: ${errorMessage(e)}`,
      },
    ];
  }
  const tagSpans = collectTagSpans(ast);
  return validate(ast, markdocConfig)
    .filter((entry) => entry.error.level === "error" || entry.error.level === "critical")
    .map((entry) => {
      const line = lineFor(entry.lines);
      const tagName = tagNameFor(tagSpans, entry.lines);
      return {
        type: "validation" as const,
        severity: "warning" as const,
        message: `Markdoc body issue at line ${line} (${tagName}): ${entry.error.message}`,
      };
    });
}

/**
 * A tag node's authored name and source line span. Exported (alongside
 * `collectTagSpans`/`tagNameFor`) so the todo collector
 * (`core/todo/collect-body.ts`) can reuse the same "which tag does this
 * validate error belong to" attribution logic rather than re-deriving it —
 * it needs to tell a `{% todo %}`/`{% see-also %}` validation error apart
 * from an unrelated one in the same body (`docs/plans/todo-annotation.md`,
 * Track 3).
 */
export interface TagSpan {
  tag: string;
  startLine: number;
  endLine: number;
}

/**
 * Every tag node's authored name and source line span. A Markdoc
 * `ValidateError` carries only the offending node's `lines`, never its tag
 * name, so this lets a validate error be attributed back to the tag that
 * produced it (matched by exact line-span equality — see `tagNameFor`).
 */
export function collectTagSpans(ast: Node): TagSpan[] {
  const spans: TagSpan[] = [];
  for (const node of ast.walk()) {
    if (node.type !== "tag") continue;
    const lines = node.lines;
    // A `ValidateError`'s `lines` is the tag's full span, ending at its LAST
    // element (`[0,1]` for a one-line inline tag; `[0,1,2,3]` for a
    // multi-line block tag with an opening line, body lines, and a closing
    // line) — never `lines[1]`, which is only the end of a one-line span and
    // silently mis-locates every multi-line block tag (`tagNameFor` below
    // compares against this same last-element convention).
    const endLine = lines[lines.length - 1];
    if (!Array.isArray(lines) || typeof lines[0] !== "number" || typeof endLine !== "number") continue;
    spans.push({ tag: node.tag === undefined ? "unknown-tag" : node.tag, startLine: lines[0], endLine });
  }
  return spans;
}

/** Display name for the tag a validate error's line span belongs to; "body" when no tag matches (e.g. an undefined-node error at the document root). */
export function tagNameFor(spans: TagSpan[], errorLines: number[]): string {
  const start = errorLines[0];
  const end = errorLines[errorLines.length - 1];
  if (typeof start !== "number" || typeof end !== "number") return "body";
  const match = spans.find((span) => span.startLine === start && span.endLine === end);
  return match === undefined ? "body" : match.tag;
}

/** Markdoc `lines` are 0-indexed; display 1-indexed to match the body the human is reading. */
function lineFor(lines: number[]): string {
  const start = lines[0];
  return typeof start === "number" ? String(start + 1) : "?";
}
