#!/usr/bin/env tsx

/**
 * Retire the `process-captures` pipeline from a deployed box.
 *
 * The capture-mode plan (docs/plans/capture-mode.md, Track 7)
 * deletes the `process-captures` procedure template and the `bbx
 * transcribe-captures` / `bbx describe-images` / `bbx assemble-timeline`
 * commands it drove — capture is now prepared in-process and delivered to
 * chat (src/core/capture/), so the old inbox procedure is dead.
 *
 * `installProcedures` (src/core/box/defaults.ts) only ever ADDS or UPDATES
 * template files — it never prunes. So every box initialized before this
 * release still carries
 *   config/procedures/process-captures.procedure.card
 * and, if a capture finalize ever ran, a one-shot trigger
 *   config/schedules/process-captures.scheduled-script.card
 * both now referencing deleted commands — a wakeup-time failure
 * (issues/2026-07-07-capture-pipeline-retries-broken-capture-forever.md is the
 * prod symptom). This migration removes them.
 *
 * **Hash-gated deletion.** The procedure card is only DELETED when its content
 * hash matches one of the stock versions we shipped ({@link
 * SHIPPED_PROCEDURE_HASHES}). This is the same canonical form
 * `installTemplateFile` compares against (src/core/install-template-file.ts):
 * for a procedure card there is no `normalize` and no `boxOwnedFields`, so the
 * canonical form is the raw UTF-8 file bytes and the hash is a plain sha256 of
 * them — see `installTemplateFile`'s `canonicalize`. A box whose copy matches a
 * shipped hash is unmodified stock we installed, safe to delete. A
 * boxholder-MODIFIED copy (hash matches nothing) is preserved, not destroyed:
 * it is parked under `config/_template-updates/` (the same review location
 * `installTemplateFile` parks diverged templates to) and removed from the
 * active `config/procedures/` dir so it stops firing the deleted commands. Git
 * history is the archive either way.
 *
 * **The trigger** is auto-generated box state (created by the old capture
 * finalize), never boxholder-authored, and always broken once the procedure is
 * gone, so it is removed whenever present.
 *
 * **Legacy inbox capture-session cards are NOT touched** — they stay as
 * ordinary cards for normal triage (see docs/migrations.md).
 *
 * Idempotent: a box with neither file (already retired, or one that never had
 * the pipeline) is a clean no-op.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/retire-process-captures.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/retire-process-captures.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { errnoCode } from "../../src/lib/error-guards.js";

const PROCEDURE_REL = "config/procedures/process-captures.procedure.card";
const TRIGGER_REL = "config/schedules/process-captures.scheduled-script.card";
/** Where a diverged copy is parked for review — matches install-template-file.ts. */
const TEMPLATE_UPDATES_DIR = "config/_template-updates";

/**
 * sha256 of the raw UTF-8 content of every `process-captures.procedure.card`
 * version we shipped that a live box could still hold. Only frontmatter-era
 * versions are enumerated — a box on an older XML version would already fail to
 * load (the XML card loader was removed) and would park here rather than delete,
 * which is the safe outcome. Recompute a hash with:
 *   git show <ref>:beebox/templates/procedures/process-captures.procedure.card | shasum -a 256
 */
export const SHIPPED_PROCEDURE_HASHES: readonly string[] = [
  // 6bd2cdfb "fix(procedures): modernize process-captures to frontmatter +
  // .attach layout" (2026-07-03) — the version live at retirement.
  "3faac11cfe5f2ee42fc58f647b4728b310181c375c30021db73e7c91eb136511",
  // 5c39d71f "feat(procedure): migrate procedure definitions from XML to
  // pure-YAML frontmatter" (2026-06-18) — the first frontmatter version.
  "61c1af66850adaed43f8b0292c1fd1cf7dbf98ff74097a42a0478fb9a591956a",
];

/** Canonical content hash for a procedure card (raw bytes; see module doc). */
export function hashProcedureCard(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

export interface RetireResult {
  /** What happened to the procedure card. */
  procedure: "deleted" | "parked" | "absent";
  /** What happened to the one-shot scheduled trigger. */
  trigger: "deleted" | "absent";
  /** Box-relative path a diverged procedure card was parked to, if any. */
  parkedAt?: string;
}

/**
 * Retire the process-captures pipeline from one box. Pure of process concerns
 * (no argv, no exit) so it doctests directly. With `apply: false` it reports
 * what it WOULD do without writing.
 */
export async function retireProcessCaptures(
  { boxRoot, apply }: { boxRoot: string; apply: boolean },
): Promise<RetireResult> {
  const procAbs = path.join(boxRoot, PROCEDURE_REL);
  const trigAbs = path.join(boxRoot, TRIGGER_REL);

  const procContent = await readFileOrNull(procAbs);
  const result: RetireResult = { procedure: "absent", trigger: "absent" };

  if (procContent !== null) {
    if (SHIPPED_PROCEDURE_HASHES.includes(hashProcedureCard(procContent))) {
      if (apply) await fs.unlink(procAbs);
      result.procedure = "deleted";
    } else {
      // Boxholder-modified: preserve their edits under the standard review
      // location and clear the active copy so the deleted commands stop being
      // referenced on wakeup.
      const parkedRel = path.join(TEMPLATE_UPDATES_DIR, PROCEDURE_REL);
      if (apply) {
        const parkedAbs = path.join(boxRoot, parkedRel);
        await fs.mkdir(path.dirname(parkedAbs), { recursive: true });
        await fs.writeFile(parkedAbs, procContent);
        await fs.unlink(procAbs);
      }
      result.procedure = "parked";
      result.parkedAt = parkedRel;
    }
  }

  if ((await readFileOrNull(trigAbs)) !== null) {
    if (apply) await fs.unlink(trigAbs);
    result.trigger = "deleted";
  }

  return result;
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error(
      `Usage: ${process.argv[1]} <boxRoot> [--apply]\n\n` +
        "Retire the process-captures pipeline: remove the stock procedure card + " +
        "trigger, or park a boxholder-modified procedure for review.",
    );
    process.exit(1);
  }
  const absRoot = path.resolve(boxRoot);
  const result = await retireProcessCaptures({ boxRoot: absRoot, apply });
  const verb = apply ? "" : " (dry run — pass --apply)";
  switch (result.procedure) {
    case "absent":
      console.log(`process-captures procedure: not present${verb}`);
      break;
    case "deleted":
      console.log(`process-captures procedure: stock version, removed${verb}`);
      break;
    case "parked":
      console.warn(
        `process-captures procedure: MODIFIED — parked to ${result.parkedAt ?? "?"} for review, ` +
          `removed from config/procedures/${verb}`,
      );
      break;
  }
  if (result.trigger === "deleted") {
    console.log(`process-captures trigger: removed${verb}`);
  }
}
