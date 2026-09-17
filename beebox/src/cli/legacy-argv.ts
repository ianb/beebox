/**
 * Accept the argv an OLDER engine hands this binary.
 *
 * `bbx upgrade` is the one place where one engine drives another: step 2
 * installs the new dependency, and every step after that spawns
 * `<box>/node_modules/.bin/bbx` — the NEW engine — from the OLD engine's code
 * (`cli/commands/upgrade.ts`, "old-engine/new-engine handoff"). An engine
 * built before the CLI split spawns `bbx migrate` and `bbx init`, which now
 * live under `bbx engine`.
 *
 * Without this the upgrade is not merely awkward, it is impossible: step 3
 * fails, `revertUpgrade` rolls the box back to the pre-upgrade snapshot — code
 * and data together — and the box lands back on the old engine, whose upgrade
 * code passes the same argv again. Every retry fails identically, so a box
 * that predates the split could never move off it.
 *
 * Rewriting argv, rather than registering hidden top-level aliases, keeps the
 * command tree honest: these verbs stay absent from `bbx --help` and from the
 * surface table, and `test/cli/surface.doctest.md` goes on asserting that no
 * engine verb is reachable at the top level. The compatibility lives at the
 * entry point, which is where the foreign caller actually is.
 *
 * Deletable once no box can be running a pre-split engine.
 */

/**
 * The verbs an old engine's `bbx upgrade` spawns on the new binary — exactly
 * the two `newBbxBin` call sites in `cli/commands/upgrade.ts`. This is not a
 * general alias list, and nothing should be added to it that is not a real
 * cross-version handoff.
 */
const LEGACY_HANDOFF_VERBS: readonly string[] = ["migrate", "init"];

export interface LegacyRewrite {
  /** Argv to parse — unchanged unless a handoff was recognized. */
  readonly argv: readonly string[];
  /** The verb that was rewritten, or null when nothing was. */
  readonly rewrote: string | null;
}

/**
 * Insert the `engine` namespace when argv names a legacy handoff verb.
 *
 * Only the FIRST argument is considered, so a moved verb's name appearing as a
 * value (`bbx create --title init`) is untouched. `bbx engine migrate` is
 * already correct and is left alone.
 */
export function rewriteLegacyHandoff(argv: readonly string[]): LegacyRewrite {
  const verb = argv[2];
  if (verb === undefined || !LEGACY_HANDOFF_VERBS.includes(verb)) return { argv, rewrote: null };
  return { argv: [...argv.slice(0, 2), "engine", ...argv.slice(2)], rewrote: verb };
}

/** What to tell the operator when a rewrite happens. Stderr, never stdout. */
export function legacyHandoffNotice(verb: string): string {
  return `note: \`bbx ${verb}\` moved to \`bbx engine ${verb}\`; running it there. This spelling is accepted only for an in-flight upgrade from an older engine.`;
}
