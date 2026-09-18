---
title: "Admin Backup card: the git remote path overflows the card at phone width"
workstream: unattached
area: beebox
labels: [ui, frontend]
filed-by: agent
discovered-by: agent
discovered-in: worktree-ui-stack-roles — mobile screenshot of /admin during the Stack visual pass
---

At 390px width, the "Git remote" value in the Backup card runs past the
card's right edge. The remote is a long unbroken path (a local filesystem
path or URL), rendered in `font-mono text-xs`.

## Cause

`beebox/src/frontend/src/components/admin/BackupSection.tsx:28-35`, the
local `Row` helper:

```tsx
<div className="flex gap-3 text-sm py-1">
  <span className="text-warm-600 w-32 shrink-0">{label}</span>
  <span className="text-warm-800">{children}</span>
</div>
```

The value span is a flex item with the default `min-width: auto`, so it
cannot shrink below its longest unbreakable word. The remote path has no
break opportunities.

The narrow fix is `min-w-0 break-all` (or `break-words`) on the value
span, or on the remote `<span>` at line 68 only.

This predates the Stack change on `worktree-ui-stack-roles`:
`BackupSection.tsx` does not use `Stack`.
