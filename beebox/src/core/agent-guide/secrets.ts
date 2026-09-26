/**
 * API keys & secrets — a compact pointer, not the policy.
 *
 * Two things are stated inline rather than deferred to a doc, because both
 * failure modes are one wrong guess away and neither waits for the agent to
 * think of opening a reference: a key must never be written down anywhere in
 * the box, and a key the agent needs is *asked for*, not manufactured. The
 * mechanics of the store live in the engine's `docs/secrets.md`; how a trick
 * receives a granted key is in `box-docs/tricks.md`.
 *
 * This replaced the old "credentials live under `config/connectors/`" text,
 * which the machine-level store made actively wrong (secret-custody plan,
 * Knowledge audits).
 */

import { BOX_PACKAGE_DOCS } from "../docs-gen/shared.js";

export function secretsSection(): string {
  return `## API keys & secrets

Credentials live in a machine-level store outside this box, one copy each, granted per box by the boxholder — never written by the agent into a card, a config file, an env var, a log, or any committed file. The trick runner may inject a granted value into the child process environment for the duration of one run.

- **Need a key for something you are building?** \`bbx secrets declare <name> --note "what it is and where to get it" --use "why you need it"\` names the slot; the boxholder supplies the value and grants it. \`bbx secrets status <this box>\` shows what this box has and what it is still waiting on (your own box only — the machine's other boxes are the boxholder's business). Needing a credential you were not given is a question for a human, not an obstacle to work around.
- **Building something new on a key that is already granted?** Say so: \`bbx secrets describe <name> --add-use "the umbrella reminder trick"\`. Reasons are additive — one key usually serves several tricks — and this is the list the boxholder reads when deciding whether a key still earns its keep. You may add a reason; removing one is theirs.
- **Using one from a trick** — declare it in the trick's \`secrets.json\`; how \`bbx trick\` resolves and injects it is in \`${BOX_PACKAGE_DOCS}/tricks.md\`.
- **Never paste the value into the code, a file, or a card.** One copy exists so rotation touches one place; a copy in the tree is the thing this design removes.`;
}
