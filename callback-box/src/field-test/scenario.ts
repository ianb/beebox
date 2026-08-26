/**
 * Field-test scenario loader (`docs/plans/agent-field-tests.md`, Track 4).
 *
 * A scenario is a directory under `callback-box/field-tests/<name>/`:
 *
 *   scenario.yaml — start time, models, the ordered checklist
 *   persona.md    — who the operator is, read verbatim into the prompt
 *   assets/       — "files on your computer" the briefs may reference
 *   checks/       — hard-assert scripts the harness runs; the operator never sees them
 *   emails/       — inbound-mail fixtures (semantics land with Track 1)
 *
 * Everything a run needs from a scenario is resolved HERE, at load, and fails
 * closed: a scenario that names a check script, an asset, or an email fixture
 * that does not exist is rejected before a run spends an Opus operator on it.
 * That is the whole point of loading eagerly — the alternative is discovering
 * a typo'd filename at minute forty of a run.
 *
 * The `cb scenario` loader (`src/scenario/loader.ts`) is the shape prior art —
 * Zod at the boundary, a directory per fixture — but nothing is shared with it:
 * that harness's step model is the opposite of this tier's goals-not-steps
 * briefs, and its scenarios live outside the repo.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { fileExists } from "../lib/file-exists.js";
import { errorMessage } from "../lib/error-guards.js";
import { assertNever, invariant } from "../lib/invariant.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { modelTier, resolveProcedureModel, isProcedureModelName } from "../shared/agent-models.js";
import { normalizeModelId } from "../shared/model-ids.js";

/** Both models default here, not at a call site: a run that did not say what it
 *  tested is not comparable to last week's run, so the default is part of the
 *  format rather than an argument the harness may forget to pass. */
const DEFAULT_MODEL = "opus";

/**
 * Resolve a scenario's `models.chat` to a concrete model id.
 *
 * Scenarios name a tier (`opus`, `balanced`) — which the operator's own SDK
 * call accepts as an alias, but the box model policy does not: `agentModel`
 * holds an id, and a tier name there is rejected on read, leaving the run
 * unpinned while the report claims otherwise. Resolving here keeps `models.chat`
 * one thing everywhere: what the box was actually set to.
 *
 * Resolved against Claude because the harness's operator is Claude; a codex box
 * translates the id to its own same-tier model when it reads the policy
 * (`core/model-policy.ts`), so nothing is lost by picking a family here.
 */
function resolveScenarioChatModel(model: string): string | null {
  if (isProcedureModelName(model)) return resolveProcedureModel("claude", model);
  return modelTier(normalizeModelId(model)) === null ? null : normalizeModelId(model);
}

/** Ids name checkpoint tags, check scripts and report rows — kebab-case keeps
 *  all three legible and shell-safe. */
const ID_PATTERN = /^[\da-z]+(?:-[\da-z]+)*$/;

/**
 * An `assets/…` mention inside a brief. The left boundary keeps `myassets/x`
 * out; trailing sentence punctuation and markdown wrappers are stripped by the
 * caller, not matched here.
 *
 * The character class deliberately excludes spaces, which makes an asset
 * filename containing one unreferenceable from a brief. That is the intended
 * trade: a space would make the reference unquotable in a shell and ambiguous
 * in prose, so asset filenames are hyphenated by convention.
 */
const ASSET_REFERENCE_PATTERN = /(?<![\w./-])assets\/[\w./-]+/g;
const TRAILING_PUNCTUATION = /[!"'),.:;?\]`]+$/;

const PreActionSchema = z.union([
  z.strictObject({ "advance-days": z.number().int().positive() }),
  z.strictObject({ "inject-email": z.string().min(1) }),
]);

const ChecklistItemSchema = z.strictObject({
  id: z.string().regex(ID_PATTERN, "kebab-case id (lowercase letters, digits, single hyphens)"),
  brief: z.string().min(1),
  pre: z.array(PreActionSchema).optional(),
  cleanup: z.enum(["keep", "commit", "reset"]).optional(),
  checks: z.array(z.string().min(1)).optional(),
  questions: z.array(z.string().min(1)).optional(),
});

const ScenarioFileSchema = z.strictObject({
  name: z.string().regex(ID_PATTERN, "kebab-case scenario name (lowercase letters, digits, single hyphens)"),
  description: z.string().min(1),
  startTime: z.iso.datetime({ offset: true }),
  models: z
    .strictObject({ operator: z.string().min(1).optional(), chat: z.string().min(1).optional() })
    .optional(),
  checklist: z.array(ChecklistItemSchema).min(1),
});

/** A `pre` action, normalized out of its single-key YAML mapping. */
export type FieldPreAction =
  | { type: "advance-days"; days: number }
  | { type: "inject-email"; fixture: string };

/** Cleanup applied after an item: keep the residue, checkpoint it, or rewind. */
export type FieldCleanupPolicy = "keep" | "commit" | "reset";

export interface FieldChecklistItem {
  id: string;
  /** Persona-voiced markdown, sent to the operator verbatim. Goals, not steps. */
  brief: string;
  pre: FieldPreAction[];
  cleanup: FieldCleanupPolicy;
  /** Script filenames as written, relative to the scenario's `checks/`. */
  checks: string[];
  /** Extra debrief questions appended to the standard set. */
  questions: string[];
}

export interface FieldScenario {
  /** Absolute path to the scenario directory. */
  dir: string;
  name: string;
  description: string;
  /** ISO timestamp the run's `CB_TIME` starts at. */
  startTime: string;
  models: { operator: string; chat: string };
  /** Verbatim `persona.md` — prompt layer 1. */
  persona: string;
  /** Absolute `assets/` path, handed to the operator as "your files". */
  assetsDir: string;
  /** Absolute `checks/` path; item `checks` are filenames inside it. */
  checksDir: string;
  /** Absolute `emails/` path; `inject-email` fixtures are `<name>.yaml` inside it. */
  emailsDir: string;
  checklist: FieldChecklistItem[];
}

/** The scenario file is unreadable, unparseable, or does not match the format. */
class FieldScenarioParseError extends Error {
  constructor({ dir, detail }: { dir: string; detail: string }) {
    super(`Field scenario ${dir}: ${detail}`);
    this.name = "FieldScenarioParseError";
  }
}

/** The scenario parses but does not hang together — a duplicate id, or a file
 *  it names that is not there. */
class FieldScenarioInvalidError extends Error {
  readonly problems: string[];
  constructor({ dir, problems }: { dir: string; problems: string[] }) {
    super(`Field scenario ${dir}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "FieldScenarioInvalidError";
    this.problems = problems;
  }
}

/** Absolute path to a scenario checked into this package's `field-tests/`.
 *  The name is a single kebab-case segment — a caller handing this a path
 *  (`../something`) would silently address a directory outside the corpus,
 *  which is a caller bug, not an input to tolerate. */
export function fieldScenarioDir(name: string): string {
  invariant(ID_PATTERN.test(name), `field scenario name must be kebab-case, got "${name}"`);
  return path.join(PACKAGE_ROOT, "field-tests", name);
}

function normalizePreAction(action: z.infer<typeof PreActionSchema>): FieldPreAction {
  if ("advance-days" in action) return { type: "advance-days", days: action["advance-days"] };
  if ("inject-email" in action) return { type: "inject-email", fixture: action["inject-email"] };
  return assertNever(action);
}

/** Every `assets/…` path a brief mentions, de-duplicated, punctuation trimmed. */
function assetReferences(brief: string): string[] {
  const refs = new Set<string>();
  for (const match of brief.matchAll(ASSET_REFERENCE_PATTERN)) {
    const ref = match[0].replace(TRAILING_PUNCTUATION, "");
    if (ref !== "assets/") refs.add(ref);
  }
  return [...refs].toSorted();
}

async function readScenarioFile(dir: string): Promise<z.infer<typeof ScenarioFileSchema>> {
  const yamlPath = path.join(dir, "scenario.yaml");
  let text: string;
  try {
    text = await readFile(yamlPath, "utf-8");
  } catch (e) {
    throw new FieldScenarioParseError({ dir, detail: `cannot read scenario.yaml (${errorMessage(e)})` });
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    throw new FieldScenarioParseError({ dir, detail: `scenario.yaml is not valid YAML (${errorMessage(e)})` });
  }
  const result = ScenarioFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new FieldScenarioParseError({ dir, detail: `scenario.yaml does not match the format — ${issues}` });
  }
  return result.data;
}

async function readPersona(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, "persona.md"), "utf-8");
  } catch (e) {
    throw new FieldScenarioInvalidError({
      dir,
      problems: [`persona.md is required and could not be read (${errorMessage(e)})`],
    });
  }
}

/**
 * Collect every cross-file problem in one pass rather than throwing on the
 * first: a scenario author fixing one typo at a time, one load at a time, is
 * the slow loop this tier can least afford.
 */
async function referenceProblems(
  dir: string,
  checklist: readonly FieldChecklistItem[],
): Promise<string[]> {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of checklist) {
    if (seen.has(item.id)) problems.push(`duplicate checklist id "${item.id}"`);
    seen.add(item.id);

    for (const check of item.checks) {
      if (path.basename(check) !== check) {
        problems.push(`${item.id}: check "${check}" must be a bare filename in checks/`);
        continue;
      }
      if (!(await fileExists(path.join(dir, "checks", check)))) {
        problems.push(`${item.id}: check script checks/${check} does not exist`);
      }
    }

    const assetsRoot = path.join(dir, "assets");
    for (const ref of assetReferences(item.brief)) {
      const target = path.resolve(dir, ref);
      // `assets/../persona.md` resolves inside the scenario but outside the
      // corpus; the operator is told `assets/` is everything it has, so a
      // reference that leaves it is a lie in the brief, not a missing file.
      if (target !== assetsRoot && !target.startsWith(assetsRoot + path.sep)) {
        problems.push(`${item.id}: brief references ${ref}, which escapes assets/`);
        continue;
      }
      if (!(await fileExists(target))) {
        problems.push(`${item.id}: brief references ${ref}, which does not exist`);
      }
    }

    for (const action of item.pre) {
      // Only the *existence* of the fixture is checked here; its shape is
      // Track 1's schema, which owns the fake-Gmail state format.
      if (action.type !== "inject-email") continue;
      if (!(await fileExists(path.join(dir, "emails", `${action.fixture}.yaml`)))) {
        problems.push(`${item.id}: pre inject-email names emails/${action.fixture}.yaml, which does not exist`);
      }
    }
  }
  return problems;
}

/**
 * Load and fully validate the scenario directory at `dir`.
 *
 * Throws `FieldScenarioParseError` for a missing/malformed/off-format
 * `scenario.yaml` and `FieldScenarioInvalidError` for anything the file says
 * that the directory does not back up.
 */
export async function loadFieldScenario(dir: string): Promise<FieldScenario> {
  const absoluteDir = path.resolve(dir);
  const file = await readScenarioFile(absoluteDir);
  const persona = await readPersona(absoluteDir);

  const checklist: FieldChecklistItem[] = file.checklist.map((item) => ({
    id: item.id,
    brief: item.brief,
    pre: (item.pre ?? []).map(normalizePreAction),
    cleanup: item.cleanup ?? "keep",
    checks: item.checks ?? [],
    questions: item.questions ?? [],
  }));

  const problems = await referenceProblems(absoluteDir, checklist);
  const chatModel = resolveScenarioChatModel(file.models?.chat ?? DEFAULT_MODEL);
  if (chatModel === null) {
    problems.push(`models.chat: "${file.models?.chat ?? DEFAULT_MODEL}" is not a model tier or a known model id`);
  }
  if (problems.length > 0) throw new FieldScenarioInvalidError({ dir: absoluteDir, problems });

  return {
    dir: absoluteDir,
    name: file.name,
    description: file.description,
    startTime: file.startTime,
    models: {
      operator: file.models?.operator ?? DEFAULT_MODEL,
      chat: chatModel ?? DEFAULT_MODEL,
    },
    persona,
    assetsDir: path.join(absoluteDir, "assets"),
    checksDir: path.join(absoluteDir, "checks"),
    emailsDir: path.join(absoluteDir, "emails"),
    checklist,
  };
}
