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

All page cards require `title`, `summary`, and `authorship`. Unknown fields fail the build,
except inside `authorship.ai`, where new contribution categories are deliberately
allowed so the vocabulary can grow from real use.
`contains` remains accepted but unpublished. `unlisted: true` excludes a page
from `llms.txt`; it does not make it private or prohibit authored links to it.

```yaml
---
title: A note
summary: A short description.
authorship:
  people:
    - name: Ian Bicking
      role: author
      contribution: Wrote the card from working notes and shaped it for publication.
  ai:
    transcription: Prepared a transcript from the original recording.
    drafting: none
    editing: none
    source-preparation: Compared the transcript with the recording.
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

`authorship.people` is person-centered, not a literal revision log. Each entry
names a person, their role, and a concise account of what they contributed.
Routine spelling, punctuation, formatting, and transcription corrections do
not need their own entry.

`authorship.ai` always declares `transcription`, `drafting`, and `editing`.
Each value is either the literal `none` or a plain-language description. Add
other properties such as `source-preparation`, `research`, or `visual-layout`
when they describe the work more accurately. The renderer lists known and new
properties alike. Silence is not interpreted as evidence that AI was absent.

The fold on each card opens an **On the back** account containing this metadata
and the native card path. It is supplementary provenance, never primary
navigation; landmarks, parent links, in-body links, and `next` stay on the
front. Without JavaScript, the front remains the complete reading surface.

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

Do not present agent-written prose as the boxholder's voice. Agent-drafted
informational copy may publish when `authorship.ai.drafting` describes that
contribution; marked demonstrations remain marked until they become real copy.
Pending author-aside suppression, nugget validation, and excerpt provenance
still run through the existing publishing pipeline.

## Authoring in a box workbench

The repository remains the canonical home of published content. A local Bee
Box can be a private editorial workbench: drafts, source material, agent chats,
and abandoned approaches remain in the box, while only selected cards under
`_publish/public-site/` are eligible for export. Being in that staging
directory means selected for review; it does not mean published.

Bootstrap a workbench by deliberately copying the current `site/cards/` card
graph into the box staging directory. In the box, rename public `*.doc.card`
files to `*.site-doc.card` so they use the strict box-local schema. Keep
`*.site-page.card` and `*.site-aside.card` suffixes unchanged. Card bodies
continue to use their public site-root links, including `.doc.card` link
targets; those are public-site addresses, not box-root addresses.

Preview an export from the repository checkout:

```bash
pnpm --dir site box-export --box /path/to/workbench
```

Dry-run is the default. The report names the box, the exact staging and
destination roots, successful site-build validation, additions, updates,
unchanged cards, and destination-only cards that will be retained. It reads no
other box directory and copies no Git history or conversation content.

After reviewing the report, apply additions and updates explicitly:

```bash
pnpm --dir site box-export --box /path/to/workbench --apply
```

Apply never deletes repository cards. It maps `*.site-doc.card` back to
`*.doc.card`, validates the complete selected graph through the real static
site build in a temporary directory, and writes nothing to `site/cards/` until
discovery, path safety, and validation all pass. Review and commit the resulting
repository diff separately; export does not commit, push, deploy, or make the
box copy canonical.

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
