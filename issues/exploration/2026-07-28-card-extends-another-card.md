---
title: "A card that extends another card (package refs + override/merge)"
workstream: unknown
area: beebox
filed-by: agent
needs: [design]
discovered-in: main session — boxholder idea
---

Idea: let a card **extend** another card and override parts of it — especially
for **default schedule items** and other package-provided defaults. Sketch:

```yaml
extends: pkg:<package>:/some/path/to.card
```

The extending card would then override specific fields of the base (e.g. change
the schedule of a referenced default) rather than copying the whole thing. Two
capabilities are missing today and both are needed: **(a) references into a
package** (we don't have them — need a way to *make* and to *resolve* such refs),
and **(b) the override/merge** of the extending card over the base.

*(The `pkg:<package>:` scheme is illustrative — the old `cardworks` package is
gone/absorbed into `beebox/src/cards/`, so the actual package target and
scheme name are TBD.)*

## Why — the practical driver, and the drift problem it could fix

Defaults today are **copy-based**: `src/core/install-template-file.ts` copies a
template file into the box and tracks version/customization in
`config/template-versions.json`, **parking** the update when an upstream template
changed but the box's copy was locally edited (the recurring template-rollout
pain). An **extends + override** model is the structural alternative: the box
holds a small card that *references* the package default and overrides only what
it wants (e.g. the schedule), so **upstream changes flow through automatically**
and only the deliberately-overridden fields diverge — no whole-file copy to drift
or park. Default schedule items are the motivating case; the mechanism is general.

## The hard part: the merge (boxholder's own doubt, shared)

"Some JSON merge algorithm to merge the card over the base" sounds easy and
isn't. A naive deep merge is ambiguous exactly where it matters:

- **Arrays** — replace wholesale? append? merge-by-key (which key)? Schedules and
  lists want different answers.
- **Deletes** — how does an override *remove* an inherited field/element?
- **Nested override vs replace** — override a leaf without clobbering siblings.
- **The markdown body** — cards are frontmatter + a markdown body; the body
  doesn't JSON-merge at all. Does extends cover only frontmatter, or is there a
  body story (append? sections? replace)?

So "merge" is not one thing; it needs a *defined* semantics, and picking it is
most of the design.

## Research (incomplete)

The boxholder's instinct — "maybe a cool language exists for it" — is right;
this is a solved-ish problem in config tooling. Leads to evaluate against our
needs (frontmatter + body, override + delete, predictable for non-experts):

- **JSON Merge Patch (RFC 7386)** — simple, `null` deletes; can't express array
  element ops. **JSON Patch (RFC 6902)** — explicit op list (add/remove/replace),
  precise but verbose and not "looks like the card."
- **Kubernetes strategic merge patch** — deep merge with per-field merge-key
  directives; the pragmatic middle ground, but schema-coupled.
- **CUE** — likely the "cool language": values *unify*, merge is
  commutative/associative and well-defined by construction; defaults + constraints
  are first-class. The most principled fit, at the cost of adopting CUE semantics.
- **Jsonnet** (object inheritance + `+`), **Dhall**, **Nix** (`//` recursive
  merge) — config languages with inheritance as a primitive.

Fill this in (retitle to `## Research (YYYY-MM-DD)`) with an actual evaluation
before designing the merge.

## Open design questions

- Full-card merge vs. a constrained "override these named fields" (much easier to
  define and reason about — maybe start there).
- Resolve-on-load vs. materialize-into-the-box (materialize brings back the drift
  problem; resolve-on-load keeps the reference live but adds a resolution step
  everywhere cards are read + a package-availability dependency).
- Relationship to `install-template-file.ts` / `config/template-versions.json` —
  does extends *replace* copy-based templates for the cases it fits, or coexist?
- The `pkg:` ref scheme itself (make + resolve): validation, package pinning/
  versioning, what happens when the referenced card moves or the package upgrades.
