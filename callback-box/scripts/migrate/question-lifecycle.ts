/**
 * Pure per-card transform for the question-lifecycle migration (Track A,
 * `docs/implemented-plans/questions-end-to-end.md`). See `question-lifecycle-run.ts` for
 * the CLI driver (tree walk, git dates, file writes) and the module doc
 * comment there for the full description of what this migrator does.
 *
 * Kept dependency-free (no fs/git) so the transform itself is directly
 * testable: the caller resolves git dates, destination names, and scope refs
 * and passes them in as plain data.
 */

import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const QUESTIONS_DIR = "box/questions";
const RETIRED_TAG = "<agent-needs-to-know>";
const CORRECTION_REPLACEMENT = "{% correction %} block";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Split a card's frontmatter text from its body. Returns null if no frontmatter. */
function splitCard(raw: string): { fm: string; body: string } | null {
  const m = raw.match(/^---\r?\n([\S\s]*?)\r?\n---\r?\n?([\S\s]*)$/);
  if (m === null) return null;
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

export interface MigrateQuestionCardInput {
  /** Box-relative path, posix-separated, e.g. "box/inbox/scan-x.attach/unsure-008.question.card". */
  relPath: string;
  raw: string;
  /** Pre-resolved collision-safe destination (box-relative, posix), only used when relPath isn't already in box/questions/. */
  destRelPath: string;
  /** Earliest git-add ISO date for this file, or null if unknown (falls back to `fallbackAskedAt`). */
  gitAddDate: string | null;
  fallbackAskedAt: string;
  /** Box-relative ref for a `context:` entry back to the card's original scope (capture-session card if one exists, else the attach dir), only used when relocating. */
  scopeRef: string;
}

export interface MigrateQuestionCardResult {
  changed: boolean;
  content: string;
  newRelPath: string;
  relocated: boolean;
  strippedAnsweredBy: boolean;
  backfilledAskedAt: boolean;
  usedFallbackAskedAt: boolean;
  fixedDirectiveTag: boolean;
  addedContext: boolean;
  /** True when `input.type === "select"` and fewer than two options are present — reported, never auto-fixed. */
  selectOptionsViolation: boolean;
  /** Null when the card had no frontmatter / unparseable YAML — left untouched, surfaced by `cb validate` instead. */
  skippedReason: string | null;
}

function unchangedResult(
  input: MigrateQuestionCardInput,
  reason: string | null
): MigrateQuestionCardResult {
  return {
    changed: false,
    content: input.raw,
    newRelPath: input.relPath,
    relocated: false,
    strippedAnsweredBy: false,
    backfilledAskedAt: false,
    usedFallbackAskedAt: false,
    fixedDirectiveTag: false,
    addedContext: false,
    selectOptionsViolation: false,
    skippedReason: reason,
  };
}

/** Pure transform for one question card. See the module doc comment. */
export function migrateQuestionCard(input: MigrateQuestionCardInput): MigrateQuestionCardResult {
  const isCanonical = dirname(input.relPath) === QUESTIONS_DIR;

  const split = splitCard(input.raw);
  if (split === null) return unchangedResult(input, "no frontmatter block");
  let parsed: unknown;
  try {
    parsed = parseYaml(split.fm);
  } catch (_e) {
    return unchangedResult(input, "frontmatter did not parse as YAML");
  }
  if (!isRecord(parsed)) return unchangedResult(input, "frontmatter is not a mapping");

  let changed = false;

  const strippedAnsweredBy = "answered-by" in parsed;
  if (strippedAnsweredBy) {
    delete parsed["answered-by"];
    changed = true;
  }

  let backfilledAskedAt = false;
  let usedFallbackAskedAt = false;
  if (parsed["status"] === "pending" && typeof parsed["asked-at"] !== "string") {
    parsed["asked-at"] = input.gitAddDate ?? input.fallbackAskedAt;
    usedFallbackAskedAt = input.gitAddDate === null;
    backfilledAskedAt = true;
    changed = true;
  }

  let fixedDirectiveTag = false;
  const directive = parsed["directive"];
  if (typeof directive === "string" && directive.includes(RETIRED_TAG)) {
    parsed["directive"] = directive.split(RETIRED_TAG).join(CORRECTION_REPLACEMENT);
    fixedDirectiveTag = true;
    changed = true;
  }

  let addedContext = false;
  if (!isCanonical) {
    const referencesSiblingScope = [parsed["directive"], parsed["prompt"], parsed["memo"]].some(
      (v) => typeof v === "string" && v.includes(dirname(input.relPath))
    );
    if (referencesSiblingScope) {
      const context = Array.isArray(parsed["context"]) ? parsed["context"] : [];
      const alreadyPresent = context.some(
        (entry) => isRecord(entry) && entry["ref"] === input.scopeRef
      );
      if (!alreadyPresent) {
        parsed["context"] = [
          ...context,
          { ref: input.scopeRef, text: "Original attach scope this question was created in." },
        ];
        addedContext = true;
        changed = true;
      }
    }
  }

  const inputField = parsed["input"];
  const selectOptionsViolation =
    isRecord(inputField) &&
    inputField["type"] === "select" &&
    (!Array.isArray(inputField["options"]) || inputField["options"].length < 2);

  const relocated = !isCanonical;
  if (relocated) changed = true;

  if (!changed) return unchangedResult(input, null);

  const yamlText = stringifyYaml(parsed);
  return {
    changed: true,
    content: `---\n${yamlText}---\n${split.body}`,
    newRelPath: relocated ? input.destRelPath : input.relPath,
    relocated,
    strippedAnsweredBy,
    backfilledAskedAt,
    usedFallbackAskedAt,
    fixedDirectiveTag,
    addedContext,
    selectOptionsViolation,
    skippedReason: null,
  };
}
