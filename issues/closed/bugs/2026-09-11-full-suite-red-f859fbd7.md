---
title: "Full-suite red: test/cli/commands/validate-box-checks.doctest.md, test/core/landmark/landmark-schema.doctest.md, test/core/loader-registry.doctest.md, test/webapp/trpc-presentation.doctest.md"
workstream: unattached
area: beebox
priority: important
resolution: implemented
filed-by: agent
discovered-by: agent
---

The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at
`f859fbd7`. Bisecting the landings since the last tested
commit (`a3331aef`) over first-parent `main` blames one landing:

- **Landing:** `f859fbd7` — fix(themes): theme names and stocks are an open set, not a catalog allowlist
- **Workstream:** none (a direct commit to main)
- **Failing files:** `test/cli/commands/validate-box-checks.doctest.md`, `test/core/landmark/landmark-schema.doctest.md`, `test/core/loader-registry.doctest.md`, `test/webapp/trpc-presentation.doctest.md`

Each file failed in the batched run and failed again on an isolated re-run, so
it is not a flake by the ledger's definition. Nothing has been fixed; this is a
report.

```
not ok 22 - test/cli/commands/validate-box-checks.doctest.md # time=977.736ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox
  externalID: test/cli/commands/validate-box-checks.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox/test/cli/commands/validate-box-checks.doctest.md
  jobId: 2
  exitCode: 1
  signal: null
  ...

# Subtest: test/cli/commands/validate-markdown.doctest.md
    # Subtest: validate-markdown.doctest.md:24 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 1 - validate-markdown.doctest.md:24 — const box = await makeTmpBox({ git: true }); # time=408.116ms
    
    # Subtest: validate-markdown.doctest.md:55 — isLintableMarkdown("_content/docs/saoirse.md")
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        ok 4 - (unnamed test)
        ok 5 - (unnamed test)
        1..5
    ok 2 - validate-markdown.doctest.md:55 — isLintableMarkdown("_content/docs/saoirse.md") # time=0.561ms

not ok 224 - test/core/landmark/landmark-schema.doctest.md # time=1386.087ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox
  externalID: test/core/landmark/landmark-schema.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox/test/core/landmark/landmark-schema.doctest.md
  jobId: 4
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/landmark/prominence-index.doctest.md
    # Subtest: prominence-index.doctest.md:28 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 1 - prominence-index.doctest.md:28 — const box = await makeTmpBox(); # time=94.545ms
    
    # Subtest: prominence-index.doctest.md:64 — const box = await makeTmpBox();
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        ok 3 - (unnamed test)
        1..3
    ok 2 - prominence-index.doctest.md:64 — const box = await makeTmpBox(); # time=46.843ms

not ok 229 - test/core/loader-registry.doctest.md # time=526.233ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox
  externalID: test/core/loader-registry.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox/test/core/loader-registry.doctest.md
  jobId: 3
  exitCode: 1
  signal: null
  ...

# Subtest: test/core/maps/maps-finalize.doctest.md
    # Subtest: maps-finalize.doctest.md:24 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 1 - maps-finalize.doctest.md:24 — const box = await makeTmpBox({ git: true }); # time=420.807ms
    
    # Subtest: maps-finalize.doctest.md:70 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)
        ok 2 - (unnamed test)
        1..2
    ok 2 - maps-finalize.doctest.md:70 — const box = await makeTmpBox({ git: true }); # time=398.492ms
    
    # Subtest: maps-finalize.doctest.md:116 — const box = await makeTmpBox({ git: true });
        ok 1 - (unnamed test)

not ok 771 - test/webapp/trpc-presentation.doctest.md # time=7218.238ms
  ---
  stdio: inherit
  cwd: /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox
  externalID: test/webapp/trpc-presentation.doctest.md
  command: ~/.nvm/versions/node/v24.18.0/bin/node
  args:
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/mock/dist/esm/import.mjs
    - --enable-source-maps
    - --import=file:///private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/node_modules/@tapjs/processinfo/dist/esm/import.mjs
    - --disable-warning=DEP0040
    - --import=tsx
    - --import=./test/helpers/isolate-user-home.ts
    - --import=agent-doctest/tap
    - --import=agent-doctest/loader
    - --import=./test/helpers/isolate-secret-store.ts
    - --import=./test/helpers/isolate-auth-file.ts
    - --import=./test/helpers/isolate-origin-id.ts
    - --import=./test/helpers/isolate-codex-home.ts
    - /private/var/folders/r2/19qcwg5d05nd8xs3lzpfp58c0000gn/T/full-suite-sBefJQ/checkout/beebox/test/webapp/trpc-presentation.doctest.md
  jobId: 3
  exitCode: 1
  signal: null
  ...

# Subtest: test/webapp/trpc-procedures.doctest.md
    # Subtest: trpc-procedures.doctest.md:48 — await attempt(() => caller({}).pub())
        ok 1 - (unnamed test)
        1..1
    ok 1 - trpc-procedures.doctest.md:48 — await attempt(() => caller({}).pub()) # time=3.749ms
    
    # Subtest: trpc-procedures.doctest.md:58 — await attempt(() => caller({ authed: true, isOwner: false }).owner())
        ok 1 - (unnamed test)
        1..1
    ok 2 - trpc-procedures.doctest.md:58 — await attempt(() => caller({ authed: true, isOwner: false }).owner()) # time=0.687ms
    
    # Subtest: trpc-procedures.doctest.md:69 — await attempt(() => caller({ isOwner: true }).owner())
        ok 1 - (unnamed test)
        1..1
    ok 3 - trpc-procedures.doctest.md:69 — await attempt(() => caller({ isOwner: true }).owner()) # time=0.324ms
```

Reproduce at the blamed landing:

```bash
git log -1 f859fbd7
pnpm --dir beebox exec tap test/cli/commands/validate-box-checks.doctest.md test/core/landmark/landmark-schema.doctest.md test/core/loader-registry.doctest.md test/webapp/trpc-presentation.doctest.md
```

## Fixed 2026-09-12 — three stale expectations, one already green

The blame was right and the production change was right: `f859fbd7` made theme
names and stocks an **open set**, so three of these four files were asserting
the old catalog-allowlist behaviour.

- `test/core/landmark/landmark-schema.doctest.md` — `system-theme: {name: paper,
  stock: purple}` was expected to be dropped as malformed. An unknown stock is
  not malformed any more; only the wrong SHAPE is. Split the section so it says
  which is which.
- `test/core/loader-registry.doctest.md` — a card theme of `{name: velvet}` was
  expected to resolve to plain. It now carries through as authored, which is the
  point: dropping it would let a box or schema default silently beat something
  the author wrote.
- `test/cli/commands/validate-box-checks.doctest.md` — the box-config validator
  no longer emits an "unknown stock" error, so only the path-pattern error
  remains. The prose claimed the validator checks catalog membership; it does
  not.
- `test/webapp/trpc-presentation.doctest.md` — green on re-run before any of
  these edits, so it was fixed between the report and now.

Full suite re-run green afterwards.
