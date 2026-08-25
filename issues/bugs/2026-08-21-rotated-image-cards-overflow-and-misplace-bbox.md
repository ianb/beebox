---
title: "A rotated image card overflows its panel and its subject box no longer matches the photo"
workstream: unattached
area: callback-box
labels: [user-stories-audit]
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — driving /browse to check the image-card user stories
priority: normal
---

An image card whose frontmatter carries `rotation: "90"` or `rotation: "270"`
renders the photo with a CSS `rotate()` transform. A CSS transform does not
change the layout box, so two things break at an orthogonal rotation.

**The image overflows sideways.** `Image` compensates for the rotation with
vertical padding only — `wrapOrthogonal` in
`callback-box/src/frontend/src/components/ui/Image.tsx:192` sets
`padding: "15% 0"`. The rotated image's visual width is the source image's
height. For a portrait source that is wider than the layout width, so the photo
starts left of the panel edge and is clipped by the viewport.

**The subject box no longer marks the subject.** `ImageCardRenderer` passes the
same `rotate(Ndeg)` string to `BboxOverlay`
(`callback-box/src/frontend/src/renderers/image.tsx:116-128`). The overlay is a
small absolutely-positioned box, sized in percent of the unrotated container
(`callback-box/src/frontend/src/components/ui/BboxOverlay.tsx:19-31`), and a
transform rotates it about its own centre. Rotating the marker about its own
centre does not map it onto the rotated image, so the purple rectangle lands
somewhere else in the frame.

Observed on `box/inbox/scan-20260429T0246-6c66f791.attach/photo-001.image.card`
and `box/inbox/scan-20260429T0320-15d9ae2a.attach/photo-001.image.card` in the
test1 clone. Image cards with no rotation render correctly.

Separate from the rendering: on both cards the stored rotation value is itself
wrong — the photo needs a quarter turn clockwise and the card says `270`, so the
corrected result is upside down. The value comes from the vision pass, which
already records that it is best-effort
(`callback-box/src/services/scan-vision-claude.ts:13`, "Rotation is best-effort
(measured inconsistent)"). The contract is stated in
`callback-box/src/core/commands/scan-import-gemini.ts:103`: degrees clockwise
the image needs to be rotated to view correctly. Nothing in the UI lets a person
correct a wrong value.

Related: `../closed/bugs/2026-07-17-image-orientation-exif-boundaries.md` covers
EXIF orientation across upload boundaries. This is the separate `rotation`
frontmatter field and its rendering.

## Updating the user-story catalog

This issue is why [`browse/view-a-photo-card-with-its-analysis`](../../callback-box/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md) — a catalogue of what callback-box can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "callback-box/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["browse/view-a-photo-card-with-its-analysis"]}})

pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx callback-box/user-stories/pipeline/render.ts \
  > callback-box/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../callback-box/user-stories/README.md).

Catalogued as `browse/view-a-photo-card-with-its-analysis` in the [user-story catalog](../../callback-box/user-stories/catalog/2026-08-21.md).
