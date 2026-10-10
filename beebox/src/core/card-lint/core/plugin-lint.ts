/**
 * Plugin lint dispatch (`docs/plans/plugins.md`, Track 3): every active
 * plugin's `lintCards` hook runs over each card, with a `LintContext` built
 * from the engine's ref resolver and containment helpers so a plugin never
 * imports them. The hooks' issues are warnings in the card's lint result,
 * like the engine's own box-aware checks. An invalid `plugins` entry in
 * `_config/box.json` is reported once per card as a warning naming it.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LintContext } from "../../../cards/plugin-definition.js";
import type { LintIssue } from "../../../exports/cards.js";
import { containWithinBox, realpathContained } from "../../../lib/box-containment.js";
import { isCardFile } from "../../../lib/paths/core.js";
import { activePluginNames } from "../../box/config.js";
import { describeInvalidPluginEntries } from "../../plugins/active.js";
import { resolveContainedRef, resolveRefExists } from "../../ref-exists.js";
import { pluginByName } from "../../../plugins.js";

/** The box-aware helpers a plugin's hook gets, each failing closed on a path that leaves the box. */
export function makeLintContext(boxRoot: string): LintContext {
  return {
    boxRoot,
    async resolveContainedRef(from, ref) {
      if (!(await resolveRefExists({ ref, fromPath: from, boxRoot }))) return null;
      const contained = resolveContainedRef({ ref, fromPath: from, boxRoot });
      if (contained === null) return null;
      const safe = await realpathContained(boxRoot, contained);
      return safe === null ? null : resolve(boxRoot, safe);
    },
    async listSiblingCards(dir) {
      if (containWithinBox(boxRoot, dir) === null) return [];
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (_e) {
        /* ignore: a card whose directory vanished mid-run has no siblings to list */
        return [];
      }
      return names.filter(isCardFile).toSorted().map((name) => join(dir, name));
    },
  };
}

/** Issues from every active plugin's `lintCards`, plus one warning per invalid `plugins` entry. */
export async function pluginLintIssues(input: {
  path: string;
  type: string;
  fields: Record<string, unknown>;
  boxRoot: string;
}): Promise<LintIssue[]> {
  const { path, type, fields, boxRoot } = input;
  const { active, invalid } = await activePluginNames(boxRoot);
  const issues: LintIssue[] = describeInvalidPluginEntries(invalid).map((problem) => ({
    type: "schema",
    severity: "warning",
    message: `_config/${problem}; the card is not linted by that plugin`,
  }));
  if (active.length === 0) return issues;
  const ctx = makeLintContext(boxRoot);
  for (const name of active) {
    const hook = pluginByName(name)?.lintCards;
    if (hook === undefined) continue;
    issues.push(...(await hook({ path, type, fields }, ctx)));
  }
  return issues;
}
