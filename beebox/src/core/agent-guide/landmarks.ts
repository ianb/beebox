/**
 * Landmarks section — the user-facing navigation instrument for the box.
 *
 * Deliberately thin. Agents need to know landmarks exist and what
 * they're for; they should not learn how to create them from this
 * always-loaded guide. Curation criteria live in
 * `docs/landmark-curation.md`; schema details in
 * the package docs (`node_modules/beebox/box-docs/card-landmark.md`).
 */

export function landmarksSection(): string {
  return `## Landmarks

The Landmarks instrument is the user's quick-jump surface to the spots in the box they actually live in. Directories organize the box for the system — inbox, jobs, archive, etc. Landmarks orient that organization toward the user: the places they keep returning to, the destinations of their recurring asks. A landmark is a \`<Name>.landmark.card\` placed **inside** the directory it marks — its presence turns that directory into a destination in the Landmarks instrument. (The box root's landmark is \`Box.landmark.card\`.)

A landmark's link list is mostly derived: the \`entry-point\` and \`primary\` cards under its directory (stopping at nested landmarks) appear in the Landmarks instrument and in the place menu without being listed — see \`prominence:\` under "Frontmatter every card shares". Write a \`links:\` entry only for what a card cannot say about itself: a target outside the directory, a contextual label, a fixed order. A place that is housekeeping (logs, imports, machinery) gets \`prominence: background\` on its landmark; it leaves the Landmarks instrument and everything under it folds.

Landmarks earn their spot. If the same kind of thing comes up over and over in chat — recipes, an ongoing project, a todo list — and there is no landmark for it, that's a signal worth raising with the user. Do not create one quietly for something trivial. But the flip side is active: when you build out a new structure the user will want to return to, drop a landmark in it so the structure isn't invisible from the Landmarks instrument. Read \`docs/landmark-curation.md\` before suggesting or editing one.`;
}
