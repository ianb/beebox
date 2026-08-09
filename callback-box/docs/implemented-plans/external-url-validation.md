---
title: "External URL validation (`cb validate --urls`)"
status: implemented
workstream: unknown
issues: []
---
# External URL validation (`cb validate --urls`)

Extends the internal-link validation (CB001/CB002 + `cb relink`) to **external**
http(s) URLs in cards and markdown: HEAD a URL the *first time it appears*, never
re-checking every URL on every run, and never blocking a commit or edit on flaky
network.

## Settled decisions

1. **New-URL detection is pure git, no "seen" ledger.** A URL is "new" iff it is
   present in the current content but **not anywhere in the base version**:
   `new = URLs(current) − URLs(base)`. A URL that existed anywhere before is never
   re-checked. This is the literal "don't validate a URL that was present before".
2. **Re-check policy: new + known-bad only.** New URLs get checked; previously
   *broken* URLs get re-checked (to catch a fix); known-*good* URLs are never
   re-touched unless `--all` forces a full sweep.
3. **Command surface: `cb validate --urls` flag** (sibling of `--links`), with
   `--all` (full box sweep, ignore git), `--staged` (new in the index), and
   `--since <ref>` (new vs an arbitrary ref) modes.
4. **Trigger: post-commit, non-blocking.** Detecting new URLs is instant + offline
   (git diff + regex); only the HEADing is slow. A managed post-commit block
   detaches `cb validate --urls --since HEAD~1` in the background, so the commit
   never waits on the network. The sync lint (pre-commit / PostToolUse) stays
   offline — it never gains network I/O. Warning-only; never gates anything.
5. **Verdict state is gitignored**, at `.callback-box/url-checks.json`. Committing
   it would dirty the tree after every commit (the post-commit pass writes it).
   Detection is git-based; only the cached verdicts are local + private. A fresh
   clone forgets known-bad until an `--all` sweep rebuilds it — acceptable.

## State file: `.callback-box/url-checks.json` (gitignored)

```jsonc
{
  "version": 1,
  // Hard-broken URLs still referenced somewhere. Re-checked each run; reported
  // until fixed or no longer referenced. Pruned when healed/unreferenced.
  "broken": {
    "https://example.com/gone": { "status": 404, "since": "2026-…", "lastChecked": "2026-…" }
  },
  // Inconclusive (timeout/5xx/conn-reset) results awaiting a definitive verdict.
  // Retried each run until they resolve to ok (forget) or broken (promote).
  "pending": {
    "https://flaky.example/x": { "attempts": 2, "lastTried": "2026-…" }
  }
}
```

Good URLs are stored nowhere — git's "was it present before" is the dedup.

## Classification

- **Hard-broken** (flag): 404, 410, DNS NXDOMAIN.
- **Transient** (never flag; → pending, retried): timeout, 5xx, 429, conn-reset.
- HEAD first; on 405/501/403 retry a bodyless `GET` (`Range: bytes=0-0`).
- Follow redirects (capped). Reuse `assertPublicHttpUrl` (proxy-image.ts) for the
  SSRF guard *and* the local/private skip-list — never HEAD an internal address.
- Skip list: non-http(s) schemes, `#anchor`, reserved doc domains
  (`example.com/.org/.net`, RFC 2606), anything the SSRF guard rejects.
- Box-wide dedupe to a unique URL set; capped concurrency (~6); per-request timeout.

## Modules

- `src/core/external-url-check.ts` — URL extraction, git base/current URL sets,
  the HEAD/GET checker + classifier, the gitignored verdict cache, orchestration
  (`checkExternalUrls(boxRoot, { mode })`).
- `src/cli/commands/validate.ts` — wire the `--urls` flag (+ `--since`).
- `src/core/install-validation-hooks.ts` — add a marker-delimited post-commit
  managed block that coexists with the existing git-lfs post-commit hook.

## Watch-outs

- The sync markdown lint (PostToolUse + pre-commit) stays sync + offline. Network
  lives only in the `--urls` pass.
- Post-commit must not dirty the tree → verdict state is gitignored.
- Must not regress CB001/CB002 or the `--links` warning pass.
</content>
</invoke>
