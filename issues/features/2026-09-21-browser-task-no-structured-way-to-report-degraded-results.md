---
title: "browser-task's coverage report has no channel for 'I couldn't get this' — a scan that silently dropped all images or couldn't satisfy a required field looks the same as one that succeeded fully"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A production box's first real `browser-task` run (a 33-record scan of a public
social page) came back with no `images` array on any record, even though the task's
prompt explicitly asked for photos/posters and the schema marks that field
`format: attachment`. Separately, 2 of the 33 records could not get a real
per-post permalink (two posts exposed no post-level
link); the executor put the page URL in `permalink` instead and explained the
substitution only in a free-text `notes` field.

## What's missing structurally

The batch's `coverage` object reports `scanned`/`stoppedAt`/`reason` about
*how far the scan went*, but has no field for *what it could not do*. Two
concrete gaps that fell into this hole:

- **Images**: nothing distinguishes "the executor tried to save images and
  failed," "the page had no images to find," and "images were never
  attempted" — all three look identical (`images` array absent). This matters
  for this box specifically because its content rule is that work photos come
  from a maker's own social profiles, so images are frequently the actual
  point of a scan, not incidental to it.
- **Permalink**: the schema's `permalink` field is implicitly meant to be a
  stable per-record identifier (used as a dedup key across scans), but
  nothing in the schema or the batch shape marks it as ever-unreliable. The
  executor did the honest thing available (page URL + a notes explanation),
  but that means any downstream code treating `permalink` as unique has no
  structured way to know this record's value isn't one.

## Why the fix is not obvious

- Adding a general "problems" or "degraded" channel to the browser-task batch
  schema needs to decide its granularity: one flag per record vs. a
  free-form list of problem descriptors vs. specific typed fields per known
  failure mode (images-unavailable, permalink-unavailable). The narrower the
  schema, the more new failure modes will fall outside it again; the broader
  it is, the closer it drifts back to unstructured prose.
- A nullable `permalink` with a required reason when null changes the
  contract every consumer of `permalink` relies on (dedup logic, the drain,
  any card that references a browser-task record by its permalink) — this is
  a schema change with downstream callers to audit, not a additive field.
- Whether "no images came back" should be inferred by the drain (comparing
  what the prompt asked for against what arrived) or reported explicitly by
  the executor is itself a design choice: inference is fragile (a task that
  never asked for images looks the same as one that failed to get them
  without also checking the prompt text), but explicit executor self-report
  requires the executor to reliably notice its own gap, which is exactly what
  didn't happen here.

This is a general robustness point applying to any `browser-task` run whose
prompt asks for something the executor cannot fully deliver, not specific to
this one page or box.
