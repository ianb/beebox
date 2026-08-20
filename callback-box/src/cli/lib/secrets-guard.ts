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
import { loadSecretStore, secretsFilePath } from "../../core/secrets/store.js";
import { detectAgentContext } from "../../lib/agent-context.js";
import { boxSlug } from "../../lib/box-slug.js";
import { errorMessage } from "../../lib/error-guards.js";
import { findBoxRoot } from "../../lib/paths.js";

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

/**
 * Refuse `cb secrets status <box>` when an agent asks about a box other than
 * the one it is standing in.
 *
 * An agent's view of the store is its OWN box's grants and declared slots
 * (`docs/plans/secret-custody.md`, "name visibility scoping") — never a reading
 * of what other boxes on the machine hold. `status` is not a disclosure of
 * values, but a machine-wide inventory of names and grants is a map of what to
 * go after, and an agent has no business drawing it for a box that is not its
 * own. A person at a terminal is unaffected.
 *
 * `boxRoot` is the box the command ran in: `undefined` means "find it from the
 * working directory", `null` means "there is none" (tests state both).
 */
export async function refuseIfAgentAskingAboutAnotherBox(opts: {
  slug: string;
  boxRoot: string | null | undefined;
}): Promise<void> {
  const context = detectAgentContext();
  if (!context.isAgent) return;
  const boxRoot = opts.boxRoot === undefined ? await findBoxRoot(process.cwd()) : opts.boxRoot;
  const ownSlug = boxRoot === null ? null : await boxSlug(boxRoot);
  if (ownSlug === opts.slug) return;
  console.error(
    [
      `Refusing to report on box "${opts.slug}": this looks like an agent session (${context.reason}), and`,
      ownSlug === null
        ? "the working directory is not inside a box, so there is no own-box view to show."
        : `the box you are working in is "${ownSlug}".`,
      "",
      "An agent's view of the secret store is its own box's grants and declared slots. The",
      "machine's other boxes are the boxholder's business, not something to enumerate from here.",
      ownSlug === null ? "Run this from inside a box." : `Try: cb secrets status ${ownSlug}`,
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * Refuse `cb secrets describe --add-use` from an agent for a secret that is not
 * its own box's.
 *
 * Adding a reason is the agent-facing half of `describe` and stays unguarded
 * *for the box the agent is standing in* — an agent teaching its box a new
 * trick should say why it now spends a key. What it must not do is annotate
 * OTHER boxes' secrets: writing a reason onto a machine-wide entry it has no
 * grant on is an edit to somebody else's record, and — worse — an unguarded
 * write is a probe. `describe` on an existing name succeeds; on a name nobody
 * declared it throws `SecretNotFoundError`. That difference alone enumerates
 * every secret on the machine, one guess at a time, which is exactly the map
 * `list` and `status` already refuse to draw
 * (`docs/plans/secret-custody.md`, "name visibility scoping").
 *
 * So the refusal is UNIFORM: out-of-scope and nonexistent read identically,
 * and it fires before the store lookup that would tell them apart. In scope
 * means granted to the box's slug, or declared by it (a slot the agent itself
 * named and is still waiting on — it must be able to add reasons to that).
 *
 * `boxRoot` follows {@link refuseIfAgentAskingAboutAnotherBox}: `undefined`
 * means "find it from the working directory", `null` means "there is none".
 */
export async function refuseIfAgentDescribingOtherBoxSecret(opts: {
  name: string;
  boxRoot: string | null | undefined;
  agentConfirmed: boolean | undefined;
}): Promise<void> {
  if (opts.agentConfirmed === true) return;
  const context = detectAgentContext();
  if (!context.isAgent) return;
  const boxRoot = opts.boxRoot === undefined ? await findBoxRoot(process.cwd()) : opts.boxRoot;
  const ownSlug = boxRoot === null ? null : await boxSlug(boxRoot);
  if (ownSlug !== null) {
    const loaded = await loadSecretStore();
    // An unreadable store fails CLOSED: without the grants there is no way to
    // tell an own-box secret from another box's, and guessing wrong here is
    // the disclosure this guard exists to prevent.
    if (loaded.ok) {
      const granted = loaded.value.grants[ownSlug]?.[opts.name] !== undefined;
      const declaredHere = loaded.value.secrets[opts.name]?.declaredBy === ownSlug;
      if (granted || declaredHere) return;
    }
  }
  console.error(
    [
      `Refusing to describe "${opts.name}": this looks like an agent session (${context.reason}), and`,
      ownSlug === null
        ? "the working directory is not inside a box, so there is no own-box secret this could be."
        : `"${opts.name}" is not granted to — or declared by — the box you are working in ("${ownSlug}").`,
      "",
      "An agent may say why ITS OWN box spends a key. The rest of the machine's secrets are the",
      "boxholder's record, and this command deliberately answers the same way whether the name",
      "belongs to another box or does not exist at all — a reply that told them apart would let",
      "this command enumerate the machine's secrets one guess at a time.",
      "",
      ownSlug === null
        ? "Run this from inside a box."
        : `To name a slot this box needs: cb secrets declare ${opts.name} --note ...`,
      "If the person you are working for explicitly asked for this edit, re-run with --agent-confirmed.",
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
