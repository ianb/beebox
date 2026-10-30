---
title: "Tests state why each expected value is right; keep only the failures that exploration finds"
workstream: test-oracles
resolution: implemented
area: testing
labels: [testing, doctest, guidance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — reading two papers on agent-written tests and the real-testing skill, 2026-10-11
---

**Closed (implemented), commits 7c17c6d3f and 91f07e366.** The sentence before an
example says what rule it shows and where the expected value comes from; a
`suggested:` value is pasted only when that sentence says why the exact value is
right; exploration keeps only cases that failed; the cross-model reviewer treats
a new expected value with no stated reason as a finding. Divergences from the
issue's proposals, all human decisions of 2026-10-11:

- The convention is prose with no marker.
- No lint or doc-check enforcement: a mechanical check can only see whether
  prose precedes a block, and 1203 of the suite's blocks follow a heading directly.
- The rule applies to new and edited blocks only; no pass over existing doctests.
- Stronger forms (a `why:` line with a closed source vocabulary, grounded
  references the checker resolves, a reviewer prediction check) were proposed and
  the human declined all of them.
- Tour-check is untouched, as the issue scoped.
- The `dev-doctest-unrunnable-value` knowledge audit passed both before and after
  the change with both models, so it guards against drift; it does not show the
  change altered behavior.

Agents write almost all tests in this repository. Usually the same session
writes the code and its test. Nothing in `beebox/docs/testing.md`,
`beebox/docs/testing/doctests.md`, the agent-doctest docs, the finish skill or
the cross-model review asks where an expected value comes from. The easy path
for a doctest is to run the expression and paste the output after `=>`. When
the code is wrong, the test then requires the wrong behavior.

## Evidence

- Charoosaei, Richter, Papadakis, "On the Risks of using LLM-Generated Tests
  for Regression Testing" ([arXiv 2610.11835](https://arxiv.org/abs/2610.11835)).
  The study covers 145 pull requests in SciPy, Qiskit and pandas. 8–17% of the
  generated tests asserted faulty behavior; 2.4–4.8% revealed a fault. 83–91% of
  the fault-enforcing tests stayed relevant in later commits. The developers'
  suites caught 14–30% of the enforced faults.
- Chen et al., "Rethinking the Value of Agent-Generated Tests for LLM-Based
  Software Engineering Agents" ([arXiv 2602.07900](https://arxiv.org/html/2602.07900v1)).
  The study uses SWE-bench Verified with six models. Most of what the agents
  wrote as tests were value prints, not assertions; relational and range
  assertions were 3–8% of assertions. When a prompt turned test writing on or
  off, 83% of tasks kept the same result, and turning tests off cut input
  tokens by 33–49%. This measures help while fixing, not regression value; the
  first paper measures the regression value.
- [real-testing](https://github.com/Corvidae-Coding-Projects/real-testing), a
  small agent skill. Its rule: "The program's own output does not become the
  oracle just because it was produced." Do not install it. It overlaps with
  `bin/browse`, tours and the journey walks. Borrow its ideas.

## Direction

1. **Each expected value says why it is right.** Add a doctest convention: a
   lead-in sentence or a comment before the block names the source of the
   answer. Examples: the issue or plan ("Per the issue, an unmarked card still
   lists"), a past regression ("Before `<commit>` this returned 0"), the format
   specification, or an independent calculation. Pasted output counts only after
   a check against one of these sources. A value that is a choice, such as
   formatting or order, says so. Then a later change to it reads as a
   decision, not as a broken test.
2. **Exploration keeps only what failed.** Exploring varied inputs during work
   is useful. Commit a case only when it failed, or when it is part of the
   contract that the change set out to define. Passing cases kept
   "for coverage" add behavior that nobody chose. Such behavior can be wrong,
   and the test then makes it harder to fix. A kept failure is a small replay
   case with its inputs and the reason its expected result is right.
3. **Borrow from real-testing.** Write the expected results before running.
   Keep the checking code separate from the implementation.
4. **Bug-fix tests fail first.** A test for a fix fails without the fix. The
   report says so, or says why that could not be shown.
5. **Review checks the reason, not the count.** The cross-model reviewer checks
   each new expected value against its stated reason.

Out of scope: tour-check already requires evidence that names the specific
change before it edits a tour (`schedules/tour-check/prompt.md`). Also out of
scope: any rule that asks for more tests.

## Open questions

- The form of the lead-in (prose, a marker, a comment) and whether
  `doc-check` or a lint can find blocks that have none.
- Whether existing doctests need a pass, or the rule applies to new and edited
  blocks only.
- Where the rule lives so that agents read it at the moment they write a test.
  Keep each guidance file net shorter (root `AGENTS.md`, "agent and skill files
  only ever grow").

Related: [doctests use real types as generic fixtures](../code-quality/2026-10-10-doctests-use-real-types-as-generic-fixtures.md),
[doctest usability review](../exploration/2026-09-27-doctest-usability-review.md).
