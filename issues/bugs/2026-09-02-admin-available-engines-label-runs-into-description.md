---
title: "Admin: the \"Available engines\" label runs into its description with no break"
workstream: tour-check
area: beebox
labels: [tours]
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check, nav-pages tour, admin checkpoint
priority: normal
---

On `/admin`, in the "Agent engine and model" card, the label and the
description below it render as one run-on line:

```
Available enginesWhich harnesses a new chat may choose. Turn off an engine
this box has no account for, so nobody starts a chat that cannot run.
```

There is no space and no line break between "engines" and "Which". The
defect shows at both viewports.

## Cause

`beebox/src/frontend/src/components/admin/AgentEngineSection.tsx:89-94`
puts two `Text` elements in a `Stack gap="xs"`:

```tsx
<Stack gap="xs">
  <Text size="sm" weight="semibold">Available engines</Text>
  <Text size="sm" tone="muted">
    Which harnesses a new chat may choose. …
  </Text>
```

`Text` renders a `<span>` by default
(`components/ui/Text.tsx` — `as = as ?? "span"`), and `Stack` spaces its
children with Tailwind `space-y-1`
(`components/ui/Stack.tsx:17`), which sets a top margin on sibling
elements. A top margin does nothing to an inline `<span>`, so the two
spans sit on the same line with no separator.

The other children of the same `Stack` are `CheckboxField` components,
which render blocks — that is why only these two run together.

The narrow fix is `as="p"` (or `as="div"`) on both `Text` elements. The
wider question is whether `Stack` should refuse inline children, or
whether `Text` inside a `Stack` should default to a block element —
this is the only adjacent inline-`Text`-pair in the frontend today, so
the pattern is not yet a class of bug.

## Evidence

- Tour: `nav-pages`, checkpoint `admin`, run `2026-09-02T23-41-11-927Z`.
- Artifacts (gitignored, run-local):
  `beebox/test/tours/.artifacts/nav-pages/2026-09-02T23-41-11-927Z/admin.desktop.png`
  and `admin.mobile.png`.
- The tour did not fail. Its assertions cover the h1 and the landmarks,
  not the run-together text, so a screenshot review found this.
