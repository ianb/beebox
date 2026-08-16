# Security regression scanner (OpenGrep)

`precise.yml` is a small [OpenGrep](https://opengrep.dev) rulepack of
**self-incident security-regression guards**. Each rule encodes one real past
security/isolation bug in *our own* code and fails if that exact shape returns —
the security analog of a regression test. Borrowed from OpenClaw's
`security/opengrep/` discipline (they key rules to GHSA advisories; we run no
GHSA process, so we key to our own `issues/`/commit records instead).

This is a **separate scanner from lint**, on purpose. ESLint selectors match a
single AST node (good for `os.tmpdir()` bans); OpenGrep `pattern:` blocks with
`...` express multi-statement dataflow — a `resolve(...) → if-guard → return`
sequence — which is how real vulnerabilities actually look. Reach for a rule here
when the shape you want to forbid spans more than one statement, or when the ban
is security-critical enough to want a second, independent engine on it.

The pack **starts nearly empty and grows one incident at a time.** The value is
having the machinery and the habit ready, so that the first time we ship a real
security bug, fixing it also means adding the guard that stops its return.

## Running

```bash
pnpm security:opengrep            # scan repo, human output (non-failing)
pnpm security:opengrep --error    # gate mode: non-zero exit on any finding
pnpm security:opengrep --changed  # only paths changed vs origin/main (PR-diff scope)
pnpm security:opengrep --sarif    # SARIF to .opengrep-out/ (CI/triage)
```

Install OpenGrep (pinned to match any future CI):

```bash
curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/v1.25.0/install.sh | bash -s -- -v v1.25.0
# or: brew install opengrep/tap/opengrep
```

## Adding a rule

Add a real past security bug — not a style preference (that's ESLint's job) and
not an upstream-dependency CVE (that's `pnpm audit`). Every rule must carry
provenance metadata so its reason to exist is traceable:

| Key               | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| `category`        | `security`                                                   |
| `cwe`             | CWE id(s), e.g. `CWE-22`                                      |
| `advisory-id`     | our incident id (issue slug / commit)                        |
| `advisory-url`    | durable pointer (an `issues/…md` path or commit)             |
| `detector-bucket` | `precise` — keep it low-noise enough to run as a blocking gate |
| `source-rule-id`  | the rule's own id                                            |

Scope each rule with `paths.include` to the directory the bug lives in, and add a
fixture-based check that it both passes on the fixed code and fails on a
reintroduction before committing.

## Not yet wired

Blocking pre-commit / CI integration is a deliberate follow-up (it requires every
committer to have `opengrep` installed, and our flow is trunk-based rather than
PR-based). Tracked in
[`issues/exploration/2026-07-25-opengrep-self-cve-scanner.md`](../../issues/exploration/2026-07-25-opengrep-self-cve-scanner.md).
OpenClaw also compiles rules from source YAML via a `compile-rules.mjs` step that
injects provenance and validates metadata; at one rule we hand-author
`precise.yml` directly — adopt the compiler if the pack grows enough to need it.
