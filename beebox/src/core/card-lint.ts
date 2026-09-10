/**
 * Lint dispatcher for markdown-frontmatter cards.
 *
 * For each card path, peeks at the frontmatter to decide which path to
 * take: cards declaring a filename `type` that matches a registered
 * CardSchema are validated through parseCardText (Zod schema check); a
 * `.card` with no matching schema is surfaced as a non-blocking warning.
 * Results are merged into a single LintSummary so callers (e.g. bbx validate)
 * can format them uniformly.
 *
 * Ref-checking walks three sides: `extractRefs` (src/cards) over parsed
 * frontmatter fields, `extractBodyRefs` over the Markdoc body, and
 * `extractBodyLinks` over the body's inline markdown links/images. All three
 * yield `{path, ref}` entries with the same shape; all are surfaced as
 * warnings (not errors) so legitimate moves don't block commits.
 *
 * Type-specific, self-contained validation (rules Zod can't express, e.g.
 * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
 * it lives on each schema as a `validate` hook, invoked generically below. The
 * one rule that cannot be self-contained — a chat husk's `session` must be
 * unique across `_content/chat/**` — is dispatched from here against a per-run
 * index (`lint-chat-duplicates.ts`).
 * The ref-existence walk stays here because it is box-aware (resolves refs
 * against the box root), which the self-contained hook deliberately lacks.
 *
 * Every card with a markdown body also gets a universal Markdoc parse+
 * validate pass here (`body-markdoc-lint.ts`), warning-severity
 * (`docs/implemented-plans/todo-annotation.md`, Track 1 chunk 2) — skipped for a schema
 * that sets `ownMarkdocValidation` (commentary already runs it at error
 * severity via its own `validate` hook; running it again here would
 * double-report the same violation).
 */
import { relative } from "node:path";
import { isSystemCardType, systemCardLocationError } from "../shared/system-card-paths.js";


import { readFile } from "node:fs/promises";
import {
  splitCardContent,
  extractRefs,
  type CardSchema,
  type LintResult,
  type LintSummary,
  type LintIssue,
} from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { parseCardText, typeFromFilename, isRecord, type LoadCardContext } from "./card-io.js";
import { symbolIssues } from "./lint-symbol.js";
import { extractBodyLinks, extractBodyRefs } from "./body-refs.js";
import { detectDisplayFormPath, displayFormPathMessage } from "../shared/display-path.js";
import { isAttachRef } from "../shared/attach-path.js";
import { parseRef, formatRefSuffix } from "../shared/ref-path.js";
import { lintBodyMarkdoc } from "./body-markdoc-lint.js";
import { resolveRefExists } from "./ref-exists.js";
import {
  boxRelativeDoc,
  canonicalIssueMessage,
  cardRefProbe,
  planCanonicalRef,
} from "./canonical-refs.js";
import { lintLessonPlanNodeRefs, lintProgressNodeRefs } from "./lint-node-refs.js";
import { lintCardSymbolSrc, lintFigureEntry, lintLandmarkSymbolSrc } from "./lint-path-fields.js";
import { lintDuplicateChatSession } from "./lint-chat-duplicates.js";
import { findAbsoluteMachinePaths } from "../lib/absolute-path-check.js";
import { conceptMapShapeWarnings } from "../schemas/concept-map.js";
import { errorMessage } from "../lib/error-guards.js";
import { validateThemeChoice } from "../shared/card-theme.js";

export interface LintDispatchOptions {
  /**
   * Box root, used to resolve box-root-absolute (`/…`) refs during the
   * broken-ref walk (see resolveRefExists).
   */
  boxRoot: string;
  ctx: LoadCardContext;
  /**
   * Also flag refs written in the non-canonical (document-relative) form, as
   * `type: "canonical"` warnings. Off unless `bbx validate --canonical` asks for
   * it: a box carries legacy relative refs by the hundred, and reporting them
   * by default would bury the broken-ref signal (`canonical-refs.ts`).
   */
  canonical?: boolean;
}

/**
 * Lint a list of card paths, dispatching each to the appropriate
 * validator based on file shape.
 */
export async function lintCardsDispatch(
  paths: string[],
  options: LintDispatchOptions
): Promise<LintSummary> {
  const results: LintResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;

  for (const path of paths) {
    const result = await lintOne(path, options);
    results.push(result);
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
    if (result.errors.length > 0) {
      filesWithErrors++;
    }
  }

  return {
    results,
    filesChecked: paths.length,
    filesWithErrors,
    totalErrors,
    totalWarnings,
  };
}

async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    return errorResult(path, errorMessage(e));
  }

  const fileType = typeFromFilename(path);
  if (fileType !== undefined && isSystemCardType(fileType)) {
    const locationError = systemCardLocationError(fileType, relative(options.boxRoot, path));
    if (locationError !== null) return errorResult(path, locationError);
  }
  const split = splitCardContent(content);
  if (split.hasFrontmatter) {
    const type = typeFromFilename(path);
    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
      return lintFrontmatterCard({ path, content, options, type });
    }
    // Frontmatter present but no registered schema for the filename type: there
    // is no XML loader anymore. Surface a non-blocking warning so a typo'd or
    // unknown type is visible without failing the commit hook.
    return {
      path,
      errors: [],
      warnings: [
        {
          type: "schema",
          severity: "warning",
          message:
            type === undefined
              ? "card filename does not encode a type (expected Name.<type>.card)"
              : `no schema registered for card type "${type}" — card not validated`,
        },
      ],
    };
  }
  // A `.card` with no frontmatter block is malformed — every card is
  // frontmatter now (the legacy XML format is gone). Surface it as a WARNING,
  // not an error: it's visible in `bbx validate` and the PostToolUse hook, but a
  // single stray malformed card must not block the pre-commit hook and brick a
  // box's automated commit workflow (the reactor commits through this path).
  return {
    path,
    errors: [],
    warnings: [{ type: "schema", severity: "warning", message: "card has no frontmatter block" }],
  };
}

async function lintFrontmatterCard(input: {
  path: string;
  content: string;
  options: LintDispatchOptions;
  type: string;
}): Promise<LintResult> {
  const { path, content, options, type } = input;
  let parsed;
  try {
    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
  } catch (e) {
    return errorResult(path, errorMessage(e));
  }
  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
  // stale via legitimate operations (the referent got moved, archived,
  // trashed, or hand-deleted), and treating each one as a hard error
  // would have the pre-commit hook blocking every commit on any box
  // with accumulated data drift. Schema validation failures (which come
  // out of parseCardText as a thrown CardIOError → errorResult above)
  // remain errors and do block.
  const frontmatterRefs = extractRefs(parsed.fields);
  const bodyField = parsed.fields["body"];
  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
  // Inline markdown links/images in the body are refs too — `bbx mv` rewrites
  // them, so validate checks them (the asymmetry meant a link broken by a
  // hand-edit or a delete stayed silent until someone clicked it).
  const bodyLinks = typeof bodyField === "string" ? extractBodyLinks(bodyField) : [];
  const warnings: LintIssue[] = [];
  const allRefs = [...frontmatterRefs, ...bodyRefs, ...bodyLinks];
  // Relative-ref deprecation (Track B, `docs/implemented-plans/one-root-box-layout.md`):
  // a document-relative ref in the card BODY is on by default, warning-only —
  // it's the form most likely to be hand-typed or copied between cards, where
  // relativity silently changes what it means. Frontmatter refs stay behind
  // `--canonical` (a box can carry them by the hundred; see canonical-refs.ts).
  warnings.push(
    ...(await canonicalWarnings({ path, refs: [...bodyRefs, ...bodyLinks], boxRoot: options.boxRoot }))
  );
  if (options.canonical === true) {
    warnings.push(...(await canonicalWarnings({ path, refs: frontmatterRefs, boxRoot: options.boxRoot })));
  }
  // Display-form leak (docs/plans/display-path-guard.subplan.md): a ref
  // written as `Config:box.json` (the boxholder's CONVERSATION vocabulary,
  // never a canonical path) is a lint ERROR naming the canonical form —
  // checked before the existence walk below, which would otherwise either
  // misclassify it as a broken ref (frontmatter/body-tag refs, never
  // filtered as external) or never see it at all (inline links / reference
  // definitions, which `body-refs.ts` no longer discards as "external").
  const displayPathErrors: LintIssue[] = [];
  for (const { path: refPath, ref } of allRefs) {
    const displayForm = detectDisplayFormPath(ref);
    if (displayForm !== null) {
      displayPathErrors.push({
        type: "display-path",
        severity: "error",
        message: `Display-form path at ${refPath}: ${displayFormPathMessage(ref, displayForm)}`,
      });
      continue;
    }
    try {
      const exists = await resolveRefExists({ ref, fromPath: path, boxRoot: options.boxRoot });
      if (!exists) {
        const suggestion = await suggestContentFormRef(ref, options.boxRoot);
        const suffix = suggestion === null ? "" : ` — did you mean \`${suggestion}\`?`;
        warnings.push({
          type: "reference",
          severity: "warning",
          message: `Broken reference at ${refPath}: ${ref} does not exist${suffix}`,
        });
      }
    } catch (e) {
      warnings.push({
        type: "reference",
        severity: "warning",
        message: `Reference at ${refPath} failed to resolve: ${errorMessage(e)}`,
      });
    }
  }
  const containsWarning = lintContainsLength(parsed.fields);
  if (containsWarning !== null) warnings.push(containsWarning);
  const symbolFindings = symbolIssues(parsed.fields);
  const themeFinding = parsed.fields["theme"] === undefined
    ? null
    : validateThemeChoice(parsed.fields["theme"], "theme").problem;
  // Every card may carry an image mark, so this one is not type-gated like the
  // per-type path fields below.
  warnings.push(...(await lintCardSymbolSrc({ path, fields: parsed.fields, boxRoot: options.boxRoot })));
  warnings.push(...symbolFindings.filter((issue) => issue.severity === "warning"));
  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
  // Universal Markdoc body validation (docs/implemented-plans/todo-annotation.md, Track 1
  // chunk 2): every card with a markdown body gets Markdoc parse+validate,
  // warning-first — except a schema that already runs its own (commentary),
  // which sets `ownMarkdocValidation` so the same violation isn't reported
  // twice at two severities.
  if (parsed.schema.ownMarkdocValidation !== true && typeof bodyField === "string") {
    warnings.push(...lintBodyMarkdoc(bodyField));
  }
  // Type-specific box-aware checks: progress entries and lesson-plan segments
  // name concept-map node ids, which can't be verified self-contained (the map
  // is in another card) nor by the generic ref walk (a node id isn't a file
  // ref). The lesson-plan adapter also warns on deferred-but-unmarked material.
  // Landmark and figure carry the two path fields NOT named `ref`
  // (`navigation.symbol.src`, `entry`), which the generic walk therefore misses
  // — see lint-path-fields.ts.
  if (type === "progress") {
    warnings.push(...(await lintProgressNodeRefs({ path, fields: parsed.fields, boxRoot: options.boxRoot })));
  } else if (type === "lesson-plan") {
    warnings.push(...(await lintLessonPlanNodeRefs({ path, fields: parsed.fields, boxRoot: options.boxRoot })));
  } else if (type === "concept-map") {
    warnings.push(...conceptMapShapeWarnings(parsed.fields));
  } else if (type === "landmark") {
    warnings.push(...(await lintLandmarkSymbolSrc({ path, fields: parsed.fields, boxRoot: options.boxRoot })));
  } else if (type === "figure") {
    warnings.push(...(await lintFigureEntry({ path, fields: parsed.fields, boxRoot: options.boxRoot })));
  }
  // Type-specific, self-contained validation (rules Zod can't express) lives on
  // the schema as its `validate` hook — see the commentary/extfile schema
  // modules. The generic ref-existence walk above stays here because it needs
  // the loader (box-aware), which the self-contained hook deliberately lacks.
  const errors: LintIssue[] = [
    ...displayPathErrors,
    ...symbolFindings.filter((issue) => issue.severity === "error"),
    ...(parsed.schema.validate ? parsed.schema.validate({ fields: parsed.fields }) : []),
    ...(themeFinding === null ? [] : [{
      type: "validation" as const,
      severity: "error" as const,
      message: themeFinding.message,
    }]),
  ];
  // The one cross-file rule: a chat husk's `session` is its identity, so two
  // husks carrying the same one is an error, not a warning — see
  // lint-chat-duplicates.ts for why it can't be a schema `validate` hook.
  if (type === "chat") {
    errors.push(...(await lintDuplicateChatSession({ path, fields: parsed.fields, boxRoot: options.boxRoot, run: options })));
  }
  // No absolute machine paths (Track B, `docs/implemented-plans/one-root-box-layout.md`):
  // a real developer home directory embedded in card content is a leak, not
  // a legitimate ref — error, unlike the ref/canonical checks above, which
  // stay warnings because broken/relative refs are routine data drift.
  for (const leaked of findAbsoluteMachinePaths(content)) {
    errors.push({
      type: "absolute-path",
      severity: "error",
      message: `Absolute machine path in card content: ${leaked} — use a box ref (leading \`/\`) or a repo-relative form, never a real machine path`,
    });
  }
  return { path, errors, warnings };
}

/**
 * Non-canonical (document-relative) refs in one card, as `type: "canonical"`
 * warnings — a type distinct from `"reference"` so they never inflate the
 * broken-ref count. Each message names the box-root form the ref should be
 * written as, so the report doubles as a preview of `--canonical --fix` — which
 * is why it consults the filesystem through the same planner the fixer uses: a
 * ref that `--fix` would REPAIR (dangling as written, resolvable from the box
 * root) says so, and one it would refuse as ambiguous says that.
 */
async function canonicalWarnings(input: {
  path: string;
  refs: Array<{ path: string; ref: string }>;
  boxRoot: string;
}): Promise<LintIssue[]> {
  const fromPath = boxRelativeDoc(input.boxRoot, input.path);
  if (fromPath === null) return [];
  const exists = cardRefProbe({ absPath: input.path, boxRoot: input.boxRoot });
  const out: LintIssue[] = [];
  for (const { path: locator, ref } of input.refs) {
    const plan = await planCanonicalRef({ ref, fromPath, kind: "card" }, { exists });
    const message = canonicalIssueMessage({ locator, ref }, plan);
    if (message !== null) out.push({ type: "canonical", severity: "warning", message });
  }
  return out;
}

/**
 * Frontmatter keys present on disk that the card's schema doesn't declare. The
 * loader strips these in memory (a drifted card still loads, renders, and
 * indexes), so they are surfaced as **warnings** — visible to `bbx validate` and
 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
 * commits or breaking load. Allowed keys are the schema's own fields (minus the
 * body field, which lives in the file body, not frontmatter), the injected
 * global fields, and `type`.
 */
function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
  const { content, schema } = input;
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return [];
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed YAML is a separate, error-level failure already surfaced by
    // parseCardText (which threw → errorResult); nothing to add here.
    return [];
  }
  if (!isRecord(fm)) return [];
  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
  const warnings: LintIssue[] = [];
  for (const key of Object.keys(fm)) {
    if (allowed.has(key)) continue;
    warnings.push({
      type: "schema",
      severity: "warning",
      message:
        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
        "it is ignored on load and should be removed",
    });
  }
  return warnings;
}

/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
const CONTAINS_MAX_CHARS = 200;

function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
  const contains = fields["contains"];
  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
  return {
    type: "contains",
    severity: "warning",
    message:
      `contains: is ${String(contains.length)} chars (budget ${String(CONTAINS_MAX_CHARS)}) — ` +
      "tighten it to one sentence stating what can be found in this card",
  };
}

/**
 * "Did you mean `/_content/<path>`?" — suggestion-on-failure for the
 * boxholder's BARE display-form vocabulary (`docs/plans/display-path-guard.subplan.md`).
 * A bare content path (`recipes/Soup.recipe.card`, no leading `/`, no
 * `<Label>:` prefix — that colon form is already a hard ERROR above) reads
 * to a boxholder as box-root-relative, but a REF's bare form is
 * document-relative instead — so a ref hand-typed in the display
 * vocabulary silently means something else and breaks. Only offered when
 * the ordinary resolution already failed (this diagnostic boundary already
 * has the box root in hand and is about to report broken anyway; probing
 * `/_content/<path>` here adds one more filesystem check, not a new one).
 * `attach/…` is excluded — a legitimate, different relative form, not the
 * display vocabulary. Suffix-preserving: a `?query`/`#fragment` on the
 * original ref survives onto the suggestion untouched.
 */
async function suggestContentFormRef(ref: string, boxRoot: string): Promise<string | null> {
  if (ref.startsWith("/") || isAttachRef(ref)) return null;
  const parsed = parseRef(ref);
  if (parsed.path === "") return null;
  const candidate = `/_content/${parsed.path}${formatRefSuffix(parsed)}`;
  const exists = await resolveRefExists({ ref: candidate, fromPath: "", boxRoot });
  return exists ? candidate : null;
}

function errorResult(path: string, message: string): LintResult {
  // The cardworks formatter prints the file path as a header above each
  // result's issues, so strip any leading "<path>: " prefix the underlying
  // error (e.g. CardIOError) included to avoid printing the path twice.
  const prefix = `${path}: `;
  const cleaned = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const issue: LintIssue = {
    type: "validation",
    severity: "error",
    message: cleaned,
  };
  return { path, errors: [issue], warnings: [] };
}
