# Engine-dev knowledge audits (a parallel audit surface)

The knowledge-audit harness (`src/dev/knowledge-audit.ts`,
`src/dev/knowledge-audits.yaml`) verifies what a **box agent** recalls —
it spawns an agent with a box cwd and box CLAUDE.md context and checks
recall of box conventions (card-authoring tags, schema `instructions`,
box docs). The `{% quote %}` audits are the precedent.

**The idea:** a *parallel* audit surface for **engine-development**
conventions — what an agent editing the callback-box engine source must
recall: the `assertNever`/`invariant` helpers, the `Result` convention,
`withCardLock` for same-file RMW, `resolveContainedRef` for card refs,
`fenceForPrompt` for untrusted prompt embeds, the logging-level policy,
and the rest of `docs/engineering-principles.md` / `code-style.md`.

**Why it's separate, not an extension of the existing harness:** the
audiences and the loaded context differ fundamentally. A box agent runs
in a box and never loads the engine repo's `code-style.md` or
`engineering-principles.md`; an engine-dev agent runs in this repo with
those docs available. Running engine-dev prompts through the box harness
fails by construction (the agent has no path to the conventions) — which
is why the six engine-dev entries drafted during the architectural
review were removed (commit removing them: `audit: remove mis-scoped
engine-dev knowledge audits`). This is a genuinely different tool that
happens to share the "does the agent recall X from the docs it has"
shape.

**What it would take:**
- A runner that spawns the agent with the engine repo as cwd and the
  engine docs in scope (or measures recall from a fresh engine-dev
  session), distinct from the box-cwd runner.
- Its own YAML (or a `surface: engine-dev` discriminator on entries) so
  the two audiences don't get run against the wrong harness.
- The six removed entries are the ready first batch — their prompts and
  `watch_for` specs were written and are correct as specifications; they
  just need the right runner. They can be recovered from git history.

**Overlap caveat (the reason this is subtle):** box agents *do* program
against the public `callback-box/{cards,schema,view-widgets}` specifiers,
so a few conventions are legitimately box-agent knowledge even though
they live in engine source — e.g. `cardRef()`/`opaqueContentRef()` in
`src/cards/` (a box author writing a local schema with a ref field
chooses between them). Those belong in the *existing* box harness, not
this one. The line is audience, not file location: "does a box author
need this to operate a box" → box harness; "does an engine dev need this
to edit callback-box" → this proposed engine-dev harness.

Not scheduled work — filed as an idea. Priority is low unless engine-dev
onboarding (human or agent) starts showing the recall gaps this would
catch.
