# Testing

## Testing Philosophy

Tests serve three purposes in this project, in order of importance:

1. **Forcing decomposition** — Making something testable creates clean boundaries. Writing a test first helps identify a function's purpose and isolate it from its surroundings.
2. **Documentation** — Tests as literate documents that tell a story about how things work. Doctests are the primary format: readable markdown that happens to be executable.
3. **Regression anchors** — Specific bug prevention at the moment of a fix.

What tests are NOT for: validating types (the type system does that), achieving coverage percentages, or comprehensive verification for its own sake. Types with strict settings already act as smoke tests for structural correctness.

**Key principles:**
- **No mock libraries.** Injectability should be built into code. Prefer dependency injection over mocking frameworks.
- **No server spin-up for testing.** Route tests use Fastify's `inject()`, not a running server. State-in → render → check output.
- **TAP over fancy test runners.** TAP's text protocol is agent-readable and zero-dependency.
- **Doctests are the default.** If it can be explained with examples in markdown, it should be a doctest. Traditional `.test.ts` files are for things that genuinely need complex setup or meta-testing.


## Instruments

Each child answers one question about the system. Axis: verification
instrument.

- [Doctests](testing/doctests.md): does this function, route, or box operation behave?
- [TAP tests](testing/tap-tests.md): what a doctest cannot test without circularity.
- [Knowledge audits](testing/knowledge-audits.md): does the box agent know X?
- [Session critiques](testing/session-critiques.md): did the tools serve the agent in a real session?
- [Dev stubs](testing/dev-stubs.md): does the streaming UI behave, checked by hand?
- [Smoke](testing/smoke.md): does the app boot and walk at all? The merge gate.
- [Tours](testing/tours.md): does each page render and pass axe at both viewports?
- [Field tests](testing/field-testing.md): is it discoverable end to end through the real UI?
- [Card validator hook](card-validation.md): validation during agent edits, not an instrument you run.

## Choosing the Right Approach

| Question | Approach |
|----------|----------|
| Does this function return the right value? | Unit test |
| Does the full pipeline produce the right output? | Scenario test |
| Does the agent know where to find X? | Knowledge audit |
| Did the CLI tools help or hinder the agent? | Session critique |
| Does a card validate after agent edits? | Card validator (automatic) |
| Does the streaming UI scroll/reflow correctly? | Frontend dev stub (`/fakestream` + `bin/browse`) |
| Does the app still boot and work at all? | Smoke tier (`bin/smoke` — runs automatically at `/finish` for a code change) |
| Does this page render sane at both viewports / pass axe? | Tour (`bin/tour <name>` — see [tours.md](testing/tours.md); walked and kept true weekly, not a gate) |
| Is every state of this component reachable and right? | Dev harness route (`/dev/…`, real components over injected fakes) |
| Is this realistically discoverable/usable end-to-end, through the real UI? | Field test (`bbx engine field-test run <scenario>` — expensive, weekly/manual, never a gate) |

**Overlap:** Some things could be tested at multiple levels. Prefer the lowest level that catches the bug:
- A template generating bad XML → unit test (fast, deterministic)
- An agent not using `<chat-response>` tags → field test (needs agent behavior)
- An agent not knowing about a command → knowledge audit (tests documentation)

## Adding New Tests

### New doctest (preferred)
Create `test/<name>.doctest.md`. Write prose explaining the behavior, with fenced code blocks containing examples. See [doctest syntax](../../agent-doctest/docs/syntax.md) for syntax. Runs automatically with `npm test`.

### New traditional test
Create `test/<name>.test.ts`, import from `tap`. Use for route integration tests, meta-tests, or anything needing complex setup that doesn't read well as documentation.

### New knowledge audit
Add entries to `src/dev/knowledge-audits.yaml`. Run with `--filter <id>` to test individually.

### New session critique

Pick a session to review (use `bbx session --list` from a box), then run `@session-critique <id>` from Claude Code in the beebox project. Review the findings and apply fixes per the "Acting on findings" guide above.

## Future Directions

Key ideas not yet implemented:

- **Self-describing services** — Services export `description`, `examples`, and `properties` alongside their functions. Tests get generated from these.
- **Property testing** — Semantically meaningful invariants (like `parse(serialize(card)) === card`), not random fuzzing.
- **CGI-style route testing** — Test routes as pure state→output functions rather than spinning up servers.
- **Assertive logging** — Soft assertions in production code that surface through the logging system, caught by an error harness in tests.
