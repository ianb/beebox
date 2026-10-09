# Acknowledgements

Bee Box uses ideas from other projects, people, and publications. This file names them.

An entry appears here when we adopted an idea, changed it to fit, or used it as a direct model, and the result is in this repository today. Ideas that we only evaluated do not appear. Each entry names the source, what we took, and where it landed.

Licensed assets that we redistribute are listed at the end. The research notes under [`research/`](research/) record the projects we evaluated, including the ones we took nothing from.

Add an entry in the same commit that lands the idea. Name the source as its project presents it, link it, state its licence, say what we took in one line, and name the file it landed in.

## Ideas we adopted

### Visual references for expressive themes

- **Sources:** Stephen Westfall, *The Tall Grass* (2025); No7er, *Fries 2000* (r/ImaginaryColorscapes); [Saigetsu](https://saigetsu1225.booth.pm/), [pink cloud and star illustration](https://www.instagram.com/p/DcDO6wYM6pv/). Attribution follows the reference images supplied by the boxholder.
- **What we took:** Harlequin interprets elongated pigment wedges and unexpected color relationships; Electric Playground interprets perspective grids, translucent geometry, and printed digital texture; Daydream interprets sweeping clouds, irregular starbursts, and pastel speckling.
- **Rights:** Original artworks remain their artists' work; no licence to redistribute them is claimed and the source images are not bundled. The CSS and SVG ornaments here are newly authored interpretations.
- **Where it landed:** `beebox/src/frontend/src/themes/{harlequin,electric-playground,daydream}.css` and `themes/art/`.

### Material theme references

- **Sources:** Lambie, *Wool painting (Ray of Light)* (2021), supplied reference; [José Carlos, February 1927 *Para Todos* cover](https://flashbak.com/para-todos-covers-brazils-gorgeous-1920s-art-deco-style-magazine-372408/); [Woonyoung Jung, *Will I become the Seoul superhero?*](https://woonyoung.tumblr.com/post/762184243663323136/will-i-become-the-seoul-superhero); [Graeme Daly, *Man's Best Friend*](https://cara.app/post/23e50b2a-988d-4342-bde5-df06fdec9199); [Alexey Gorboot, psychedelic priestess](https://www.instagram.com/alexeygorboot/p/DdEixmwIquA/); [Josh White, *Maiden Voyage*](https://www.artstation.com/artwork/xD1yWY). Attribution follows the references supplied by the boxholder.
- **What we took:** Selvedge interprets colored yarn and changing strand directions; Footlights interprets theatrical Art Deco fans and stepped frames; Overpass interprets saturated orange and distressed fine ink lines; Golden Hour interprets luminous warm pigment and cool granular color; Blacklight interprets flat fluorescent colors and heavy organic contours; Far Horizon interprets deep teal, rust, cream, and ochre layered in smooth sweeping paint.
- **Rights:** The source artworks are not bundled. CSS and SVG compositions are newly authored interpretations; three abstract paint/ink textures were generated with OpenAI image generation from material and palette descriptions. No source artwork is used in those textures, and no licence to redistribute the reference images is claimed.
- **Where it landed:** `beebox/src/frontend/src/themes/{selvedge,footlights,overpass,golden-hour,blacklight,far-horizon}.css` and their original assets in `themes/art/`.

### Agent Skills, by addyosmani (Addy Osmani)

- **Source:** https://github.com/addyosmani/agent-skills (MIT)
- **What we took:**
  - From `code-simplification`, `api-and-interface-design`, and `deprecation-and-migration`: behaviour-preserving simplification, Hyrum's Law as a check on interface changes, and "code is a liability".
  - From `frontend-ui-engineering` and `performance-optimization`: frontend habits (primitives first, data kept apart from presentation, loading, empty, and error states, an accessibility baseline, no "AI aesthetic") and reserved image space against layout shift.
  - From `context-engineering`: principles that we folded into our own box-prompt skill. These are attention budget over window size, write it down, why and not just what, an example beats a description, pointers and not copies, and ingested text as data.
  - From `spec-driven-development`: the "Common rationalizations" table (excuse, then reality) and the "Red flags" list, to stop an agent from talking itself past a rule. Superpowers' Common-Mistakes and Red-Flags structure was a second example.
  - From `spec-driven-development`: state a plan's done-when as testable criteria, that is, the tests that must pass.
- **Where it landed:** `beebox/frontend.md`, `.claude/skills/bbx-context/SKILL.md`, `.claude/skills/bbx-migration/SKILL.md`, `.claude/skills/bbx-plan/TEMPLATE.md`

### Agent Skills for Intelligent Textbooks (ibook-skills), by Dan McCreary

- **Source:** https://github.com/dmccreary/ibook-skills (CC BY-NC-SA 4.0)
- **What we took:**
  - Concept-graph construction rules (entity names, one teachable unit per node, no orphans, no degenerate chains), an orphan-node lint, and agent self-review of the map.
  - Claim classification by source support (verified, directional, qualitative, unsupported). Missing data is stated, not filled in.
  - A render check as part of figure authoring, and worked figure examples that include a categorization-sort practice.
- **Where it landed:** `beebox/src/schemas/concept-map.ts`, `beebox/src/core/box/guidance-sync/skills-content.ts`, `beebox/src/core/box/guidance-sync/skills.ts`

### Backward design, spiral curriculum, Bloom's revised taxonomy, by Grant Wiggins and Jay McTighe; Jerome Bruner; Anderson and Krathwohl

- **Source:** https://www.ascd.org/books/understanding-by-design-expanded-2nd-edition (book); Bruner, *The Process of Education* (1960); Anderson and Krathwohl, *A Taxonomy for Learning, Teaching, and Assessing* (2001)
- **What we took:** A course's success criteria as the destination, set first. `complements` cycles for concepts that are learned together. An optional Bloom target level for each node.
- **Where it landed:** `beebox/src/schemas/course.ts`, `beebox/src/schemas/concept-map.ts`, `beebox/src/schemas/progress.ts`

### claude-elixir-phoenix, by Oliver Kriska (oliver-kriska)

- **Source:** https://github.com/oliver-kriska/claude-elixir-phoenix (MIT)
- **What we took:** The `requirements-verifier` check. Each plan requirement is classified MET, PARTIAL, UNMET, or UNCLEAR against `file:line` evidence, never from commit messages and never with an invented citation. We run it as a step in finish that reports and does not block.
- **Where it landed:** `.claude/agents/finish.md`

### The Elm Architecture, by Evan Czaplicki

- **Source:** https://guide.elm-lang.org/architecture/ (guide text CC BY-NC-ND 4.0; we use the pattern only)
- **What we took:** The init/update/view program shape. A sketch's model is a pure fold of message data. Types, a runtime deep-freeze, a replay diff, and lint enforce Elm's purity in TypeScript.
- **Where it landed:** `canvas-loop/TEA.md`

### Flutter golden tests, by The Flutter Authors

- **Source:** https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html (repository https://github.com/flutter/flutter, BSD 3-Clause)
- **What we took:** The frame-stepped test shape. An injected event takes effect on the next stepped frame, and a snapshot is taken on demand.
- **Where it landed:** `canvas-loop/src/headless/runtime.ts`, `canvas-loop/README.md`

### Ghost-CLI, by TryGhost

- **Source:** https://github.com/TryGhost/Ghost-CLI (MIT)
- **What we took:** `ghost doctor` as a preflight gate that runs before upgrade. The Ghost-CLI rollback bug ([#699](https://github.com/TryGhost/Ghost-CLI/issues/699)) set our rule that code and data revert as one unit.
- **Where it landed:** `beebox/src/cli/commands/upgrade.ts`

### gstack, by Garry Tan (garrytan)

- **Source:** https://github.com/garrytan/gstack (MIT)
- **What we took:**
  - The shape of the `/codex` skill for cross-model review: a read-only reviewer from the other model family, review and challenge modes, and a filesystem-boundary prefix on the prompt.
  - Plan-review sections from `plan-eng-review`: stated preferences as the review spine, failure modes per codepath, user-flow edge cases, what already exists, and NOT in scope.
- **Where it landed:** `.claude/skills/cross-model/SKILL.md`, `bin/cross-model-run`, `.claude/skills/bbx-plan/SKILL.md`, `.claude/skills/bbx-plan/TEMPLATE.md`

### Jupyter, by Project Jupyter

- **Source:** https://jupyter-server.readthedocs.io/en/latest/operators/security.html (BSD 3-Clause)
- **What we took:** A one-time token, printed to the console at start, to claim a fresh server.
- **Where it landed:** `beebox/src/webapp/setup-token.ts`

### llms.txt, by Jeremy Howard (AnswerDotAI)

- **Source:** https://llmstxt.org/ (repository https://github.com/AnswerDotAI/llms-txt, Apache-2.0)
- **What we took:** An `llms.txt` index and a `.md` twin of each page, for agents that read the public site.
- **Where it landed:** `site/build.ts`

### mattpocock/skills, by mattpocock

- **Source:** https://github.com/mattpocock/skills (MIT)
- **What we took:**
  - From `diagnosing-bugs`: build a tight feedback loop first, as the core of debugging.
  - From `improve-codebase-architecture` and `codebase-design`: the deepening pass, the deletion test, and the module, interface, depth, and seam vocabulary.
- **Where it landed:** `beebox/docs/testing.md`, `beebox/code-style.md`

### No Mistakes, by kunchenguid

- **Source:** https://github.com/kunchenguid/no-mistakes (MIT)
- **What we took:** Rules for the review prompt. The reviewer traces a concrete input, reconstructs the original failure behind a claimed fix, and scopes each finding by its smallest honest remedy.
- **Where it landed:** `.claude/skills/cross-model/SKILL.md`

### OpenClaw and Hermes Agent, by OpenClaw Foundation; Nous Research

- **Source:** https://github.com/openclaw/openclaw (MIT), https://github.com/NousResearch/hermes-agent (MIT)
- **What we took:** One `doctor` preflight command that gives a one-line fix for each failure and ends every install path, after `openclaw doctor` and `hermes doctor`.
- **Where it landed:** `bin/doctor.ts`

### OpenClaw, by OpenClaw Foundation

- **Source:** https://github.com/openclaw/openclaw (MIT)
- **What we took:**
  - A rulepack of security-regression rules, one for each of our own past security bugs, modeled on OpenClaw's `security/opengrep/`. We key the rules to our own issues and wrote the rules ourselves.
  - Cheap security checks at commit time (private keys, merge-conflict markers, shellcheck), taken from OpenClaw's pre-commit configuration and run through husky.
  - From OpenClaw's commitments feature: todos that the agent owns, and a provenance field that marks agent-authored todos so that triage can weigh them differently.
- **Where it landed:** `security/opengrep/README.md`, `security/opengrep/precise.yml`, `bin/precommit-security.ts`, `.husky/pre-commit`, `beebox/src/shared/todo-model.ts`, `beebox/src/core/triage/todo.ts`

### OpenCode, by Anomaly (anomalyco)

- **Source:** https://github.com/anomalyco/opencode (MIT)
- **What we took:** One declared, static small-model slot for cheap passes, with no router and no fallback.
- **Where it landed:** `beebox/docs/model-policy.md`, `beebox/src/core/model-policy.ts`, `beebox/src/core/box/config.ts`

### Sentry feedback widget, by getsentry (Sentry)

- **Source:** https://github.com/getsentry/sentry-javascript (MIT)
- **What we took:** A one-frame screenshot of the current tab through `getDisplayMedia` with `preferCurrentTab` and `selfBrowserSurface`. The stream closes at once.
- **Where it landed:** `beebox/src/frontend/src/components/chat/screenshot-capture.ts`

### Superpowers, by obra (Jesse Vincent)

- **Source:** https://github.com/obra/superpowers (MIT)
- **What we took:**
  - From `systematic-debugging`: the Iron Law (no fix before the cause is pinned down) and a circuit-breaker that stops after three failed fixes.
  - From `writing-skills`: skill descriptions state triggering conditions only, so agents read the skill body instead of following a summary. This rule reached us through claude-elixir-phoenix's review of Superpowers.
- **Where it landed:** `beebox/docs/testing.md`, `.claude/skills/field-probe/SKILL.md`, `.claude/skills/*/SKILL.md` (frontmatter descriptions)

### TiddlyWiki, by TiddlyWiki (Jeremy Ruston, UnaMesa Association)

- **Source:** https://github.com/TiddlyWiki/TiddlyWiki5 (BSD 3-Clause)
- **What we took:** A collection is selection, iteration, and per-item rendering. It is not a stored object.
- **Where it landed:** `beebox/docs/implemented-plans/todo-collection.md`

### UI/UX Pro Max, by nextlevelbuilder

- **Source:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT)
- **What we took:** From the `ui-ux-pro-max` checklist: motion used sparingly with `prefers-reduced-motion`, heading hierarchy, one primary action per area, and form validation on blur with focus on the first invalid field.
- **Where it landed:** `beebox/frontend.md`

### Vault audit devices, by HashiCorp

- **Source:** https://developer.hashicorp.com/vault/docs/audit (repository https://github.com/hashicorp/vault, Business Source License 1.1)
- **What we took:** The audit-device rule for the secret access log: never log a value, and HMAC a value if it must appear.
- **Where it landed:** `beebox/src/core/secrets/access-log.ts`

### "Why the world's best AI startups write bad prompts", by Wulfie Bain (@wulfie_bain_)

- **Source:** https://x.com/wulfie_bain_/status/2098060386813566990 (none stated)
- **What we took:** Structure instructions like code: MECE sections, one home per fact, and names as the search path. These became the organizing principles for our docs.
- **Where it landed:** `beebox/docs/README.md`

## Conventions we follow

Field conventions and published methods, not one project's idea. One line each, with a canonical reference.

- **Catch-up scheduling** (anacron): a job is due from its persisted last-run time, so a missed run happens on the next wake. [anacron(8)](https://man7.org/linux/man-pages/man8/anacron.8.html). Landed in `bin/lib/schedules-runner.ts`.
- **Capture inline, aggregate in a generated view** (Org-mode agenda): todos are written where they arise and collected by a view. [Org manual, Agenda Views](https://orgmode.org/manual/Agenda-Views.html). Landed in `beebox/src/core/todo/collect-types.ts`, `beebox/src/core/todo/collection.ts`.
- **One stable key per streaming message** (Vercel chatbot, assistant-ui, Streamdown): one component from first token to final, status as a prop. [vercel/chatbot](https://github.com/vercel/chatbot), [assistant-ui](https://github.com/assistant-ui/assistant-ui). Landed in `beebox/src/frontend/src/components/chat/CLAUDE.md`.
- **MECE sibling sections** (Barbara Minto, *The Pyramid Principle*): sibling doc sections do not overlap and together cover the parent. [barbaraminto.com](https://www.barbaraminto.com/). Landed in `beebox/docs/README.md`.
- **Deep and shallow modules** (John Ousterhout, *A Philosophy of Software Design*), via mattpocock/skills. [Book page](https://web.stanford.edu/~ouster/cgi-bin/book.php). Landed in `beebox/code-style.md`.
- **Simplified Technical English, in spirit** (ASD-STE100): short active sentences, one idea per sentence, consistent terms. We do not claim conformance. [asd-ste100.org](https://www.asd-ste100.org/). Landed in `issues/CLAUDE.md`, `.claude/skills/issues/SKILL.md`.
- **Jobs To Be Done** (Christensen et al., *Competing Against Luck*): frame user-facing work as the user's job before the means. [Christensen Institute](https://www.christenseninstitute.org/). Landed in `issues/CLAUDE.md`, `.claude/skills/bbx-plan/TEMPLATE.md`.

## Licensed assets we redistribute

Code dependencies are not listed; their licences travel in `node_modules`. This section is for assets we redistribute and display, where the licence asks for a credit a person can find.

### Twemoji, by Twitter, Inc and other contributors

- **Package:** `@twemoji/svg`
- **Licence:** artwork [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/); code MIT
- **Used for:** a box's mark wherever a surface needs a raster rather than a character: the Apple touch icon, the web-app manifest icons, and notification icons (`beebox/src/core/box/icon.ts`, `beebox/src/lib/twemoji.ts`).
- **Why the artwork rather than a font:** librsvg renders emoji as monochrome line art, and the deployed server installs no emoji font, so drawing emoji as text would give a blank square in production. Twemoji ships each emoji as shapes, which need no font and come out in colour at any size. There is no in-app credit today because the app has no About surface; if one is added, this credit belongs on it.
