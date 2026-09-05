# Vision Braindump — 2026-02-27

## Motivation & Feelings

- Inspired by OpenClaw's success, but not by OpenClaw itself — feels like following on rather than originating
- But also: this draws on ideas he's been thinking about for a long time. Pieces keep feeling familiar. So not really following — parallel evolution
- Sense of hubris: believes he has something special, but hasn't proven it to anyone yet. Not one person
- This tension pushes toward going open source — needs meaningful discussion with people, and open source is a way to get that

## Open Source

- Should go open source. Question is when, not if
- What to open source:
  - **Thinking Machine** — maybe
  - **Bee Box** — maybe
  - **Cardworks** — feels like not something others would use directly, but wants to develop it as a separable idea. A common concept that's a little abstracted from the rest
  - **Agent Knowledge Audit** — strongest candidate for a standalone release. Could lead with a blog post

## Agent Knowledge Audit (blog post idea)

- Title idea: "Agent Knowledge Audit"
- Core concept: levels of knowledge, mapped to different kinds of questions
  - What level of knowledge do you expect for what kinds of questions?
  - Ask the agent self-knowledge questions: "How do you do X?"
  - Measure: does it answer correctly? How many resources does it look up?
  - Doesn't even measure time — that's not the point
- Categories are eclectic, with addendums like context tracking
- Key insight: **the test runner IS your coding agent**
  - No separate evaluation layer on top
  - The agent produces results AND interprets them
  - You could add LLM scoring cards, but why bother with a separate system when the agent can just do it?
- Wants to write a blog post about this approach

## What is Bee Box?

(from earlier in conversation)
- An execution environment with many things going on
- Reactive, scheduled, connectable to external services
- Not a fixed system — can consider what it's doing, understand its own processes
- Can interact with different people, identify them, understand things about them
- How the system itself works is a big part of the value

## Audience Problem

- Who is the audience? Fellow developers are obvious, but beyond that it's unclear
- Feels lost on getting attention — has made good quality content recently and gotten zero traction
- Knowledge Audit is the strongest lead because it's concrete (an answer, not a question)
- Most of the other things he could share are questions, not answers — harder to get people to engage

## Cardworks: Why XML, Why This Way

- Too obscure for a general audience — you'd have to already be into the project to care
- But the design decisions are genuinely interesting and he'd love input on them
- Could frame it as: "here's what I did and why, tell me why I should have done something else"
- Alternatives he considered: JSON, JSON Schema, XML validation languages, a custom XML language
- Why XML won:
  - Well parsed and understood
  - Agents perform certain actions better inside XML — less mental overhead than encoding into JSON. Feels like this still costs intelligence. Recent experiences confirm this isn't just legacy thinking
- Design principles:
  - References and semantic filenames — you can tell from the filename whether you want to traverse to it. No indirection, no metadata lookups
  - Files can be moved around safely because refs are validated
  - Validation is slightly tricky but works
  - Schemas are where it departs from standard XML — "falls off the XML rails" — but maybe that's fine
- Embedding semantics everywhere, avoiding indirection — this is a core value

## Bootstrapping & Process

- Telegram integration is bootstrapping — needs to interact with the system to discover what's good and not good
- Can't design in the abstract, has to experience it
- Wants the system to have good style — exemplary code that teaches the agent how to extend things
- Information processing: needs a good core more than extensibility. If the core is good enough, you don't reach for plugins
