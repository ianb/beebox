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

\`bbx view typecheck\` type-checks every view against the real \`ViewProps\`; it
catches field mistakes a render can miss.

**What it covers (and doesn't).** It samples one card per type, and only the
data in the box now; a branch for another card or for data the box does not
have is not reached. Calling an async helper directly in the render body is a
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
needs to wrap. To test the view's controls, run \`bbx browser snapshot -i\`,
then \`click\` or \`fill\` a ref, and capture again.`;

