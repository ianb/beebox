---
title: "The public list of outside services has drifted from the code, and nothing checks it"
workstream: unattached
area: docs
labels: [public-site]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-fabric-research — Fabric's privacy page names one AI vendor while its product offers ten; checked whether ours has the same gap
---

`llms.txt` carries the `site/docs/README.md` preamble, which names the
outside services a box uses and points at the full list in
`beebox/docs/development/technologies.md` ("AI services used"). Page
`site/docs/10-your-data-and-safety.md` describes what leaves the machine. The
[provider honesty decision](../closed/decisions/2026-07-08-release-cloud-provider-honesty.md)
made that disclosure a release requirement. The list exists; it is not current.

Checked against the code on 2026-10-17:

- **Gemini speech goes to Google directly.** `technologies.md` and the README
  preamble say "Gemini through OpenRouter". `beebox/src/services/tts.ts`
  calls `generativelanguage.googleapis.com` with the box's `gemini` key and
  calls it "the only route". **Fixed 2026-10-17** in both places, with the
  developer's approval for the blockquote: OpenRouter proved too slow and
  unreliable as a proxy for speech.
- **Replicate is missing.** `beebox/src/core/secrets/guide-registry.ts` has a
  `replicate` key "used only by box views that call it through the
  server-side adapter". No public page names Replicate.
- **GLM (z.ai) as the agent's model provider is missing from
  `technologies.md`**, which says the agent runs on Claude or Codex. Page 10
  names GLM and OpenRouter models.
- **The OpenRouter routing model is missing from `technologies.md`.** Quick
  chat, the filing judge and change watches send text through OpenRouter
  (page 10 says so); the "only services box data leaves for" paragraph does
  not.

## Why it drifted

The weekly `agent-docs-refresh` schedule
(`schedules/agent-docs-refresh/prompt.md`) is the only upkeep. It maps the
week's commits to pages by judgment, so a provider that arrives inside a
feature commit (a TTS route change, a view adapter) is not seen as "a change
to what leaves the machine".

## Proposal

A mechanical check, so the list cannot fall behind silently:

- The secrets guide registry is already the closed list of provider keys a
  box can be granted (`glm`, `openrouter`, `openai`, `gemini`, `mistral`,
  `deepgram`, `anthropic`, `replicate`, Google OAuth). Every outbound model
  service needs a key there.
- Give each registry entry a `disclosedAs:` name, or a `notOutbound` reason
  for a key that sends no box data.
- A `doc-check` rule (or a site build test) fails when a `disclosedAs:` name
  does not appear in the "AI services used" section of `technologies.md`.
  The README preamble may stay a summary that points there.

Not covered: a service reached without a registry key, such as Apple and
browser push, Cloudflare publishing, or Tailscale. These change rarely and
stay with page 10 and the weekly refresh. A test that greps `beebox/src` for
outbound hosts would catch them too, but with more noise.

## Open questions

- Is `technologies.md` the canonical list, or should page 10 own it and
  `technologies.md` link there? The check needs one target.
- Does Replicate stay as a view adapter? If it is a test feature, the
  answer may be to remove it rather than disclose it.

Re-reviewed 2026-10-30: the 'AI services used' section now names the pi engine via OpenRouter, but still omits Replicate, GLM, and the OpenRouter model behind quick chat and the filing judge. No mechanical check exists.
