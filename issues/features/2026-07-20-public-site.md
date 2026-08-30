---
title: "Public site — un-polished on purpose, cool some other way"
workstream: open-source-readiness
needs: [design]
area: docs
filed-by: agent
discovered-in: worktree-open-source-readiness — launch-readiness conversation with the boxholder
labels: [soft-launch]
priority: important
---

The launch front door is the README (see
[soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md)), but
the boxholder floated a GitHub Pages site as a follow. The design constraint
is unusual and load-bearing: it should **NOT look polished** — a slick
landing page would misrepresent what this is (a personal system shared
honestly, not a product) — "but maybe it should look cool in other ways…?
Probably so."

Directions worth exploring when this gets picked up: generated-from-the-box
content (the system demonstrating itself), a live/regenerable demo artifact
(cf. [regenerable-app-demo-video](2026-07-17-regenerable-app-demo-video.md)),
hand-drawn/plain-HTML aesthetics, the agent maintaining the site the same
way it would maintain [the security report](../closed/features/2026-07-20-agent-maintained-security-report.md).
The positioning content is already worked out in the competitive research
(cards-first vs chat-first; enforced-in-code vs doctrine —
[research synthesis](../../research/CLAUDE.md)).

An earlier incidental mention of a homepage lives in
[writing-skill](2026-07-05-writing-skill.md) (explicitly not that issue's
driver). Not a launch gate.

## Principles (settled in discussion, 2026-07-21)

Boxholder's words quoted; the rest is agent structure.

- **The objection to slick is aesthetic, and it's about genericness.** A slick
  landing page "makes no claim and feels more generic, feels less authentic" —
  especially now that slick is the AI default. Cool is wanted, "but not… a
  polished front page with hero images and stuff, but something that feels
  cool in a different way. And I'm not quite sure what that is."
- **Build up from minimal to cool.** Start "not just simple but spare, like,
  nonprofessional, antiprofessional almost" while staying tech-professional;
  iterate toward interesting. Calibration: danluu.com is *more* spare than
  wanted — "reasonable margins, specified fonts" are fine; "don't use courier,
  for instance, feels forced"; "colors could be bold, but something we'd add
  not start with."
- **His voice carries the human-facing content.** Possibly composed inside a
  box (undecided). The [writing-skill](2026-07-05-writing-skill.md) principles
  apply to the site: "AI _structure_ can be fine, but AI _words_ not so much."
- **Two audiences, visibly separated.** The human page in his voice; machine-
  generated material as fetchable text files whose audience is agents. Adopt
  the LLM-text conventions (llms.txt etc.); "it should be very valid to
  interact with the site primarily through an agent" — while the site also
  demonstrates the project is more than that.
- **Static, precalculated.** Not "wired up to AI" — no live demonstration; the
  site "could demonstrate things in ways by precalculating things."
- **Generated on deploy, sourced from the repo.** The site should be able to
  "base the public site on other parts of the repo (like issues)" — a real
  generator, not hand-maintained HTML. Must be viewable on the dev router AND
  deploy to GitHub Pages.
- **Screenshots only if automated.** "If we do screenshots it's going to be
  something fancier and more automated than just throwing a couple in" (cf.
  tours / [regenerable-app-demo-video](2026-07-17-regenerable-app-demo-video.md)).
- **Nonlinear presentation is the design exploration.** "I want to think about
  nonlinear ways to present ideas. I'm imagining a fisheye approach" —
  clarified (2026-07-21) as "kind of like infinite chained footnotes. A little
  like a wiki, but visually different structure" (expand-in-place; the
  telescopic-text / StretchText lineage).
- **Idea extraction with reinterpretation.** Agents "pluck out ideas" from
  repo sources (issues, plans, docs, research) as provenance-carrying
  *nuggets*; the danger of presenting AI ideas is handled by making them
  "nuggets that I'm asked to reinterpret" — nothing publishes without his
  rewrite or a verbatim excerpt. "Some interesting git workflow to keep that
  up to date" — source-span content hashes checked at build for staleness.
  Boxholder notes this is "really a beebox feature" — prototype it
  here, move the idea into the box later. Embeddings optional/later
  (clustering, related links). Confirmed enthusiastically (2026-07-21): "I
  REALLY like the idea extraction… It's also the-story-of-beebox,
  which is kind of the point of the page" — the extracted-and-reinterpreted
  ideas ARE the site's content spine, telling the project's story, not
  decoration behind a letter.
- **Bootstrap by hand first**; the
  [agent-maintained](../closed/features/2026-07-20-agent-maintained-security-report.md)-style
  ongoing loop is a plausible later phase, "not unreasonable" but "we'd have
  to bootstrap it first."
- **Two derivation tiers** (2026-07-21): "Some of the aspects of the site
  derived from source will probably be agent-powered, with periodic updates
  based on git and tracking. So we don't need to wire everything hot" —
  mechanical checks run every build; agent-derived content is committed,
  commit-stamped, refreshed periodically, with the build displaying drift
  rather than regenerating.
