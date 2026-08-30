---
title: "courseware image generation"
workstream: unknown
needs: [design]
area: beebox
---

Explored whether text-to-image earns a place in courseware (prior art:
`dmccreary/claude-skills` — `verified-infographic-generator`,
`interactive-infographic-overlay`; see `docs/plans/courseware-external-skills-triage.md`).
Parked as too complex to pursue now, but the shape of the answer is worth keeping.

The load-bearing fact: **text-to-image models can't be trusted with text or
numbers** — they confidently garble "+12%" → "+21%", misspell author names, and
render pseudo-text. Everything else follows from that.

Two viable patterns fall out, for different jobs:

1. **Text-free illustration + DOM/SVG label overlay** (the strong courseware
   case). Generate an *unlabeled* illustration, then lay any labels/callouts on
   top as real DOM/SVG with explore/quiz/edit modes. You never hand text to the
   image model, so there's nothing to garble. This is the right path for labeled
   diagrams (anatomy, circuits) and for backgrounds behind interactive figures.
   It would be a new figure *type* (likely a d3/SVG figure), and it implies a
   text-to-image step + an author calibration UX (drag markers, percentage-based
   coords).
2. **Verify → lock → render → audit** (only for fact/data-bearing images). The
   `verified-infographic-generator` pipeline: separate facts from pixels, verify
   every claim against sources, lock a layout spec where each number traces to a
   `source_id`, make exactly one image call with all text embedded verbatim
   ("render exactly, leave out rather than approximate"), then a post-render
   *multimodal* audit re-reads the pixels for drift (regen ≤3×). Heavy, and
   aligned with our cite-sources stance — but we don't really make stat-posters,
   so this is the less likely fit.

What we already have: the generation step is wired — `src/dev/gen-image.ts`
(Gemini 2.5 Flash Image) + `generate-doc-images.ts`. What these skills add is the
discipline *around* the call, not the call itself.

Bias to remember: courseware is interactive-first (p5/three/d3 figures + cited
prose). Generated images are static and lower-value; use them sparingly, mostly
as text-free backgrounds to annotate — not as the teaching surface, and never as
a fact-bearing artifact without the full verify-and-audit tax. Decorative
generated imagery also drifts toward the "AI aesthetic" we avoid.

Open questions if we ever pick this up: does the annotated-illustration figure
type earn its place (needs the overlay renderer + calibration UX)? Is a
text-to-image step something a *box agent* should invoke at all, or stays a
dev-side tool? How does the post-render audit fit our existing screenshot/render
verification for figures?
