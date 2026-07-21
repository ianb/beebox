# site/

The generated public front-door site for callback-box. A spare static site
built from `site/content/*.md` to gitignored `site/dist/`, deployed to GitHub
Pages and viewable on the dev router at `/<worktree>/site/`.

- Principles (settled with the boxholder): `issues/features/2026-07-20-github-pages-site.md`
- Full plan / tracks: `../callback-box/docs/plans/github-pages-site.md`

## Hard constraint: static output only

Everything must work under GitHub Actions + GitHub Pages. The build is a plain
generator over markdown — **no server-side anything, no live/AI wiring, and no
external requests at view time** (fonts inlined via a system stack, no CDNs, no
remote assets — the page is CSP-clean and viewable offline). The output in
`dist/` is the whole product; the router and Pages both just serve those bytes.

## Human prose is the boxholder's words only

Agents never fill in his voice. Any human-facing prose an agent writes is a
**marked placeholder** (a visible bracketed editorial note, impossible to
mistake for him) that his real words replace later. Structure/scaffolding by
agent is fine; words are not. This is enforced by keeping placeholders marked,
not hoped for.

## Repo is private today

Pages cannot publish until the repo is public AND Settings → Pages → Source is
switched to "GitHub Actions" — a manual boxholder step tracked in
`../issues/docs-and-chores/2026-07-21-pages-site-go-live.md`. Until then the dev
router route is the only live view. The Pages workflow
(`../.github/workflows/pages.yml`) is landed but inert.

## Commands

```bash
pnpm --dir site build                    # base derived from the git branch (router view)
pnpm --dir site build --base /callback-box/   # what the Pages workflow runs
pnpm --dir site lint                     # eslint (roots: ["."] — sources at package root)
pnpm --dir site typecheck                # tsc --noEmit
pnpm --dir site test                     # node --test over *.test.ts
```

View on the router at `http://localhost:3210/<worktree>/site/` after a build.
The build fails closed: malformed frontmatter (named file:line), a broken
internal link, or a missing source stops it. On success it prints one line.

## Layout

- `build.ts` — CLI entry: reads content, writes HTML + `.md` twins + `llms.txt`,
  link-checks, resolves the base path.
- `render.ts` — the local Markdoc pipeline + strict (zod) frontmatter parse +
  the HTML shell. Deliberately does NOT import `bin/router-docs.ts` (that drags
  in execa/highlight.js and a router-issues cycle); this package declares
  `@markdoc/markdoc` itself.
- `links.ts` — base-path handling and internal-link resolution.
- `content/` — markdown sources (frontmatter: `title`, `summary`).
