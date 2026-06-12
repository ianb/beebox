/**
 * API keys & secrets — where credentials live and the never-commit rule.
 *
 * Kept in the always-loaded guide (not just the connectors doc) because the
 * failure mode of an agent guessing is severe: a key written into a card or
 * any committed file gets pushed to the box's remote. The agent must know
 * the one correct location without having to discover it.
 */

export function secretsSection(): string[] {
  return [
    "## API keys & secrets",
    "",
    "Per-service credentials live in `config/connectors/<service>.secret.json` — e.g. `replicate.secret.json` containing `{\"apiKey\": \"...\"}`. That path is gitignored; it is the ONLY place to put a key.",
    "",
    "- **Never** write a key into a card, CLAUDE.md, a doc, or any other file — the box repo is pushed to a remote. After saving a secret, confirm `git status` shows nothing new staged.",
    "- To use a key, read its JSON file. If the file is missing, the service isn't configured for this box — tell the boxholder what's missing and the exact path it belongs at; don't guess or invent values.",
    "- Scheduled scripts can declare a connector requirement; the scheduler checks the secret file exists and skips cleanly when it doesn't (see `docs/generated/connectors.md`).",
    "",
  ];
}
