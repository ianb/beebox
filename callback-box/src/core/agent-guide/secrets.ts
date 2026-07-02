/**
 * API keys & secrets — a compact pointer, not the policy.
 *
 * The always-loaded guide carries indirect knowledge ("where to look"),
 * and the full rules live in the on-demand connectors doc. The one rule
 * stated inline is the never-commit rule, because the failure mode of an
 * agent guessing is a credential pushed to the box's remote — that can't
 * wait for the agent to think of opening the right doc.
 */

export function secretsSection(): string {
  return `## API keys & secrets

Credentials live under \`config/connectors/\` (gitignored) — never in a card or any committed file. Before saving or reading a key, see the Credentials section of \`docs/generated/connectors.md\` for the file convention.`;
}
