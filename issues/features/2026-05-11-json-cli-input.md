---
title: "JSON as CLI input — structured arguments and composable profiles"
workstream: unknown
area: beebox
---

Google's `gws` (Workspace CLI) takes this approach: instead of many individual flags, you pass a single JSON object constructed from the API schema. ([article](https://betterstack.com/community/guides/ai/cli-gws-ai-agents/)) The agent builds one blob rather than learning a large flag surface — fewer distinct interface elements, lower token cost, and the schema can be introspected directly.

```bash
# Individual flags — agent must learn each one
$ bbx create --type=memo --title="Hello" --content="..." --author="Ian"

# JSON input — agent constructs one object from the schema
$ bbx create --args='{"type":"memo","title":"Hello","content":"...","author":"Ian"}'

# Or from a file
$ bbx create --args="$(cat my-memo.json)"
```

The composability payoff is in profiles. A "profile" is just a base JSON file; `jq`'s `*` operator merges objects with right-side winning:

```bash
$ bbx create --args="$(jq -n '{"type":"memo","author":"Ian"} * {"title":"Hello","content":"..."}')"
# or
$ bbx create --args="$(jq '. * {"title":"Hello"}' base-profile.json)"
```

No profile subsystem needed — files, `jq`, and shell already compose. The convention is: `*` merges, explicit args override profile values, git tracks the profile files.

One further idea from `gws`: the command surface itself is generated at runtime from a live API discovery endpoint rather than a static list. When the underlying API adds a method, the CLI reflects it immediately — no lag between API changes and agent accessibility. `bbx` is too hand-crafted for this to apply directly, but the principle is worth holding: the introspection layer (`agent-context`) should be generated from the same source of truth as the implementation, not maintained separately.

This pattern becomes more attractive as the command surface grows (especially for MCP). For `bbx` today the flag surface is small enough that individual flags are fine, but worth keeping in mind if the API expands or agents start constructing calls programmatically at scale.
