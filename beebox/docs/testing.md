# Testing

How the engine is verified. One page per verification instrument, each
answering one question about the system; this page holds what is true of
testing as a whole.

## Philosophy

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

**Iteration runs the selected tests, not the suite.** `pnpm test:changed`
selects the tests the diff implicates, plus typecheck and lint. There is no
full run at merge: full runs were mostly red for reasons the branch did not
cause. The full suite runs on its own schedule instead
([recurring work](development-workflow.md#recurring-work)), bisected to the
landing that broke it.

## Instruments

| Instrument | Question it answers | Gate? | Cost |
|---|---|---|---|
| [Doctests](testing/doctests.md) | Does this function, route, or box operation behave? Includes service fakes for every external dependency. | pre-commit (selected) | seconds |
| [TAP tests](testing/tap-tests.md) | Does the test infrastructure itself work? What a doctest cannot test without circularity. | pre-commit (selected) | seconds |
| [Knowledge audits](testing/knowledge-audits.md) | Does the box agent know X, from what it is given? | no | model turns |
| [Session critiques](testing/session-critiques.md) | Did the CLI tools help or hinder the agent in a real session? | no | model turns |
| [Dev stubs](testing/dev-stubs.md) | Does the streaming UI behave, and is every state of a component reachable? Checked by hand in a browser. | no | minutes |
| [Smoke](testing/smoke.md) | Does the app boot and walk at all? | merge, for deployed paths | about 30 s |
| [Tours](testing/tours.md) | Does each page render and pass axe at both viewports? | no; walked weekly | tens of seconds |
| [Field tests](testing/field-testing.md) | Is it discoverable and usable end to end, through the real UI? | no | expensive; weekly or on demand |
| [Card validator hook](card-validation.md) | Does a card still validate after an agent edit? Runs on its own during agent sessions. | blocks bad commits | automatic |
| [User-stories catalog](../user-stories/README.md) | What can the software actually do? Claims read from the source by agents, each verified by a different agent than the one that wrote it. | no | many model turns |

Prefer the lowest instrument that catches the bug: a template generating bad
XML is a doctest; an agent not knowing about a command is a knowledge audit;
an agent not using a tag it was told to use is a field test.

## Future directions

Key ideas not yet implemented:

- **Self-describing services** — Services export `description`, `examples`, and `properties` alongside their functions. Tests get generated from these.
- **Property testing** — Semantically meaningful invariants (like `parse(serialize(card)) === card`), not random fuzzing.
- **CGI-style route testing** — Test routes as pure state→output functions rather than spinning up servers.
- **Assertive logging** — Soft assertions in production code that surface through the logging system, caught by an error harness in tests.
