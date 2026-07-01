/**
 * User location — captured (with consent) from the web UI, read on demand.
 */

export function locationSection(): string[] {
  return [
    "## User location",
    "",
    "The boxholder can share their device location from the web UI. It is **on-demand only** — it never appears automatically in context, so query it when the conversation needs the user's whereabouts.",
    "",
    "- **Read it:** `cb location get` prints the last-known fix as `lat,lng (±accuracy, captured <age> ago, web)`, prefixed with the place name (`Home — …`) when the fix is inside a known place. Add `--json` for structured output (`place`, `lat`, `lng`, `accuracy`, `capturedAt`, `ageMs`, `stale`).",
    "- **Not shared:** prints `unknown` when the boxholder hasn't shared location. Don't guess or fabricate a location — report that it's unknown.",
    "- **Staleness:** an old fix is flagged `[stale]` (and `stale: true` in JSON); treat it as approximate.",
    "- **Web-only:** location comes from the browser; it stays `unknown` on Telegram and other channels.",
    "",
    "### Named places",
    "",
    "Place cards (`places/<Name>.place.card`) let the box recognize a location by name — so `cb location get` can say \"Home\" instead of bare coordinates.",
    "",
    "- **Record a place (card-first, then mark):** create the card describing the place — `cb create places/Home.place.card name=Home address=\"…\"` — with a body explaining what it is and why it matters. Then, while the boxholder is physically there, run `cb location mark places/Home.place.card` to stamp the current location into it. Don't hand-type `lat`/`lng` — `mark` writes them from the live fix and reports the fix's age so you can judge whether it's current.",
    "- **Outside the radius:** if the boxholder is now outside a place's radius, `mark` won't change it; re-run with `--expand` to grow the radius to include the new spot.",
    "",
  ];
}
