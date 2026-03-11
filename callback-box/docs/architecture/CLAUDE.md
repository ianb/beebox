# Architecture Docs

This directory contains architecture documentation told through the story of a fictional family (the Lund-Vegas). The docs are a mix of narrative, technical explanation, and design exploration.

## Steering docs (not user-facing)

These files guide the writing but aren't part of the final documentation:

- **`spirit.md`** — Values compass. The feelings and principles we're trying to protect. If something in the architecture contradicts this, the architecture is wrong.
- **`family.md`** — Character reference for the Lund-Vega family used in all examples. Detailed bios, relationships, household details. Draw examples from their actual lives, not simplified versions.
- **`outline.md`** — Working outline for the architecture docs. Section structure, story ideas, open design questions.
- **`image-gen.yaml`** — Configuration for illustration generation (style, model, API key env var).

## Illustrations

Illustrations use a primitive crayon/outsider-art style (configured in `image-gen.yaml`). All images live in `images/`.

**Image prompt format in markdown:**
- Portraits: `![type:character Name | prompt text](images/name-portrait.png)`
- Scenes: `![Name1 Name2 | prompt text](images/scene-name.png)` — names reference character portraits for visual consistency

Each image has a `-prompt.json` sidecar file that caches the prompt hash. If the prompt or style changes, the image regenerates; if the hash matches, it's skipped.

**To generate/regenerate images:**
```bash
npm run generate:doc-images           # all images in architecture docs
npm run generate:doc-images -- --file diana  # just Diana's portrait
```

Requires `SKE_GEMINI_API_KEY` env var. Uses `gemini-2.5-flash-image` model via `@google/genai` SDK.

## Writing guidelines

- Tell stories first, then explain the architecture that makes them work
- Use the Lund-Vegas as running examples throughout — specific, messy, real-feeling
- Some sections are design exploration (especially around feedback/adaptation) — use the stories to figure out what things should look like, not just document what exists
- Mark things that are one-step aspirational vs. working now
- See `spirit.md` for tone — avoid AIisms, stock cheerfulness, enterprise-speak
