/**
 * `engine-link-spec-2026-10` decision: given a box's `package.json` text, what
 * to write.
 *
 * The effective engine spec is `pnpm.overrides.beebox` when present (worktree
 * clones set both), else the `beebox` dependency. Only a `link:` spec is
 * machine-local and converted; any other spec (a `file:` tarball, a semver
 * range) is an explicit pin and left alone. The runner also treats a link
 * whose target is inside the box as a pin. Pure, so the test reaches every
 * case without a box.
 */

import { ENGINE_LINK_SPEC } from "../../../core/box/engine-link.js";
import { isRecord } from "../../../shared/is-record.js";

export type EngineSpecPlan =
  | { kind: "already-portable" }
  | { kind: "pinned"; spec: string }
  /** `linkTarget` is the old link's path, as written (relative to the box root when relative);
   * null when only a leftover override goes and the link must already exist. */
  | { kind: "convert"; linkTarget: string | null; packageJson: string }
  | { kind: "refuse"; reason: string };

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"] as const;

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch (_e) {
    // The caller reports the file as unparseable; the parser's message adds nothing it can act on.
    return null;
  }
}

/** `pkg.pnpm.overrides` without `beebox`, dropping containers the removal empties. */
function withoutOverride(pkg: Record<string, unknown>): Record<string, unknown> {
  const pnpm = pkg["pnpm"];
  if (!isRecord(pnpm) || !isRecord(pnpm["overrides"]) || !("beebox" in pnpm["overrides"])) return pkg;
  const { beebox: _dropped, ...overrides } = pnpm["overrides"];
  const { overrides: _old, ...restPnpm } = pnpm;
  const nextPnpm = Object.keys(overrides).length > 0 ? { ...restPnpm, overrides } : restPnpm;
  const { pnpm: _oldPnpm, ...rest } = pkg;
  return Object.keys(nextPnpm).length > 0 ? { ...pkg, pnpm: nextPnpm } : rest;
}

export function planEngineSpec(packageJson: string): EngineSpecPlan {
  const pkg = parseObject(packageJson);
  if (pkg === null) return { kind: "refuse", reason: "package.json is not a JSON object; fix it by hand, then rerun." };
  const declared = DEPENDENCY_FIELDS.flatMap((field) => {
    const deps = pkg[field];
    return isRecord(deps) && typeof deps["beebox"] === "string" ? [{ field, deps, spec: deps["beebox"] }] : [];
  })[0];
  if (declared === undefined) return { kind: "refuse", reason: "package.json declares no \"beebox\" dependency; add one by hand, then rerun." };
  const { field, deps } = declared;
  const pnpm = pkg["pnpm"];
  const override = isRecord(pnpm) && isRecord(pnpm["overrides"]) ? pnpm["overrides"]["beebox"] : undefined;
  const effective = typeof override === "string" ? override : declared.spec;
  if (effective === ENGINE_LINK_SPEC && override === undefined) return { kind: "already-portable" };
  if (!effective.startsWith("link:")) return { kind: "pinned", spec: effective };
  const next = withoutOverride({ ...pkg, [field]: { ...deps, beebox: ENGINE_LINK_SPEC } });
  const linkTarget = effective === ENGINE_LINK_SPEC ? null : effective.slice("link:".length);
  return { kind: "convert", linkTarget, packageJson: JSON.stringify(next, null, 2) + "\n" };
}

/**
 * Whether a pnpm (v9) lockfile already records the portable spec: the root
 * importer's `beebox` specifier and version are `link:.beebox/engine` and no top-level
 * `overrides:` entry names `beebox`. A rerun after a failed refresh finds the
 * manifest converted but this false, and refreshes before calling it done.
 */
export function lockfileIsPortable(lockfile: string): boolean {
  const importer = /\n {6}beebox:\n {8}specifier: (\S+)\n {8}version: (\S+)/.exec(lockfile);
  const overridden = /^overrides:\n(?: {2}\S.*\n)*? {2}beebox:/m.test(lockfile);
  return importer?.[1] === ENGINE_LINK_SPEC && importer[2] === ENGINE_LINK_SPEC && !overridden;
}
