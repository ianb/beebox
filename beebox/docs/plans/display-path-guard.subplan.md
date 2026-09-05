---
title: "Display-form path guard"
status: draft
workstream: box-layout-criteria
issues: []
---
# Display-form path guard

The boxholder-facing display vocabulary (`recipes/Soup.recipe.card` for
content, `Config:box.json` / `Bookkeeping:jobs/...` for machinery — settled
2026-09-05) will leak into places that expect canonical paths: an agent
copies the user's words into a ref, a `bbx` argument, or an API call. Path
resolution must recognize the display forms and reject them with an error
that names the canonical form, instead of failing confusingly — or worse,
silently.

## The silent failure that makes this urgent

`isExternalRef` (`src/shared/ref-path.ts:149`) classifies any
`^[A-Za-z][\d+.A-Za-z-]*:` prefix as an external URL scheme. `Config:` and
`Bookkeeping:` match. A display-form ref written into a card today is
treated as an external link: never resolved, never linted as broken —
**silent**. Every other leak path at least fails loudly (ENOENT, not-found).

## Design

One shared detector, wired into the existing choke points — no new
vocabulary, no new resolver:

- **`detectDisplayFormPath(raw)`** in `src/shared/display-path.ts` (built on
  the same derived area labels): returns `null` or
  `{ canonical: string, areaLabel: string }` when `raw` starts with a
  case-insensitive area display label + `:` (`config:`, `bookkeeping:`,
  `publish:`, `tmp:` — NOT `content:`, which is a real registered URI
  scheme (IANA-provisional; Android `content://` URIs) and displays bare
  anyway; review round 1 caught the collision). A `<label>://` form (double
  slash) is never treated as display form. The colon form is the only
  *detectable* display form; a bare content display path is
  indistinguishable from a legitimate relative ref (handled below as a
  suggestion instead).
- **Input-boundary inventory** (review round 1: an assumed shared CLI
  helper does not exist, and extraction-layer filtering hides display forms
  before lint sees them — the check must sit where each boundary actually
  classifies):
  1. **Ref extraction, not just ref lint**: `body-refs.ts` DISCARDS
     external-looking links before card lint ever sees them (inline links
     ~:80, reference definitions ~:245), and markdown lint classifies
     external before parsing. The detector runs inside those extractors'
     external checks: a display-form match is reported as a lint ERROR (not
     dropped), covering inline links, reference definitions, AND frontmatter
     refs, each with its own doctest. Message: "`Config:box.json` is the
     boxholder's display form; write `/_config/box.json`".
  2. **`resolveBoxNamespacePath`** gains a distinct result (not a bare
     `null`): callers map it explicitly — HTTP routes → 400 with the
     message; tRPC procedures → `BAD_REQUEST` with the message (a plain
     throw is sanitized to "Internal server error" by `trpc.ts`); the
     tRPC/route set includes `status.browse`'s own path input, the history
     path filter, and chat's `boxRelativePathSchema` (all verified round-1
     bypasses). Tests assert the caller-VISIBLE message, not the internal
     one.
  3. **CLI, per command not per helper**: there is no shared path-arg
     helper. Guard the commands that take box paths from users/agents:
     `validate` (note: it treats `/_config/x` as an OS-absolute path — its
     guard also normalizes that reading), `ls`/glob expansion (a
     `Config:*.card` glob currently returns a successful EMPTY match —
     silent), `mv`, `rm`, `create` — inventoried by grepping CLI commands
     for path-typed positionals during implementation, with the found list
     recorded in the commit message.
- **Suggestion-on-failure for the bare form** — at caller DIAGNOSTIC
  boundaries only (round 1: the namespace fence 403s bare non-area paths
  before any existence check, so the resolver is the wrong layer): where a
  caller already renders a not-found/denied message and has the box root in
  hand, it may probe whether `/_content/<path>` resolves and append "— did
  you mean `/_content/<path>`?" (suffix-preserving, never auto-resolving,
  phrased as a suggestion). Implemented only where the message already
  exists (ref lint's broken-ref text, the browse 404 path); dropped
  anywhere it would add filesystem work to a lexical layer.
- **Agent guide**: one sentence added to the display-vocabulary passage:
  display forms are for conversation; tools and refs take canonical paths,
  and the error message will say so if one leaks.

## Could this be simpler?

The simplest version is choke point 1 alone (it closes the only silent
hole). Points 2–3 are the same three-line check reusing the same detector
and message — cheaper to add now than to re-find the surfaces later; the
suggestion-on-failure is message-text only. Skipping the bare-form
suggestion entirely would be acceptable; it is included because the bare
form is the display vocabulary's most common shape.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Display-form ref written to a card | planned (lint doctest) | new error, pre-external-classification | clear (was SILENT) |
| Display form in an HTTP/tRPC path input | planned (route doctest) | namespace resolver rejection | clear |
| Display form as a bbx CLI path argument | planned (CLI doctest) | shared normalization rejection | clear |
| A real external scheme colliding with an area label (`config:` URL scheme) | n/a | no registered URI scheme is `config`/`bookkeeping`/`publish`/`tmp`/`content`; collision risk accepted | clear (rejected with the display-form message) |
| A content file literally named `Config:x` | not planned | colons are effectively absent from card names; the guard makes such names unaddressable by canonical-form workaround (`/_content/Config:x` still works) | accepted |

## NOT in scope

- Auto-translating display forms at any boundary (accepting them would fork
  the path vocabulary; the settled rule is reject-with-guidance).
- Claude Code's own filesystem tools (Read/Write/Bash) — outside the
  engine's reach; the PostToolUse hook already runs only on real files, and
  a display-form path simply ENOENTs there. The agent guide sentence is the
  mitigation.
- Voice/prose parsing ("in Config") — conversation, not paths.

## Rollout shape

Doctests per choke point (the ref-lint one asserts the pre-external
ordering explicitly); no migration; ships with the display-vocabulary
feature it guards.
