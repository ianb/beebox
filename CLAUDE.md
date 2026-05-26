## Monorepo Layout

Three independent projects (each has its own `.git`):

- **callback-box/** — Main system. See its CLAUDE.md for details.
- **callback-clerk/** — Chrome extension that talks to a hosted callback-box instance.
- **cardworks/** — XML card library (parsing, validation, JSX). Shared dependency of callback-box.

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box.
