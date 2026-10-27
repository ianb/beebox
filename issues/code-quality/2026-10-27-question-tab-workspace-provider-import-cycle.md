---
title: "A value import cycle between the question tab and the workspace provider"
workstream: unattached
area: frontend
labels: [code-quality, circular-deps]
filed-by: agent
discovered-in: dep-reduction — running `pnpm lint:circular`, 2026-10-27
---

`pnpm lint:circular` (in `beebox/`) reports a value import cycle. It appeared
in `133e23199` (2026-10-25, "Questions open beside the chat"):

- `beebox/src/frontend/src/components/questions/question-tab.ts` imports
  `useWorkspace` from `chat/workspace/WorkspaceProvider/provider.tsx` and
  `cardTarget` from `chat/workspace/use-open-beside/hook.ts`.
- `provider.tsx` imports `pickArrivalQuestion` and `useDismissOnClose` from
  `question-tab.ts`.
- `use-open-beside/hook.ts` imports `useWorkspace` from `provider.tsx`.

`beebox/docs/development/maintenance.md` says any cycle means a module needs
splitting. The likely split puts the parts of `question-tab.ts` that the
provider uses (`pickArrivalQuestion`, `useDismissOnClose`) in a module that
does not import the provider.
