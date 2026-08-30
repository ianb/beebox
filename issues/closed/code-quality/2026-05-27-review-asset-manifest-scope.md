---
title: "review asset manifest scope"
workstream: unknown
area: beebox
resolution: wontfix
---

> **Closed 2026-08-24 — moot.** Both questions this issue poses are about a
> scheme that no longer exists. The manifest system was retired by the git-annex
> migration: `docs/assets.md` records "3,655 manifests removed", the old
> `docs/asset-manifests.md` is now `docs/implemented-plans/asset-manifests.md`,
> and every box verifies "no manifests, no LFS". So there is no per-dir manifest
> to compare against a per-asset sidecar, and no manifest-scoped enforcement to
> tighten or loosen.
>
> The live remnant is tracked separately:
> [retire remaining asset-manifest writers](../../code-quality/2026-08-18-retire-remaining-asset-manifest-writers.md)
> — code that still writes manifests after the scheme was retired.

The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside attach scopes commit normally, with a soft "this is big, consider moving it" advisory. Revisit once we have real usage: if agents routinely drop binaries outside attach scopes anyway (logs, screenshots, scratch files), either tighten enforcement (gitignore more aggressively, hard-block large binaries anywhere), or accept the looser model and beef up the advisory. Also worth revisiting: per-dir JSON manifest vs per-asset sidecar — if per-dir produces noisy diffs in practice, the sidecar form is a drop-in replacement.
