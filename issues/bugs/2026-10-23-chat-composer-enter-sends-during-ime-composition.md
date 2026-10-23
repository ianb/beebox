---
title: "Enter in the chat composer sends while an input method is still composing"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-frontend — frontend pass of the functional-duplication sweep
---

The chat composer sends on Enter without Shift
(`InteractiveChat/actions.ts:222`). It does not check
`nativeEvent.isComposing`. With an input method (Japanese, Chinese, Korean),
Enter confirms the composed text; here it also sends the half-written message.

The box screen's new-thought input already checks it
(`components/box-screen/NewThoughtInput.tsx:47`). Sharing one Enter-to-submit
predicate would fix the composer.

Not changed in the sweep: Safari reports the composition-ending Enter
differently (`keyCode` 229 with `isComposing` false in some versions), so the
right predicate needs a real-browser check with an input method.
