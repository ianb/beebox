# Card validation hooks

How card validation reaches agents and commits inside a box. Installed
during `cb init` by `src/core/install-validation-hooks.ts`; the hook
commands embed the absolute path to the installing `bin/cb` so they don't
depend on the user's PATH.

`cb validate` checks all cards, a list of files, or `--staged`. Cards also
validate on load (`src/core/card-io.ts`).

Three hooks are installed per box:

- `.claude/settings.json` — PostToolUse hook running `cb validate --hook`
  after Edit/Write/MultiEdit. On a card path with errors it exits 2 with
  the error on stderr so Claude Code surfaces it to the agent (warning,
  not blocking).
- `.git/hooks/pre-commit` — runs `cb validate --staged`; blocks commits
  that include cards failing validation.
- `.git/hooks/post-commit` — fires `cb validate --urls --urls-since
  HEAD~1` in the background (non-blocking) to HEAD-check *external*
  http(s) URLs the first time they appear. Warning-only, never gates;
  verdict cache is gitignored at `.callback-box/url-checks.json`. The
  synchronous lint never touches the network — only this pass does. See
  `docs/implemented-plans/external-url-validation.md`.

## Canonical ref form (`--canonical`)

Refs should be written from the box root (`/store/notes/Plan.doc.card`); the one
exception is a card's own `attach/…` scope. A document-relative ref still
resolves — liberal resolution is permanent (`src/shared/ref-path.ts`) — but it
means something different depending on where the document lives.

`cb validate --canonical` reports every ref written in the relative form, naming
the box-root rewrite for each, with a two-bucket summary: card refs (frontmatter
`ref`/`refs`, body Markdoc `ref=`, body links, view `cardRef=`) and `.md` dossier
links. `--canonical --fix` performs those rewrites in place — but only for refs
whose target actually exists; a dangling or box-escaping ref is reported and left
alone. The rewrite is text-surgical, so frontmatter key order and `?query` /
`#fragment` suffixes survive untouched.

**Box-root-intent rescue.** Old system code wrote bare refs meaning them from
the box root — a question card's `ref: box/inbox/scan-….capture-session.card`, a
chat thread's `participants[0].ref: people/Ian_Bicking`. Read
document-relative, those dangle; read from the box root they resolve. So when a
non-canonical ref's document-relative target does **not** exist, `--fix` tries
the same bare path from the box root, and if *that* target exists writes the
`/`-leading form — turning a broken ref into a working one. Repairs are counted
and reported separately from ordinary canonicalizations (which only change how a
ref is written, never what it points at), and the report mode marks them
`→ /box/inbox/… (repairs dangling ref)`.

The rescue is **strictly gated by an ambiguity guard**: if both readings name an
existing file, the ref is left exactly as written and reported as ambiguous. The
document-relative reading is what resolves at runtime today, so such a ref
already works — rewriting it either way could silently retarget it, and that
call belongs to a human. Same for a ref neither reading resolves: reported, never
rewritten.

It is **off by default and never runs in the hooks**: a box carries legacy
relative refs by the hundred, and warning about them in every validate run would
bury the broken-ref signal that actually needs acting on. It is a whole-box check
— it does not combine with `--staged`, explicit paths, `--hook`, `--links`, or
`--urls`, which error rather than half-work. Design rationale:
`docs/implemented-plans/box-root-paths.md` (Track F).

Format reference: `docs/cards-as-markdown.md`; design history and migration phases: `docs/implemented-plans/cards-as-markdown-rfc.md`.
Per-schema migrators: `scripts/migrate/*.ts` + `scripts/migrate/_warnings.ts`
(noisy-mode field-loss detection).
