---
title: "Published pages can never carry a submit form — nothing sets a manifest's submit block or renders a form"
workstream: unattached
area: callback-box
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
stories: [publish/collect-replies-from-a-published-page]
---

The publish "drop box" (Track F of `callback-box/docs/plans/publish-pages.md`) is complete on the receiving side but has no producing side, so no reader can ever post a reply.

**What is wrong**

- `pub-worker/src/submit.ts` `handleSubmit` refuses with 403 unless the fetched manifest has a non-null `submit` block (lines 100-105).
- Nothing ever writes that block. `draftPublication` (`callback-box/src/publish/draft.ts`, the rawManifest at ~lines 202-217) has no `submit` key, and `cb pub draft` (`callback-box/src/cli/commands/pub.ts`) exposes no flag or card field for one. Grepping `submit:` across `src` and `pub-worker/src` finds it only as a zod field in `src/publish/manifest.ts` / `manifest-edge.ts` (and `toEdgeManifest`'s pass-through at manifest.ts:176-189).
- No form is rendered either: `src/publish/render-docs.ts` emits Markdoc HTML with no `<form>`, and `grep -rn '<form' src/publish pub-worker/src` returns nothing. The plan specifies plain HTML form POSTs (`form-action 'self'` is already in the Worker CSP, `pub-worker/src/headers.ts:28`).

**User-visible consequence**

A boxholder cannot publish a page that collects replies, and a reader has no form to post. Everything downstream of the endpoint is dead in practice: `validateSubmissionFields` (`src/publish/submission.ts`), the `submissions/<pubId>/<id>.json` objects, the pull connector `src/connectors/publish-submissions.ts` (registered live at `src/cli/commands/wakeup-connectors.ts:41`), and the `pub-submission` inbox card schema. The Worker also carries submit-specific rate limiting, size caps and Access-tier submitter resolution that can never be exercised outside tests.

**Files involved**

- `callback-box/src/publish/draft.ts` (manifest assembly — no `submit`)
- `callback-box/src/cli/commands/pub.ts` (`cb pub draft` — no flag)
- `callback-box/src/publish/render-docs.ts` (renderer — no form)
- `callback-box/pub-worker/src/submit.ts`, `callback-box/src/publish/submission.ts`, `callback-box/src/connectors/publish-submissions.ts` (the built, unreachable half)

**How this was established**

Read the manifest assembly path end to end, grepped for every `submit:` assignment and every `<form>` in `src/` and `pub-worker/src/`, and confirmed the 403 guard in `handleSubmit`. Two independent panel lenses (exists, reachable) reached the same conclusion from opposite directions: the code exists and is wired, but has no entry point.

**Related**

`issues/features/2026-07-19-publish-pages-resume.md` tracks the feature's remaining work; its end-to-end step ("a secret-tier submission → confirm the connector lands a pub-submission card") presumes an authoring path and form that do not exist. This may belong folded into that issue rather than standing alone.

## Updating the user-story catalog

This issue is why [`publish/collect-replies-from-a-published-page`](../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["publish/collect-replies-from-a-published-page"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../callback-box/user-stories/README.md).
