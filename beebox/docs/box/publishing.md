---
read-when: Creating, preparing, reviewing, or changing a static site published from this box.
---

# Publishing a site from this box

A publication is one `publication` card. The card holds the settings. The
card's attach folder holds the site files. The server serves the files as a
static site on this box's shared publishing hostname. Read this guide before
you prepare or change a publication.

## The publication card

Put the card with the content that it publishes. Any folder under `_content/`
is correct. Name the file `<Name>.publication.card`.

This example is a public site about a camping trip:

```text
_content/trips/
├── Tahoe.card                    # the trip that the site is about
├── Tahoe Site.publication.card
└── Tahoe Site.attach/
    └── static/
        ├── index.md              # served as index.html
        └── campsite.jpg
```

`Tahoe Site.publication.card`:

```markdown
---
title: Tahoe trip
pubId: abcdefghijklmnop2345672345
connection: replace-with-the-selected-connection
tier: public
slug: tahoe
---

Notes: the boxholder wants no last names on this site.
```

Then prepare it with the box-relative card path:

```sh
bbx pub prepare "_content/trips/Tahoe Site.publication.card"
```

Then tell the boxholder: "The site is prepared. Open the Tahoe Site card in
the app, review the files and scan findings, and choose Enable." The command
prints the card link and the URL. A public site is served at
`https://<box-host>/<slug>/`, here `https://<box-host>/tahoe/`.

The fields:

- `title`: the site title.
- `pubId`: the identity of the site. Run `bbx pub id` one time for each new
  card. Never change the value. Never copy the example value.
- `connection`: the Cloudflare connection for the site. `bbx pub status`
  prints the connections granted to this box and the connection of the shared
  hostname. Use that name. If there is no connection or hostname, ask the
  boxholder to set one up in **Admin → Cloudflare publishing**. Do not guess a
  name or look for credentials.
- `tier`: the requested audience: `public`, `secret`, `accounts`, or
  `any-account`.
- `slug`: the path of a `public` site on the shared hostname. It is required
  for a public site on that hostname. Use lowercase, at most 63 characters.
  `s`, `p`, and `a` are reserved. Use `slug` only with tier `public`.
- `emails`: the reader emails. Use it only with tier `accounts`, where it is
  required.

A `secret` site has no slug. It is served at `https://<box-host>/s/<pubId>/`.
The full path is the reader's key. Give it only to the intended reader. Do not
shorten it or write it in a public page, a shared note, or an issue.

The card body is private notes about the site: decisions, sources, and
requests from the boxholder. The body is never published. Read it before you
change the site.

Do not put approval, the served audience, the hostname, status, a bucket, a
Worker, a build command, or credentials in the card. The server owns them.

Never copy a publication card. A copy has the same `pubId`. `bbx validate`
reports the duplicate, and prepare refuses it. To move or rename a card, use
`bbx mv`. It moves the attach folder with the card.

## Choose static files or a site project

The attach folder contains exactly one of these folders:

- `static/`: finished files. Markdown files are rendered to pages.
- `project/`: a frontend project with `package.json`. Its `dist/` is
  published.

### Static files

Put a complete site in `<Name>.attach/static/`. Include `index.html` or
`index.md` at the root. Every linked file must be in the folder. No install or
build runs.

Write documents as Markdown. Do not convert them to HTML. Each `.md` file
renders to a page with the same name and an `.html` extension. The page has the
box's Markdown styling and no JavaScript.

- Link between pages with relative `.md` paths. A link to `packing-list.md`
  renders as a link to `packing-list.html`. Images and other files use paths
  relative to the `.md` file. They are published unchanged.
- The page title is `title:` from YAML frontmatter, else the first `#`
  heading, else the file name.
- The `.md` source is not published. A `foo.md` and a `foo.html` in one folder
  is an error. Keep one.
- Task lists render as checkboxes. `redacted` content is left out. Other box
  Markdoc tags, such as `quote`, `source`, and `todo`, are an error.
- Use hand-written HTML and CSS only when the site needs its own layout. A
  site can mix both.

A file over 1 MB in `static/` blocks the box commit, unless its extension is a
known asset type such as an image, a video, or a PDF. Keep large data out of
`static/`.

Use relative paths such as `./styles.css` and `./details/`. A directory URL
works only when the directory has an `index.html`. There is no SPA catch-all.
The `/s`, `/p`, `/a`, and `/__*` paths are reserved. Do not use a root path
such as `/assets/logo.svg`.

### Site project

Use a project for TypeScript, JSX, React, Tailwind, or another build tool.
Put it in `<Name>.attach/project/`:

```text
Field Guide.attach/project/
├── package.json
├── pnpm-lock.yaml
├── index.html
├── vite.config.ts
└── src/
    ├── main.tsx
    └── styles.css
```

Keep dependencies in this project. Do not change the box-root package or
lockfile. Do not import Bee Box frontend components. Commit the project's
`pnpm-lock.yaml` and give it a `build` script. Prepare runs
`pnpm install --frozen-lockfile` and `pnpm run build`, then publishes only
`dist/`. The build must write `dist/index.html`. `dist/` and `node_modules/`
are not committed. A stale lockfile, a missing build script, or a failed build
stops prepare. The current release stays live.

The build runs as box code with the box's file access. It does not get the
server's credentials. Keep secrets, source, lockfiles, `node_modules/`, notes,
and source maps out of `dist/`. The publisher refuses them, and it refuses
symlinks, hidden files, and reserved route segments. The limits are 2,000
files, 25 MiB for each file, and 100 MiB in total.

### Optional React/Tailwind starting point

This starter is a complete, neutral example rather than a visual identity to
preserve. It uses pinned direct dependencies, semantic theme tokens, accessible
contrast and visible keyboard focus, clear typography and spacing, and a
responsive layout. It includes local `SiteLayout`, `Header`, `Nav`, `Main`,
`Footer`, `Button`, and `Card` components and a simple homepage with a title,
purpose, navigation, and featured content. Copy the following files to the
matching paths under `project/`. Static sites and other stacks remain supported;
the starter imports no Bee Box frontend code or components.

#### Starter files

`package.json`

```json
{
  "name": "publication-site-starter",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vite": "8.3.1"
  }
}
```

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`vite.config.ts`

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { sourcemap: false },
});
```

`index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="A starting point for a published site." />
    <title>Your site</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HomePage } from "./pages/HomePage.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The root element is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
```

`src/styles.css`

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  --site-page: #f4f5f7;
  --site-panel: #ffffff;
  --site-ink: #20242b;
  --site-muted: #4a5361;
  --site-line: #cbd0d8;
  --site-primary: #28364a;
  --site-primary-hover: #1d2939;
  --site-primary-ink: #ffffff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (prefers-color-scheme: dark) {
  :root {
    --site-page: #171a1f;
    --site-panel: #222730;
    --site-ink: #f1f3f6;
    --site-muted: #c0c7d1;
    --site-line: #4a5361;
    --site-primary: #d8e2f0;
    --site-primary-hover: #c2d1e4;
    --site-primary-ink: #1b2430;
  }
}

@theme {
  --color-page: var(--site-page);
  --color-panel: var(--site-panel);
  --color-ink: var(--site-ink);
  --color-muted: var(--site-muted);
  --color-line: var(--site-line);
  --color-primary: var(--site-primary);
  --color-primary-hover: var(--site-primary-hover);
  --color-primary-ink: var(--site-primary-ink);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background: var(--site-page);
  color: var(--site-ink);
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

`src/components/SiteLayout.tsx`

```tsx
import type { ReactNode } from "react";

import { Footer } from "./Footer.js";
import { Header } from "./Header.js";
import { Main } from "./Main.js";

export function SiteLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page text-ink">
      <Header title={title} />
      <Main>{children}</Main>
      <Footer title={title} />
    </div>
  );
}
```

`src/components/Header.tsx`

```tsx
import { Nav } from "./Nav.js";

export function Header({ title }: { title: string }) {
  return (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <a className="rounded font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="./">
          {title}
        </a>
        <Nav />
      </div>
    </header>
  );
}
```

`src/components/Nav.tsx`

```tsx
export function Nav() {
  return (
    <nav aria-label="Main navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <a className="rounded text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="#overview">Overview</a>
      <a className="rounded text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="#featured">Featured</a>
    </nav>
  );
}
```

`src/components/Main.tsx`

```tsx
import type { ReactNode } from "react";

export function Main({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-16">{children}</main>;
}
```

`src/components/Footer.tsx`

```tsx
export function Footer({ title }: { title: string }) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-6 text-sm text-muted sm:px-8">
        <p>© {new Date().getFullYear()} {title}</p>
      </div>
    </footer>
  );
}
```

`src/components/Button.tsx`

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

export function Button({ children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-ink transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
```

`src/components/Card.tsx`

```tsx
import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-6 shadow-sm sm:p-7">
      <h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <div className="mt-3 leading-7 text-muted">{children}</div>
    </article>
  );
}
```

`src/pages/HomePage.tsx`

```tsx
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SiteLayout } from "../components/SiteLayout.js";

const featured = [
  { title: "A useful first item", description: "Replace this card with something a visitor should notice first." },
  { title: "A clear next step", description: "Give readers one practical way to continue or learn more." },
];

export function HomePage() {
  return (
    <SiteLayout title="Your site">
      <section id="overview" aria-labelledby="page-title" className="grid gap-8 rounded-3xl border border-line bg-panel p-7 sm:p-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">A short description</p>
          <h1 id="page-title" className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">A useful, clear title for this site</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">Explain what this site is for and who will find it useful. Keep the first screen focused on the visitor's next question.</p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          <Button onClick={() => document.getElementById("featured")?.scrollIntoView({ behavior: "smooth" })}>Explore featured work</Button>
          <a className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href="#featured">See what is here</a>
        </div>
      </section>

      <section id="featured" aria-labelledby="featured-title" className="mt-14 sm:mt-20">
        <div className="mb-6 max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Start here</p>
          <h2 id="featured-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">Featured content</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {featured.map((item) => (
            <Card key={item.title} title={item.title}>{item.description}</Card>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}
```

You may also use absolute HTTPS module, stylesheet, font, or image URLs in a
published site. Prefer an exact version in a dependency URL and review what it
loads. A pinned top-level version does not freeze every transitive dependency.
The browser can contact those HTTPS resource hosts when the site loads. An
own-origin proxy is not part of this workflow; use build-time vendoring only
when you need fixed bytes or want to avoid third-party viewer requests. There
is no inherent safety advantage to local npm dependencies over trusted CDN
code, or vice versa.

## Author content from box data carefully

Hand-authored HTML/CSS/JS is the core workflow. If you choose to generate JSON
from cards, treat that as a separate explicit export step: create a new object
from a positive list of intended public fields, validate it against a strict
schema that rejects unknown fields, and write only that JSON output. Never
copy an entire card, view model, frontmatter object, or attachment record and
then remove fields you noticed were private. Do not publish raw card refs or a
general ref-to-URL mapping. A future helper may resolve only refs that the same
publication explicitly emits; cross-publication automatic mapping is not part
of this guide.

Do not include inline JavaScript or an inline module import map. Use external
script/module files and relative imports. Do not assume the page can call Bee
Box APIs or access the box filesystem. Published code runs in a visitor's
browser; it never runs in the Bee Box server. The publisher scans text for
likely leaks, but scanning cannot decide whether content is appropriate for
your intended audience. Review the file summary and findings before asking a
box member to enable the site.

## Prepare, approve, and update

1. Write the card and the files in its attach folder.
2. Run `bbx pub prepare <card-path>`. The server reads the files, builds a
   project, checks routes and sizes, scans for leaks, and uploads a release.
   The command prints the URL and an `approval:` line with the card link.
3. Tell the boxholder to open the card in the app, review the audience, files,
   and scan findings, and choose **Enable**. Only a signed-in box member can
   enable a site. No CLI command can do it.
4. If a scan finding is real, remove the material and prepare again. Do not
   ask the boxholder to accept a suspected secret.

After the site is enabled, prepare it again to publish new content. A content
change goes live at once. A change to `tier`, `slug`, or `emails` is a
request. The current release stays live until a signed-in member approves the
request on the card. While a request waits, the command prints the current URL
and the candidate URL. Keep them separate.

A failed build or scan leaves the current release live. If an upload may have
written files but its check failed, the serving state is unknown. Run
`bbx pub status` and report that. Do not say the old release was restored.

A member can disable the site on its card. Disable stops every release.

To see what is published, use these commands:

- `bbx pub status`: the state of each publication and the box's connections.
- `bbx pub files <card-path>`: the files in the active release.
- `bbx pub cat <card-path> <file>`: one file from the active release. Add
  `--pending` to read the candidate that waits for approval.

There is no local copy of a published site. Use these commands, not the
attach folder, to check what readers get.

The app shows a text summary of the files. It never runs published
JavaScript. All published pages of this box share one browser origin. A
page's scripts can read the origin's web storage and request other published
paths, which include secret paths with a known `pubId`. The boxholder accepts
this. Do not put sensitive data in browser storage.

## Shared hostname for this box

The authenticated Bee Box owner configures one hostname for the current box
in **Admin → Cloudflare publishing** before the first site is prepared. The
owner selects one active Cloudflare publishing connection already granted to
this box and enters an exact hostname in a zone owned by that account. Setup
creates or reuses this box and connection's R2 bucket, deploys the shared
Worker, and attaches the hostname. The hostname serves paths for this box
only; Bee Box does not route several boxes through one host. This hostname and
connection cannot be changed from Admin in this version. Cloudflare DNS and
certificate changes start when the owner submits the assignment, before any
site is enabled. The owner should review existing DNS and Workers Routes
first. A successful API mapping does not prove HTTPS is ready.

The agent does not set up or assign a host. It reads the selected connection
from `bbx pub status`, puts that name in each card, prepares the site, and
gives the boxholder the card link that prepare prints.

Existing per-publication `workers.dev` URLs and custom hostnames continue to
serve their old routes. A publication can join the shared hostname only after
the agent prepares it against this box's selected connection and a signed-in
member approves the new destination. Publications on another granted
connection remain on their current URLs; they are not silently moved. New
publications use the per-box shared Worker and do not create a Worker per site.
An existing public publication without a slug stays on its legacy Worker URL
until you choose a slug and prepare it for the shared host; public shared-host
routes require an explicit slug. Preparing a changed slug creates a candidate:
the currently approved destination remains live until a signed-in member
approves the candidate. Keep the current approved URL and the candidate URL
distinct while review is pending. If the old per-publication Worker still has
an active URL, the app and status output identify it separately from the
shared-host destination.

## Output and route restrictions

The publisher requires `index.html` at the output root, and the Worker serves
only files in the prepared release inventory. `__release/` and any `__`
path segment are reserved. If a public slug is configured, do not author files
under `p/<that-slug>/`. Project output containing a `src/` directory, hidden
paths, package metadata, private-key files, source maps, and symlinks are
rejected. Route paths are case-sensitive. Use `./` links for site assets so a
page continues to load its own matching CSS, JavaScript, JSON, and images after
a refresh.

If the card, build, leak scan, or upload fails, fix the reported cause
and prepare again. Change the files in the attach folder, not prepared output: prepare stages
each release in a temporary directory outside the box, and the server-owned
publication operation controls what becomes an active release.

The starter follows the documented [React from scratch with Vite](https://react.dev/learn/build-a-react-app-from-scratch),
[Vite production build](https://vite.dev/guide/build), and
[Tailwind CSS Vite plugin](https://tailwindcss.com/docs/installation) patterns.
