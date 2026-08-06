---
title: "View cardRefs are unresolvable on a v2 box (views live outside the box root)"
area: callback-box
---

On a package-shaped (v2) box, `listBoxViewFiles` returns views from
`<packageRoot>/src/views/` — which is *outside* the operational box root
(`<packageRoot>/content/`). Every ref check that resolves "from" a view file
therefore fails closed:

For example, consider this valid v2 box:

```text
my-box/
  content/
    people/alice.person.card
  src/views/
    people.tsx  # contains cardRef="/people/alice.person.card"
```

The leading `/` makes the ref box-root-absolute, so it correctly names
`content/people/alice.person.card`. Today, `cb validate` still reports it as
broken. The resolver starts from `src/views/people.tsx`, but that file is
outside `content/`, so it rejects the starting path before it can resolve the
ref. A view with several valid links therefore produces a wall of false
`Broken reference` warnings, one for every `cardRef`.

- `lintViewRefs` → `resolveRefExists` → `boxRelativeFrom(boxRoot, viewAbsPath)`
  returns `null` (the path starts with `..`), so the ref resolves to nothing and
  `cb validate` reports **every** `cardRef="…"` in a v2 box's views as a broken
  reference, including correct box-root-absolute ones.
- The `--canonical` walk added in `callback-box/docs/implemented-plans/box-root-paths.md`
  Track F deliberately *skips* those views for the same reason, so the view
  surface contributes nothing to the canonical report on a v2 box.

Noticed while implementing Track F; not fixed there because it is a resolver-
context question, not a canonical-form one. The fix is probably to give a view a
`fromPath` that means something — e.g. resolve view refs from the box root
(`fromPath: ""`), since a view has no meaningful document-relative base anyway
and authors are told to write box-absolute refs (`views/refs.ts` header already
says so). That would also make `--canonical` cover views on real boxes.

Test coverage today hides it: `test/core/view-refs.doctest.md` lints a view
written at `<boxRoot>/views/v.tsx` (the legacy position), which resolves fine.
