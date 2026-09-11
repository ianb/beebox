# Authoring the public site's cards

The site uses the application's material language, but has its own static
renderer. `cards/` is the source root. A reserved public prefix remains an
open design choice; none is required by this implementation.

## Cards and addresses

Existing `*.site-page.card` cards keep their `.html` URLs. New `*.doc.card`
files produce directories containing static `index.html` files:

- `Parent.doc.card` becomes `Parent.doc.card/`.
- `Parent.attach/Aside.doc.card` becomes `Parent.attach/Aside.doc.card/`.
- A matching `.doc.card` or `.site-page.card` must exist for the attachment's
  parent. Missing or ambiguous parents fail the build.
- Each page also has a flat `.md` twin, e.g. `Parent.attach/Aside.md`.

The trailing slash is static directory hosting, not a box API. A direct visit
to an aside renders the parent on the left and the aside on the right, without
JavaScript. On mobile the parent is hidden and a parent link stays visible.
Old inline `site-aside` cards retain their separate voice/publication guards;
attaching a document does not bypass or replace that mechanism.

Markdown links can name native cards, relative to the source card or starting
with `/` for the site root. The build resolves them to public addresses and
checks that targets exist. Native links in Markdown twins point to `.md` twins.

## Frontmatter

All page cards require `title` and `summary`. Unknown fields fail the build.
`contains` remains accepted but unpublished. `unlisted: true` excludes a page
from `llms.txt`; it does not make it private or prohibit authored links to it.

```yaml
---
title: A note
summary: A short description.
unlisted: true
theme: post-it
stock: yellow
kind: generated
status: ready
next:
  - card: /Parent.doc.card
    at: the-next-section
    label: Continue the main document
---
```

Themes are `plain`, `paper` (default), and `post-it`. Paper stocks are `cream`,
`manila`, `blue`; Post-it stocks are `yellow`, `rose`, `mint`. The build rejects
mismatched stocks. The plain theme uses its neutral app material.

`next` is an ordered list of suggested destinations, with optional heading
slugs in `at`. Card and section targets are checked at build time. Browser
navigation suggests the first destination not visited during the current
page session, then falls back to the last. These are suggestions, not required
steps or completion tracking. Reloading resets the visited set.

A parent-return link restores the remembered reading position. An authored
continuation can instead point to a particular parent section. Browser Back
and Forward restore their own entry's pane positions, rather than replaying a
section jump. Shared section URLs use ordinary `#heading-slug` fragments.

## Navigation and system themes

Exactly one card has `navigation: true`. Its body authors the collection card
and the compact Menu. Keep it curated: attached notes need not be promoted to
primary destinations just because they have addresses. Links from other
contexts remain possible; broader contextual deep-link policy is not settled.

Only this card may specify the system chrome:

```yaml
navigation: true
theme: paper
stock: manila
chrome:
  theme: paper
  stock: cream
```

System themes are `paper`, `plain`, `spectrum`. Paper system stocks are `cream`,
`manila`, `blue`. Card and system theme selection are independent.

## Build and behavior

`pnpm --dir site build` emits the complete static site. Every destination is a
full HTML document. With JavaScript, same-site page links fetch that HTML and
update the reading panes, title, menu, URL and history in place. Modified clicks,
new tabs, external links and Markdown downloads retain browser behavior. A
failed enhancement falls back to ordinary navigation. Motion respects reduced
motion preferences. Content remains readable with JavaScript disabled.

The site copies only local `assets/`; its build imports no app frontend code.
The app CSS snapshots and their provenance are documented in
[assets/README.md](assets/README.md). Asset edits participate in the router's
source manifest, so they trigger a rebuild just like cards and renderer code.

Human prose still belongs to the boxholder. Keep agent-written demonstration
text explicitly marked. The current home and walkthrough are scaffolds, not
newly authored final copy. Nugget validation, pending author-aside suppression,
and excerpt provenance still run through the existing publishing pipeline.

## Prompts for an agent

Use a dedicated prompt block for install instructions, learning tasks, or
other text a reader should take to their agent. Give it a purpose and stable
id; put only the agent-directed prompt inside the single code fence.

````markdown
{% agent-prompt title="Install Bee Box" id="install-with-your-agent" %}
```
The exact prompt to give an agent goes here.
```
{% /agent-prompt %}
````

The prompt is a visible surface with its own copy action and status message,
not a collapsed aside or an ordinary code sample. Copy uses the entire code
text, excluding the title and UI labels. If clipboard access fails, the text
remains selectable and the status explains the fallback. Without JavaScript
the prompt remains visible. Its text also survives in the Markdown twin.
The home card puts the existing install prompt near the top; Menu links to
its anchor. Learning prompts can use the same format when authored.

Attached document cards require `kind: author | generated | bee` and
`status: pending | ready`, sharing the existing aside publication rules.
Pending author bodies are replaced before either HTML or Markdown is rendered;
other empty bodies fail the build. Provenance is appended automatically,
independently of any editorial note inside the body. Main documents can opt
into the same fields. Changing a card's suffix does not waive this guard.
