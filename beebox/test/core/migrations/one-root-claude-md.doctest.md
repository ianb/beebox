# one-root migration: the CLAUDE.md merge transform

`mergeClaudeMdText` (`src/core/migrations/one-root-claude-md.ts`) merges a v2
box's content CLAUDE.md into its root CLAUDE.md. It drops the stale
packageify-era engine scaffold from the root text (boxholder-written root text
is kept), and inside the merged persona it repairs `@`-includes whose targets
the migration relocated.

```ts setup
import { mergeClaudeMdText } from "../../../src/core/migrations/one-root-claude-md.js";
```

## Stale scaffold is dropped; includes are repaired through the mapping

The classic residue case: the root carries the "box package" scaffold (matched
case-insensitively) and the persona includes a file the migration moves.

```ts
mergeClaudeMdText(
  "This is a box package. The live box is content/. See docs.\n",
  "@MAP.md\n\nBe helpful.\n"
)
=> ## Box persona
«blankline»
(Merged from the v2 operational-root CLAUDE.md by the one-root migration.)
«blankline»
@_content/MAP.md
«blankline»
Be helpful.
```

## Boxholder-written root text is preserved

```ts
mergeClaudeMdText("House rules: no surprises.\n", "Persona text.\n")
=> House rules: no surprises.
«blankline»
## Box persona
«blankline»
(Merged from the v2 operational-root CLAUDE.md by the one-root migration.)
«blankline»
Persona text.
```

## Includes that already resolve, or that the mapping cannot place, pass through

Already-v3 (`_`-prefixed) and `.beebox/` includes are untouched; a target the
mapping cannot place stays as-is for the post-migration validate to surface.

```ts
mergeClaudeMdText(
  "",
  "@_content/briefing.md\n@.beebox/agent-guide.md\n@.mystery/notes.md\n"
)
=> ## Box persona
«blankline»
(Merged from the v2 operational-root CLAUDE.md by the one-root migration.)
«blankline»
@_content/briefing.md
@.beebox/agent-guide.md
@.mystery/notes.md
```
