/**
 * Canonical ordered list of box data migrations.
 *
 * `bbx migrate` reads this and the per-box manifest at
 * `_config/migrations.jsonl` to decide what to run. New migrations get
 * appended to the array; never reorder or remove existing entries —
 * the `name` is the manifest key and reordering would change which
 * migrations a box thinks it has applied.
 *
 * Every box had applied every entry below as of 2026-10-08, so each one now
 * runs the shared tombstone `src/scripts/migrate/retired.ts` (a box that never
 * applied the entry gets exit 1); the migrators that did the work are in git
 * history. A retired entry keeps its name and position.
 *
 * Adding an entry here? File the legacy-removal issue too — whatever code now
 * exists only to tolerate the pre-migration shape should be named, with
 * `file:line`, while you still know which branches those are (step 7 of
 * "Writing a new migration" in docs/cards/migrations.md). Applies to both kinds
 * below.
 *
 * A migration is one of two kinds:
 *   - script:    a deterministic migrator under `scripts/` invoked with the box
 *                root and `--apply`. Idempotent, noisy about data loss (see
 *                docs/cards/migrations.md).
 *   - procedure: an agent-applied migration — runs a procedure definition (which
 *                typically drives an agent through a checklist and gates on a
 *                `validate.shells` check). See docs/implemented-plans/agent-applied-migrations.md.
 * The two are distinguished by which field is present (`script` vs `procedure`),
 * so existing entries need no `kind` field.
 */

interface BaseMigration {
  /** Stable key recorded in the box's migrations.jsonl. */
  readonly name: string;
}

/** A deterministic migrator script. */
export interface ScriptMigration extends BaseMigration {
  /** Path to the migrator script, relative to the beebox repo root. */
  readonly script: string;
}

/** An agent-applied migration that runs a procedure definition. */
export interface ProcedureMigration extends BaseMigration {
  /** Procedure definition name (resolved from _config/procedures/). */
  readonly procedure: string;
}

export type Migration = ScriptMigration | ProcedureMigration;

/** Discriminate by the present field — no `kind` tag needed. */
export function isProcedureMigration(m: Migration): m is ProcedureMigration {
  return "procedure" in m;
}

const RETIRED = "src/scripts/migrate/retired.ts";

/**
 * A retired entry runs the tombstone, which exits 1: only a box that never
 * applied the migration reaches it, and an agent cannot repair that. The sweep
 * asks a human instead of starting a repair attempt.
 */
export function isRetiredMigration(m: Migration): boolean {
  return !isProcedureMigration(m) && m.script === RETIRED;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  { name: "attachments", script: RETIRED },
  { name: "card-frontmatter", script: RETIRED },
  { name: "email-thread", script: RETIRED },
  { name: "email-message", script: RETIRED },
  { name: "briefing", script: RETIRED },
  { name: "doc-sheet", script: RETIRED },
  { name: "file", script: RETIRED },
  { name: "image", script: RETIRED },
  { name: "audio", script: RETIRED },
  { name: "record-person", script: RETIRED },
  { name: "memo", script: RETIRED },
  { name: "misc", script: RETIRED },
  { name: "jobs", script: RETIRED },
  { name: "personality", script: RETIRED },
  { name: "scheduled-script", script: RETIRED },
  { name: "question", script: RETIRED },
  { name: "chat-thread", script: RETIRED },
  { name: "doc-to-gdoc", script: RETIRED },
  { name: "strip-type-field", script: RETIRED },
  { name: "repair-refs", script: RETIRED },
  { name: "asset-marker", script: RETIRED },
  { name: "webpage-card", script: RETIRED },
  { name: "landmark", script: RETIRED },
  { name: "recipe", script: RETIRED },
  { name: "procedure-run", script: RETIRED },
  { name: "procedure", script: RETIRED },
  { name: "guide", script: RETIRED },
  { name: "capture-session", script: RETIRED },
  { name: "delete-deprecated-cards", script: RETIRED },
  { name: "bill", script: RETIRED },
  { name: "view-card-shape", script: RETIRED },
  { name: "normalize-ref-keys", script: RETIRED },
  { name: "person-aliases", script: RETIRED },
  { name: "recipe-source-shape", script: RETIRED },
  { name: "person-contact-split", script: RETIRED },
  { name: "gsheet-rename", script: RETIRED },
  { name: "boxholder-person", script: RETIRED },
  { name: "strip-entry-timestamps", script: RETIRED },
  { name: "box-packageify", script: RETIRED },
  { name: "question-lifecycle", script: RETIRED },
  { name: "retire-process-captures", script: RETIRED },
  { name: "todo-list-to-doc", script: RETIRED },
  { name: "annex-config-2026-08", script: RETIRED },
  { name: "document-to-pdf", script: RETIRED },
  { name: "chat-model-to-box-config", script: RETIRED },
  { name: "record-measurements", script: RETIRED },
  { name: "gitignore-2026-09", script: RETIRED },
  { name: "hooks-2026-09", script: RETIRED },
  { name: "landmark-symbol", script: RETIRED },
  { name: "landmark-links-prominence", script: RETIRED },
  { name: "schedule-runs-bbx-2026-09", script: RETIRED },
  { name: "schedule-engine-verbs-2026-09", script: RETIRED },
  { name: "canonical-interface-cards", script: RETIRED },
  { name: "remaining-interface-cards", script: RETIRED },
  { name: "search-interface-card", script: RETIRED },
  { name: "trick-secret-runtime", script: RETIRED },
  { name: "v2-refs-to-v3", script: RETIRED },
  { name: "filename-attach-scope", script: RETIRED },
  { name: "retire-process-pages", script: RETIRED },
  { name: "rekey-template-versions", script: RETIRED },
  { name: "feedback-to-doc-cards", script: RETIRED },
  { name: "standard-fields-2026-09", script: RETIRED },
  { name: "status-fields-2026-09", script: RETIRED },
  { name: "source-fields-2026-09", script: RETIRED },
  { name: "annex-config-2026-10", script: RETIRED },
  { name: "publication-cards-2026-10", script: RETIRED },
  // Chat openers move from briefing cards to the place's landmark
  // (`navigation.openers`). Fails closed (exit 1, nothing written) on a list it
  // cannot move without a person's choice. See the script's plan.ts.
  { name: "briefing-openers-2026-10", script: "src/scripts/migrate/briefing-openers/run.ts" },
  // Renames every box CLAUDE.md to AGENTS.md (a non-card file), moving its
  // template-ledger entry and parked update with it, root first. Fails closed
  // (exit 1, nothing written) on two instruction files in one directory, a
  // CLAUDE.local.md, or differing ledger/park duplicates. Legacy support to
  // remove: issues/deferred/2026-10-09-retire-claude-md-box-compat.md.
  { name: "agents-md-2026-10", script: "src/scripts/migrate/agents-md/run.ts" },
  // Rewrites the retired image/silence/purpose/correction Markdoc tags: image
  // and silence become a link and plain text, a briefing's purpose moves to
  // frontmatter, its corrections to a `## Corrections` section. Fails closed
  // (exit 1, nothing written) on a tag it cannot place. See the script's plan.ts.
  { name: "body-tags-2026-10", script: "src/scripts/migrate/body-tags/run.ts" },
  // Retires the memo card type: each memo becomes a doc with the same path
  // stem, its recording moves under an audio card in the doc's attach scope,
  // and mentions of the memo file follow the rename. Fails closed (exit 1,
  // nothing written) on a field it does not map or an ambiguous recording.
  // Legacy support to remove: issues/deferred/2026-10-16-retire-memo-legacy-source-guard.md.
  { name: "retire-memo-2026-10", script: "src/scripts/migrate/retire-memo/run.ts" },
  // Replaces a machine-local `link:` beebox dependency (deploy's
  // link:/opt/beebox/beebox, a laptop checkout path, a worktree override) with
  // the portable "link:.beebox/engine" and points the gitignored .beebox/engine
  // at the old target. Leaves a pinned engine (file: tarball, semver range, a
  // link into the box) alone. Refreshes a tracked lockfile offline; a failed
  // refresh restores both files and exits 1, so it stays pending. It runs
  // before box-shape-record so that migration's package.json commit does not
  // carry the machine path again.
  // Plan: docs/implemented-plans/portable-engine-dependency.md.
  { name: "engine-link-spec-2026-10", script: "src/scripts/migrate/engine-link-spec/run.ts" },
  // Copies shapeVersion and created from the gitignored .beebox/box.json into a
  // "beebox" block in the box's tracked package.json, so a clone of the box is
  // a box. Leaves the marker on disk (and tracked where it was) so an older
  // engine still opens the box after a rollback. Fails closed (exit 1, nothing
  // written) on a marker without both fields. Legacy support to remove:
  // issues/deferred/2026-10-20-drop-box-marker-fallback.md.
  { name: "box-shape-record-2026-10", script: "src/scripts/migrate/box-shape-record/run.ts" },
  // Repairs the seeded root question card: `learning.ref` gains its leading `/`
  // (the bare form fails `bbx validate`), and a still-pending card's template
  // proposal "This box is for <what the person said>." becomes a belief
  // sentence. Touches only lines that match the stock text; an answered,
  // dismissed, or expired card keeps its proposal.
  { name: "root-question-2026-10", script: "src/scripts/migrate/root-question/run.ts" },
  // Moves each .gfolder.card's `last-sync` into the gitignored Drive state
  // (`folders` in google-drive.state.json) and deletes the key, so a mirror
  // pass that changed nothing on Drive changes no tracked file. Seeds the
  // state before writing cards; a card it cannot plan exits 2 as a leftover.
  // Plan: docs/implemented-plans/drive-sync-time-out-of-card.md.
  { name: "gfolder-last-sync-2026-10", script: "src/scripts/migrate/gfolder-last-sync/run.ts" },
];

export const MANIFEST_PATH = "_config/migrations.jsonl";

export interface ManifestEntry {
  readonly name: string;
  readonly "applied-at": string;
  /**
   * The question a partial apply (exit 2 after repair) left for the
   * boxholder. Any other pending `Migration_<name>-N` question for a recorded
   * migration is from a failed earlier run, superseded by the apply.
   */
  readonly question?: string | undefined;
}
