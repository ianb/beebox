/**
 * User location — captured (with consent) from the web UI, read on demand.
 */

export function locationSection(): string[] {
  return [
    "## User location",
    "",
    "The boxholder can share their device location from the web UI. It is **on-demand only** — it never appears automatically in context, so query it when the conversation needs the user's whereabouts.",
    "",
    "- **Read it:** `cb location get` prints the last-known fix as `lat,lng (±accuracy, captured <age> ago, web)`. Add `--json` for structured output (`lat`, `lng`, `accuracy`, `capturedAt`, `ageMs`, `stale`).",
    "- **Not shared:** prints `unknown` when the boxholder hasn't shared location. Don't guess or fabricate a location — report that it's unknown.",
    "- **Staleness:** an old fix is flagged `[stale]` (and `stale: true` in JSON); treat it as approximate.",
    "- **Web-only:** location comes from the browser; it stays `unknown` on Telegram and other channels.",
    "",
  ];
}
