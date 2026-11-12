---
title: "The site's Learn prompt opens directly in ChatGPT, Claude, or Perplexity"
workstream: unattached
area: site
labels: [site, agent-docs]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder idea, 2026-11-11"
---

The home page (`site/cards/index.site-page.card`) has a "Learn about Bee Box"
agent prompt that tells an AI to read `https://beebox.run/llms.txt` and
answer questions from it. Today a visitor can only copy it. Chat services
accept a pre-filled prompt in the URL, so the block could also offer
one-click links that open the prompt in the visitor's AI.

## URL forms (not yet checked)

- ChatGPT: `https://chatgpt.com/?q=<encoded prompt>`
- Claude: `https://claude.ai/new?q=<encoded prompt>`
- Perplexity: `https://www.perplexity.ai/search?q=<encoded prompt>`
- Gemini: no known supported pre-fill parameter; leave it out until one is
  found.

## Direction

- Give the `agent-prompt` Markdoc tag (`site/agent-prompt.ts`) an optional
  attribute that adds "Open in …" links beside Copy prompt, with the prompt
  text encoded into each URL at build time. Test it in
  `site/agent-prompt.test.ts`.
- Use it on the Learn prompt only. The Install prompt needs an agent that can
  act on the visitor's machine; a web chat would stall partway.

## Verify before shipping

Open each link in a fresh chat and confirm the service actually fetches
llms.txt and answers from those pages, and does not answer from what it
already knows. Some services fetch only with browsing or web search turned
on; if one does not fetch, drop it or adjust the prompt wording.
