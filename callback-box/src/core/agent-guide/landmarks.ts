/**
 * Landmarks section — the user-facing navigation overlay on the box.
 *
 * Deliberately thin. Agents need to know landmarks exist and what
 * they're for; they should not learn how to create them from this
 * always-loaded guide. Curation criteria live in
 * `docs/landmark-curation.md`; schema details in
 * `docs/generated/card-landmark.md`.
 */

export function landmarksSection(): string[] {
  return [
    "## Landmarks",
    "",
    "The Landmarks page is the user's quick-jump surface to the spots in the box they actually live in. Directories organize the box for the system — inbox, jobs, archive, etc. Landmarks orient that organization toward the user: the places they keep returning to, the destinations of their recurring asks. Each is a `*.landmark.card` inside the directory it represents.",
    "",
    "Landmarks earn their spot. If the same kind of thing comes up over and over in chat — recipes, an ongoing project, a todo list — and there is no landmark for it, that's a signal worth raising with the user. Do not create one quietly. Read `docs/landmark-curation.md` before suggesting or editing one.",
    "",
  ];
}
