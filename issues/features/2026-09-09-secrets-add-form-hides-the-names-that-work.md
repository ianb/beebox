---
title: "Adding a provider key means guessing its name — the Admin secrets UI never says which names the system recognizes"
workstream: unattached
area: beebox
priority: important
labels: [admin, secrets, onboarding]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "Huh, I can't see where I'd put in the openrouter api key...?" / "Why does it have a dropdown with just these two values? Then I have to put in a name too?"
---

Trying to add an OpenRouter key from Admin → Secrets, the boxholder found no
place to put it. The section shows **"Grant an existing secret to this box"**
first, with a dropdown offering `openai` and `replicate` — the only names
already in the machine store and not yet granted here. It reads like *the* way
to add a key, and OpenRouter simply isn't on the list.

The actual path is the **"Add a new secret"** button underneath, which opens a
free-text **Name** field whose placeholder is `e.g. weatherapi`. Nothing on the
page indicates that `openrouter` is a name the code specifically looks for, or
that spelling it `OpenRouter` / `openrouter.ai` / `open-router` produces a
stored secret every consumer silently ignores. Then, because
`secrets.setValue` only calls `setSecret`, the new secret still has to be
granted to the box in a second step — through the same dropdown that looked
like the add form.

Three failures stack: the grant form outranks the add form visually, the names
are undiscoverable, and a typo fails silently.

## The names are already known — nothing is guessing

Two registries enumerate them, and they agree:

- `beebox/src/core/secrets/uses.ts` — the name → what-it-powers map:
  `mistral`, `openai`, `openai-thinking`, `gemini`, `deepgram`, `anthropic`,
  `replicate`, `openrouter`, `google-oauth-client-id`,
  `google-oauth-client-secret`, plus the two family prefixes `telegram-bot/`
  and `publish/`.
- `beebox/src/core/secrets/probe-registry.ts` — which of those can be verified
  live (all but `anthropic`, `replicate`, the Google OAuth pair, and
  `publish/`).

So the add form can offer the exact list, using each name's prose from
`uses.ts` as the description of what granting it turns on. It stays free text
— a box may hold a key for something we've never heard of — but a recognized
name should be one click, not a guess.

## What to change

- **Offer the registered names in the add form.** A picker or datalist built
  from `uses.ts`, each entry showing what it powers; free text still accepted.
- **Warn on a near-miss.** `OpenRouter`, `openrouter.ai`, `open-router` should
  prompt "did you mean `openrouter`?" rather than storing a secret nothing
  reads. Case- and punctuation-insensitive matching against the registry covers
  the realistic typos.
- **Reorder so adding comes before granting**, or merge the two: adding a
  secret from a box's Admin page almost always means "and use it here."
  Granting in the same submit (with the Access select moved into the add form)
  removes the second step; if there's a reason to keep them apart, the add form
  should at least say what happens next.
- **Give `openrouter` a `format-registry.ts` entry** — it has none, so it is one
  of the few provider keys with no format hint and no paste-time validation,
  unlike `openai`, `anthropic`, `gemini`, `deepgram`, `mistral`.
- **Say what a name is worth before the key is typed.** `uses.ts` already
  records that an OpenRouter key covers search embeddings, audio questions,
  scan-vision descriptions, the Whisper HQ pass, MAI-Transcribe-2, Gemini TTS,
  and the view adapter. That belongs on the page — it is the argument for
  pasting the key at all.
