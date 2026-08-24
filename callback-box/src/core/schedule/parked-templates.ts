/**
 * Link a scheduled task to the template files behind it, so a parked template
 * update can be reported *where the symptom shows up* rather than only in
 * `cb status`.
 *
 * The trap this closes: an upstream fix to a procedure card is parked (the box
 * copy diverged), the task that runs that procedure keeps failing on the old
 * text, and nothing connects the two. A boxholder then watches the same fix
 * ship repeatedly without ever reaching the box
 * (issues/bugs/2026-08-24-parked-template-updates-are-invisible-in-health.md).
 *
 * Two files can be behind a task, and both are template-managed:
 *   - the task's own card, `config/schedules/<name>.scheduled-script.card`
 *   - the procedure it runs, when `runs` is a `cb procedure run <name>` command
 */

/**
 * The box-relative procedure card a `runs` command executes, or null when the
 * command isn't a procedure run. Mirrors `resolveProcedurePath`
 * (`core/procedure/engine.ts`): a bare name resolves under `config/procedures/`,
 * an explicit `.procedure.card` path is used as given.
 */
export function procedureCardForRuns(runs: string): string | null {
  const match = /(?:^|[&;|]\s*)\S*\bcb\s+procedure\s+run\s+(?:--\S+\s+)*("[^"]+"|'[^']+'|\S+)/.exec(runs);
  if (!match) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  const nameOrPath = raw.replace(/^["']|["']$/g, "");
  if (nameOrPath.startsWith("-")) return null;
  if (nameOrPath.endsWith(".procedure.card")) {
    return nameOrPath.replace(/^\.?\//, "");
  }
  return `config/procedures/${nameOrPath}.procedure.card`;
}

/** The box-relative card path for a scheduled task. */
export function scheduleCardForTask(name: string): string {
  return `config/schedules/${name}.scheduled-script.card`;
}

/**
 * Which of `parked` (box-relative original paths, from
 * `listParkedTemplateUpdates`) belong to this task. Sorted, deduped, and empty
 * when nothing matches — the common case.
 */
export function parkedUpdatesForTask(
  { name, runs }: { name: string; runs?: string | undefined },
  parked: readonly string[],
): string[] {
  if (parked.length === 0) return [];
  const owned = new Set<string>([scheduleCardForTask(name)]);
  const procedure = runs === undefined ? null : procedureCardForRuns(runs);
  if (procedure !== null) owned.add(procedure);
  return parked.filter((p) => owned.has(p)).toSorted();
}
