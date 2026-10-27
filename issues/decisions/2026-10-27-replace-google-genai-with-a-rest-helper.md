---
title: "Replace @google/genai with a small REST helper?"
workstream: unattached
area: beebox
labels: [dependencies]
filed-by: agent
discovered-in: dep-reduction — dependency inventory, 2026-10-27
---

`@google/genai` is a beebox runtime dependency with about 17.8 MB and 14
packages that nothing else in the repo pulls. It is also one of two routes to
`google-auth-library` (11 MB), which stays installed while either route does.

beebox uses it for four `generateContent` calls with `inlineData` and
`responseSchema`: `src/core/audio-question.ts`,
`src/core/describe-images/gemini.ts`, `src/dev/gen-image.ts`, and
`src/core/generate-doc-images/render.ts`. `src/services/tts.ts` already calls
the same Gemini REST API through `ky`, without the SDK.

A helper beside the `tts.ts` one would cover the four calls. Two things need a
decision before the swap:

- the response type each caller reads, which the SDK currently provides;
- how REST errors and empty responses map onto the existing errors (for
  example `GeminiEmptyResponseError`), and whether any retry the SDK does must
  be kept.

Inventory row: [dev/dependency-inventory-2026-10.md](../../dev/dependency-inventory-2026-10.md).
