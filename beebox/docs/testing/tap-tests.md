# TAP tests
**Location:** `test/*.test.ts`
**Runner:** [tap](https://node-tap.org/) v21 with tsx
**Run:** `pnpm test`

Reserved for things that would be circular as doctests: testing the test infrastructure itself.

**Current files:**

| File | Tests |
|------|-------|
| `test/check.test.ts` | Wildcard matching, extractions, diff output, serializers, inspect() |
| `test/doctest.test.ts` | Doctest parser and generator (meta-testing) |

# The tap plugin set is built at install time

`.taprc` disables `@tapjs/typescript` (`plugin: - "!@tapjs/typescript"`) because
tsx and the doctest loader resolve TypeScript here, and the typescript plugin's
loader runs ahead of them and cannot resolve an extensionless directory import
(`ERR_UNSUPPORTED_DIR_IMPORT` on `src/frontend/src/lib/trpc`).

That configured set only takes effect after `tap build`, which regenerates the
Test class in `node_modules/@tapjs/test/test-built/`. tap does rebuild by
itself when the built set differs from the configured one — but it computes the
child processes' `--import` arguments from the *already loaded* class before it
rebuilds, so the run that triggers the rebuild still spawns its children with
the default plugins. Every `pnpm install` re-links `@tapjs/test` from the store
and restores the shipped default build, so "the first tap run after an install
uses the wrong loaders" is deterministic, not a flake.

The monorepo root's `postinstall` therefore runs `tap build` (~3s) after
`patch-package`, so every workspace install builds it — a fresh worktree, a
detached checkout, a deploy. It lives at the root rather than in
`beebox`'s own `postinstall` because `beebox` is packed and
installed as a tarball dependency by boxes: a `postinstall` there would run
in a consumer install that has no `tap` (a devDependency) and fail it.
`tap plugin list` prints the *configured* set and never shows this; the built
set is what `tap versions` lists under `plugins:`.

See issues/closed/bugs/2026-08-25-fresh-checkout-tap-default-plugins.md.
