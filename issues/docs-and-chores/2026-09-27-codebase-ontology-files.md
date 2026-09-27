---
title: "Keep the codebase's concepts in ONTOLOGY.md files placed where they apply, and maintain them through planning"
workstream: unattached
needs: [design]
area: beebox
labels: [ontology, planning, agents, docs]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
---

Plans define their concepts in an Ontology section
(`.claude/skills/bbx-plan/TEMPLATE.md`), but those definitions stay in the
plan. The next plan in the same area defines the same concepts again, and it
can define them differently. For example, `notifications.md` defined
Reminder, Target, Loudness, Presence, and Delivery with care, and none of
them reached a shared document. `beebox/docs/glossary.md` has 25 entries and
no link to the plans.

The developer wants a persistent ontology for the codebase: the concepts,
what identifies each one, what each one is not, and how they relate. It is
not a formal ontology (no OWL or other machine-reasoned language). The
readers are agents and people.

## Decisions (developer, 2026-09-27)

- **One word, one meaning.** A word that means two things anywhere in the
  codebase is generally a bug, usually fixed by renaming one use. Each case
  is a point for discussion with the developer, not an automatic bug: do
  not treat a collision as two bounded contexts that may each keep the
  word, and do not rename without that discussion.
- **Files where they apply.** An `ONTOLOGY.md` can exist in any directory
  whose subtree holds concepts local to it. Not every directory has one.
  Add one only when the directory has its own concepts.
- **Always referenced, from the same directory.** The `CLAUDE.md` in the
  same directory as an `ONTOLOGY.md` links to it with a line such as
  "See also `path/from/root/ONTOLOGY.md`". If the directory has no
  `CLAUDE.md`, create one; a one-line `CLAUDE.md` is acceptable. An agent
  then knows where each ontology is without searching.
- **Placement by coverage.** A concept lives in the ontology of the lowest
  directory that covers every area that uses it. When a new area starts to
  use a concept, the concept moves up to the directory that covers both.
  Placement does not follow which module stores the data.
- **Format.** OpenCode's `CONTEXT.md` form: a bold term and a definition, an
  `_Avoid_:` line that names the wrong words, a **Relationships** section of
  one-line rules between terms, and flagged open questions.
- **Parallel ontologies for the codebase and for boxes.** The box agents'
  ontology is a separate document, maintained on its own. It is not
  generated from codebase entries, and one entry does not serve both
  audiences. The exception to consider: a structured single source in the
  style of the agent guide's ledger (`beebox/src/core/agent-guide/ledger.yaml`),
  from which both are rendered or checked.
- **The glossary is superseded.** `beebox/docs/glossary.md` is replaced by
  the ontology files.

## Proposed shape (not yet decided)

- **Entry fields.** Add one field to the OpenCode form: what identifies an
  instance.
- **Planning.** A plan's Ontology section becomes a change set against the
  ontology files: concepts added, changed, renamed, moved up, or removed, or
  "no changes". The plan uses the ontology's names. The plan reviewer and
  the cross-model review check the change set against the files. The finish
  skill applies it when the plan lands. Plan review is the human approval
  step for ontology changes.
- **Box ontology.** Where it lives in a box and how box agents load it,
  alongside the agent guide. No source found in the research below keeps a
  separate end-user ontology, so this part has no precedent.
- **Check.** A script can verify mechanically that every `ONTOLOGY.md` is
  linked from the `CLAUDE.md` in its directory, and that no term is defined
  in two ontology files. It cannot judge placement or meaning.
- **Pilot.** Start with two or three areas that already have strong plan
  ontologies (notifications, publications, chat). Measure whether later
  plans in those areas reuse the terms or define them again.

## Option: one structured source that generates the Markdown

The developer raised this as worth considering (2026-09-27). The ontology is
more structured than the agent guide, so it fits a YAML source in the style
of the agent guide's `ledger.yaml` even better. The source holds the extra
fields needed to generate both the codebase `ONTOLOGY.md` files and the box
ontology. It need not map one-to-one to the Markdown files; there could be a
single source file for the whole repository.

What it makes possible:

- **Placement is a field.** Each entry names the directory it applies to,
  and the generator writes each `ONTOLOGY.md` and its `CLAUDE.md` link. A
  concept that moves up changes one field.
- **Both audiences from one entry, where the entry allows it.** An entry can
  carry codebase text, box text, or both. This keeps the decision that the
  two ontologies are maintained separately while allowing one record per
  concept.
- **Mechanical checks.** Duplicate terms, a term defined for two
  directories, and a relationship that names an undefined term all fail
  automatically. The `_Avoid_:` words become a list that a lint can search
  for in code, docs, and prompts.
- **Plans change data.** A plan's ontology change set is a diff to the
  source, which the finish skill can apply and a reviewer can read.

What it costs:

- The generated Markdown must be kept in sync with the source, as
  `doc-graph.md` is now, and marked as generated so that agents edit the
  source and not the output.
- Definitions written as YAML strings are harder to write and review than
  Markdown prose.
- A single source file is one more thing every plan touches, and it grows
  with the codebase.

## Open questions

- How to move the glossary's content. Its entries seed the root ontology.
  Its "User-facing:" lines (what UI copy and agent replies call a concept)
  belong with the box ontology or the UI copy guidance, not the codebase
  ontology.
- How the one-meaning rule applies to words that are also everyday English,
  and to names from external systems (Git, Codex, Cloudflare) that the code
  must use as they are.
- Inclusion criteria for a concept. A first proposal: the code, cards, or
  APIs name it, and it has identity or a lifecycle, or it is easy to confuse
  with another word, or it crosses a boundary (storage, API, UI, or box
  agents). Leave out helpers whose meaning is only their type signature.

## Dependencies

The [source file layout review](../code-quality/2026-09-26-source-file-layout-review-and-enforcement.md)
is setting the directory boundaries now. The ontology files should follow
the same boundaries, so the placement design should wait for that result or
be done together with it.

## Research (2026-09-27)

What people do with glossaries and ontologies for coding agents.

- OpenCode keeps a root `CONTEXT.md` in the format above. It does not say how
  terms are added.
  [OpenCode CONTEXT.md](https://github.com/anomalyco/opencode/blob/dev/CONTEXT.md)
- One blog post proposes a `CONTEXT.md` per bounded context, a context map
  generated by a script, and a rule that the context that stores a term's
  data owns it. The developer rejected that ownership rule (see Decisions).
  [Domain-Driven Agents](https://coldtake.dev/blog/domain-driven-agents)
- AGENTS.md guidance recommends a Glossary section and nested per-directory
  files. [A complete guide to AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md)
- Ontology Atlas and Kiro's `domain-terms.md` have agents propose term
  changes that a human approves.
  [Ontology Atlas](https://github.com/toininoi/ontology-atlas),
  [Removing ambiguity with spec-driven development](https://www.danielschleicher.com/software/engineering,/ai,/spec-driven/development/2026/01/04/removing-ambiguity-with-spec-driven-development.html)
- Evidence is weak. One benchmark found that structured project memory
  answers "is X still valid, what replaced Y" questions much better than
  vector memory; that is a narrow result.
  [Ontology-Grounded Project Memory for Coding Agents](https://arxiv.org/abs/2608.13662)
  No primary source was found for the claim that asking a planner for "a
  strong ontology" improves its architecture. The rest is anecdote.
