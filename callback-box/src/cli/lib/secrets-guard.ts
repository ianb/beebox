/**
 * The guards every mutating `cb secrets` subcommand shares
 * (`docs/plans/secret-custody.md`, Track 2's lifecycle-CLI bullet).
 *
 * They live here rather than in one command module because `secrets.ts` and
 * `secrets-migrate.ts` both need them and neither should import the other: the
 * agent-session refusal is the same speed bump whether the mutation is one
 * grant or a whole machine's migration, and its wording is deliberately one
 * string, not two that can drift.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SecretLifecycleError } from "../../core/secrets/errors.js";
import { secretsFilePath } from "../../core/secrets/store.js";
import { detectAgentContext } from "../../lib/agent-context.js";
import { boxSlug } from "../../lib/box-slug.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Refuse a store mutation from an agent session unless a human sanctioned it. */
export function refuseIfUnconfirmedAgent(opts: { action: string; agentConfirmed: boolean | undefined }): void {
  if (opts.agentConfirmed === true) return;
  const context = detectAgentContext();
  if (!context.isAgent) return;
  console.error(
    [
      `Refusing to ${opts.action}: this looks like an agent session (${context.reason}).`,
      "",
      `The secret store (${secretsFilePath()}) is MACHINE-LEVEL — one file behind every box`,
      "on this machine, not just the box you are standing in. Granting a secret hands another",
      "box a live credential; setting one rotates the single copy every box shares.",
      "",
      "If the person you are working for explicitly asked you to do this, re-run with",
      "--agent-confirmed.",
      "",
      "If you need a secret for work you are doing: `cb secrets declare <name> --note ...`",
      "names the slot, and the boxholder supplies and grants the value. Needing a credential",
      "you were not given is a question for a human, not an obstacle to work around.",
    ].join("\n"),
  );
  process.exit(1);
}

/** Fail the process with a clean line for a known lifecycle error, a message otherwise. */
export function failWith(e: unknown): never {
  console.error(e instanceof SecretLifecycleError ? e.message : errorMessage(e));
  process.exit(1);
}

/** A `<box-or-boxRoot>` argument: an existing directory resolves to its slug, anything else IS the slug. */
export async function resolveSlugArgument(boxOrRoot: string): Promise<string> {
  const candidate = path.resolve(boxOrRoot);
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return await boxSlug(candidate);
  } catch (_e) {
    // Not a path on this machine — treat the argument as a literal slug.
  }
  return boxOrRoot;
}
