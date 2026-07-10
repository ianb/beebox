/**
 * Apply per-item triage decisions to the filesystem.
 *
 * - `confident` / `probable`: move from `inbox/staged/` to
 *   `inbox/triaged/<category>/`. `probable` additionally drops a
 *   marker sidecar so the boxholder can review later.
 * - `guess`: move to `inbox/triaged/_unsure/` and create one question
 *   card listing the candidate categories.
 *
 * See `docs/triage.md` §5 (Confidence and the question system).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir } from "../../lib/paths.js";
import { createSelectQuestionTemplate } from "../../schemas/question.js";
import type { TriageCategory } from "./instructions.js";
import { errnoCode } from "../../lib/error-guards.js";

class TriageDestinationConflictError extends Error {
  readonly file: string;
  constructor(file: string) {
    super(`triage destination already has a file named ${file}`);
    this.name = "TriageDestinationConflictError";
    this.file = file;
  }
}

/**
 * Three confidence levels — no numbers, no `wrong`. See design doc §5.
 */
export type Confidence = "confident" | "probable" | "guess";

export interface TriageDecision {
  /** Item filename within `inbox/staged/`. */
  file: string;
  /** Chosen category name, or null for `guess` outcomes. */
  category: string | null;
  confidence: Confidence;
  /** One-line agent explanation; surfaced on `probable` review and in question prompts. */
  reason: string;
}

export interface TriageApplication {
  file: string;
  outcome: "routed" | "held";
  /** Box-relative destination directory the file ended up in. */
  destination: string;
  /** Box-relative path to the question card, if one was created. */
  questionPath?: string;
}

export interface ApplyOptions {
  boxRoot: string;
  decisions: TriageDecision[];
  /** Resolved categories, for guess-level candidate options. */
  categories: TriageCategory[];
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function moveItem(file: string, { srcDir, dstDir }: { srcDir: string; dstDir: string }): Promise<void> {
  await ensureDir(dstDir);
  const dst = path.join(dstDir, file);
  try {
    await fs.access(dst);
    throw new TriageDestinationConflictError(file);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
  }
  await fs.rename(path.join(srcDir, file), dst);
}

async function writeProbableMarker(file: string, { dstDir, reason }: { dstDir: string; reason: string }): Promise<void> {
  const markerPath = path.join(dstDir, `${file}.probable.txt`);
  await fs.writeFile(
    markerPath,
    `Triage confidence: probable\nReason: ${reason}\n`,
    "utf-8",
  );
}

/**
 * Filename-safe slug derived from the original card name, used as the
 * question card's basename so multiple guesses don't collide.
 */
function questionSlug(file: string): string {
  const base = file.replace(/\.card$/, "").replace(/\.[a-z-]+$/, "");
  return base.replace(/[^\w-]+/g, "_").slice(0, 60);
}

async function createGuessQuestion(opts: {
  boxRoot: string;
  decision: TriageDecision;
  categories: TriageCategory[];
  heldPath: string;
}): Promise<string> {
  const { boxRoot, decision, categories, heldPath } = opts;
  const questionsDir = getBoxDir(boxRoot, "questions");
  await ensureDir(questionsDir);

  const options = categories.map((c) => ({ id: c.name, label: c.name }));
  // Always include an escape hatch.
  options.push({ id: "_other", label: "None of these — write a directive" });

  const memo = [
    "The triage agent wasn't sure where this item belongs.",
    "",
    `Agent reasoning: ${decision.reason || "(none provided)"}`,
    "",
    `Held at: ${heldPath}`,
  ].join("\n");

  const xml = createSelectQuestionTemplate({
    memo,
    prompt: `Which category does ${decision.file} belong in?`,
    options,
    directive: `Move ${heldPath} from inbox/triaged/_unsure/ into inbox/triaged/<chosen-category>/. If "_other" was selected, follow the user's free-text directive instead.`,
  });

  const filename = `Triage_${questionSlug(decision.file)}.question.card`;
  const fullPath = path.join(questionsDir, filename);
  await fs.writeFile(fullPath, xml, "utf-8");
  return path.relative(boxRoot, fullPath);
}

/**
 * Apply a batch of triage decisions. Errors on one item don't roll back
 * earlier moves — each application is independent.
 */
export async function applyTriage(opts: ApplyOptions): Promise<TriageApplication[]> {
  const stagedDir = getBoxDir(opts.boxRoot, "inboxStaged");
  const triagedDir = getBoxDir(opts.boxRoot, "inboxTriaged");
  const unsureDir = getBoxDir(opts.boxRoot, "inboxTriagedUnsure");

  const categoryNames = new Set(opts.categories.map((c) => c.name));
  const applications: TriageApplication[] = [];

  for (const decision of opts.decisions) {
    if (decision.confidence === "guess" || decision.category === null) {
      await moveItem(decision.file, { srcDir: stagedDir, dstDir: unsureDir });
      const heldPath = path.relative(opts.boxRoot, path.join(unsureDir, decision.file));
      const questionPath = await createGuessQuestion({
        boxRoot: opts.boxRoot,
        decision,
        categories: opts.categories,
        heldPath,
      });
      applications.push({
        file: decision.file,
        outcome: "held",
        destination: path.relative(opts.boxRoot, unsureDir),
        questionPath,
      });
      continue;
    }

    if (!categoryNames.has(decision.category)) {
      // Unknown category — defensively treat as guess.
      await moveItem(decision.file, { srcDir: stagedDir, dstDir: unsureDir });
      const heldPath = path.relative(opts.boxRoot, path.join(unsureDir, decision.file));
      const questionPath = await createGuessQuestion({
        boxRoot: opts.boxRoot,
        decision: {
          ...decision,
          confidence: "guess",
          reason: `Agent suggested unknown category "${decision.category}". ${decision.reason}`,
        },
        categories: opts.categories,
        heldPath,
      });
      applications.push({
        file: decision.file,
        outcome: "held",
        destination: path.relative(opts.boxRoot, unsureDir),
        questionPath,
      });
      continue;
    }

    const dstDir = path.join(triagedDir, decision.category);
    await moveItem(decision.file, { srcDir: stagedDir, dstDir });
    if (decision.confidence === "probable") {
      await writeProbableMarker(decision.file, { dstDir, reason: decision.reason });
    }
    applications.push({
      file: decision.file,
      outcome: "routed",
      destination: path.relative(opts.boxRoot, dstDir),
    });
  }

  return applications;
}
