---
name: don-t-hardcode-box-specific-names-in-shared-prompts-or-docs
description: "In system prompts, shared instructions, docs, and design notes, refer to roles generically (\"the user\", \"the boxholder\", \"a character\", \"a family member\") — never to specific names from any box (the user's, family members', characters', pets', etc.)."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 443060a4-aefd-4ebbx-abc9-b4bc9211a069
---

When writing system prompts, shared instructions, doc templates, design notes, or any text that will be shipped as a shared artifact in this codebase, refer to people and entities generically — "the user", "the boxholder", "a character", "a household member" — never by a specific name pulled from any box.

This covers all box-specific identifiers:
- The user's own name (Ian)
- Family/household member names
- Character names from `~/src/boxes/test1/` or any other box (Wren, Marisol, etc.)
- Pet names, project names, anything else specific to a particular box's content

**Why:** The beebox codebase is generic — any box can be adopted by any user with their own people, characters, and structure. Hardcoding names from one box into shared text leaks personal context into a tool meant to be reusable, and turns those names into dead references when the code is run against a different box. The user explicitly called both cases out: first for his own name ("I'm named Ian, but that's not the user's name generally"), then later for a character ("Don't refer to specific things in my boxes like Wren — at least not in the docs").

**How to apply:** Applies to text that will be shipped as a shared artifact (system prompts, schema instructions, doc templates, rules files, design docs under `docs/`, generated docs). Does NOT apply to personal memory, one-off conversational answers, commit messages, or anything scoped to a single session. The line: if the text lives on after this conversation as something a future box/user/agent might read, use generic language; if it's scoped here-and-now, specific names are fine.
