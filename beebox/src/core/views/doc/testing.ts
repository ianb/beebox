/**
 * Testing section of the generated views doc. Split out of core.ts to keep
 * that file under the max-lines budget.
 */

export const testingSection = `## Testing a View

Saving a view runs a compile check automatically, the same way cards are
validated on save. To see whether a view renders, run:

\`\`\`
bbx view check
\`\`\`

This compiles every view in the box, loads the **real cards** each view's
\`dependencies\` globs select (the same data the running app passes), and renders
each view in each **check state**: with no card, and, for each type in
\`rendersCardTypes\`, with the first card of that type (by path) among the
cards its \`dependencies\` select, as \`params.path\`. Each state renders twice: first one frame, then again in a
document with effects run and \`readFile\` answered from the box, until no read
is pending. So a view that crashes only after its data loads, or only with a
real card, fails.

It prints \`✓ <slug>\` for a view that renders in every state. A view that fails
prints \`✗ <slug> [<state>, first frame | after effects]\` with the error and a
stack mapped back to your \`.tsx\` source lines, and the command exits non-zero.
If a dependency glob selects a card that fails to validate, that view fails too
(pass \`--allow-invalid-cards\` to ignore).

A view that renders but was not fully checked prints \`~ <slug> (partly
checked)\` with one line per reason, and does not fail: a state still loading at
the end of its time, a write (the check writes nothing), an error left uncaught
outside render (a \`readFile\` rejection with no \`catch\`), or a card type with
no card among its dependency cards (the app passes a view only those).
\`adapterFetch\` always rejects in the check.

A view that renders may also print \`advice:\` lines: a pattern this doc
forbids, found in its source or in what it rendered (an unwrapped wide table, a
control with no name, a \`new Date("2026-08-14")\`). Each line names the
section of this doc with the fix, and the file and line or the element. Advice
does not fail the check. Fix it, or leave it and say why it does not apply.
When the advice cannot run, the view is partly checked with the remark
\`advice not checked: <reason>\`.

\`bbx view typecheck\` type-checks every view against the real \`ViewProps\`; it
catches field mistakes a render can miss.

**Named states.** To check a state the samples do not reach, such as a
selection, export \`checkStates\`: a name, the card the view opens on, and
other view parameters.

\`\`\`tsx
export const checkStates = [
  { name: "oxygen", path: "_content/chem/Periodic_Table.chem.card", params: { select: "O" } },
];
\`\`\`

The check renders each one after its own samples, with the card as
\`params.path\`, and names it in a failure (\`✗ <slug> [oxygen, after effects]\`).
A name uses lowercase letters, digits and hyphens. A card that is gone, or of
a type not in \`rendersCardTypes\`, makes the view partly checked. An invalid
export fails the check. \`bbx view states <slug>\` prints the page path that
opens each state; open it with \`bbx browser open\` and capture it with
\`screenshot --card\`.

**What it covers (and doesn't).** It samples one card per type, plus the states
you declare, and only the data in the box now; a branch for another card or for
data the box does not have is not reached. Calling an async helper directly in the render body is a
bug, and the first frame throws to tell you so (\`fileUrl\` is synchronous and
fine to call in render). It does not print the rendered HTML, so look at the view
in the box browser to confirm it shows the right thing:

\`\`\`
bbx browser set viewport 390 844
bbx browser open /views/<path of a card this view renders>
bbx browser screenshot --card
bbx browser set viewport 1280 900
bbx browser screenshot --card
\`\`\`

A path that starts with \`/\` is a page of this box. \`screenshot --card\`
captures the whole card, not the window, and says \`whole card\` or
\`partial\` (and what is missing). It prints an \`overflow:\` line for each
part that is wider than its box: at phone width that usually means a row that
needs to wrap. A \`scrolls sideways:\` line names a part that scrolls inside
its own box and holds more than the image shows (a wide table in a scroll
wrapper); the image shows only its start. To test the view's controls, run \`bbx browser snapshot -i\`,
then \`click\` or \`fill\` a ref, and capture again.`;

