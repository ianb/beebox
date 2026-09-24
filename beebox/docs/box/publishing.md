---
read-when: Creating, preparing, reviewing, or changing a static site published from this box.
---

# Publishing a site from this box

This guide covers sites authored under `src/publications/` and served as
static files from an isolated publication origin. Read it before preparing or
changing a publication. Shared authoring notes are in
`src/publications/NOTES.md`; use the scope headings there when adding a lesson.

## Start with a publication folder

Each site has a stable folder name and a `publication.json` definition:

```text
src/publications/
├── NOTES.md
├── CLAUDE.md
└── field-guide/
    ├── publication.json
    └── site/                  # static mode: finished files, served as written
        ├── index.html
        ├── styles.css
    └── assets/
```

For a new site, run `bbx pub id` to generate a fresh secure `pubId`; preserve
that value in the definition across every refresh. Prepare a site by name with
`bbx pub prepare <name>` and inspect managed server state with `bbx pub sites`.

The definition chooses a content mode and requested audience. The server
derives the source root, owning box, publication Worker, storage location, and
release id from trusted server state. Never add a bucket name, Worker name,
host name, output path, access credential, arbitrary build command, or another
box's id to the definition.

Example public static definition:

```json
{
  "pubId": "abcdefghijklmnop2345672345",
  "connection": "publishing",
  "content": "static",
  "title": "Field guide",
  "tier": "public",
  "slug": "field-guide"
}
```

`pubId` is a stable, random base32 id assigned once; preserve it on every
refresh and never copy the example id. `connection` must name a connection
already granted to this box by a Cloudflare publishing administrator. It does
not contain or grant credentials. The requested `tier` may be `public`,
`secret`, `accounts`, or `any-account`. Public definitions may request a
`slug`. Account-restricted definitions must list at least one normalized email
in `emails`. Secret and any-account definitions do not take a slug or email
list. A box member approves the actual audience and destination in the
Publications area of the app.

An incomplete or ungranted connection is an actionable setup error. Do not
copy a credential from another box or work around a missing grant.

## Choose static files or a site project

### Static files

Put a complete site in `src/publications/<name>/site/`. Include a root
`index.html`; every linked file must be present in the same folder. Static mode
does not need a `package.json`, lockfile, install, or build. The publisher
copies the finished folder, scans it, and stages it for server-side upload.

Use ordinary relative paths such as `./styles.css`, `./assets/logo.svg`, and
`./details/`. These stay within the publication's release when its entry page
is refreshed. A directory URL works only when that directory contains a
published `index.html`; there is no SPA catch-all. Avoid root-absolute asset
paths (`/assets/...`) because a publication can be mounted below a route prefix.

### Site project

Use this when you want TypeScript/JSX, React, Tailwind, or another frontend
build tool. The complete optional React/Tailwind starter recipe appears below;
copy its files into `src/publications/<name>/project/` and run `pnpm install`
to create the site-local lockfile. You can also author a conventional frontend
project there:

```text
src/publications/field-guide/
├── publication.json
└── project/
    ├── package.json
    ├── pnpm-lock.yaml
    ├── index.html
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        └── styles.css
```

Keep dependencies local to this project; do not modify the box-root package or
engine lockfile. Declare dependencies in `project/package.json`, commit the
site-local `pnpm-lock.yaml`, and provide the ordinary `build` script. Prepare
runs `pnpm install --frozen-lockfile` and `pnpm run build`, then publishes only
`project/dist/`. The build can use its own declared bundler and dependency
graph; it must emit a static site with `dist/index.html`. A missing or stale
lockfile, missing build script, nonzero build, or timeout is reported as a
preparation failure before promotion. Fix the project and prepare again; these
local failures do not replace the current release.

Build scripts run as trusted box code with the existing same-user filesystem
privileges. The publisher gives them a reduced child environment without the
server's credential variables; this is credential hygiene, not a sandbox.
Keep secrets, package source, lockfiles, `node_modules/`, notes, and source maps
out of `dist/`. The publisher rejects these by name/path and refuses symlinks,
hidden files, source files, and reserved route segments. Current bounds are
2,000 files, 25 MiB per file, and 100 MiB total.

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
    <script type="module" src="/src/main.tsx"></script>
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

1. Write the definition and complete static files or project source in the
   fixed folder for that publication.
2. Run `bbx pub prepare <name>` to ask the authenticated Bee Box server to
   prepare that folder by name. The server reads files from the registered box, validates
   routes and size, builds project mode if selected, scans content, and uploads
   an immutable release. The request contains only the publication name; it
   cannot choose another box, id, bucket, or Worker. A new site remains
   disabled. On an enabled site, a successful prepare within the approved
   audience and destination publishes immediately. If the requested audience
   or destination differs, it prepares a candidate and keeps the old release
   live until a signed-in box member approves that scope. A failed build or
   scan before upload/promotion leaves the current release live. If a remote
   write may have succeeded but read-back or activation verification fails,
   serving state is unknown; do not claim that the old release was restored.
3. For a first enable or scope change, review the title, destination, requested
   audience, emitted file summary, and leak-scan findings in the app. If a scan
   finding is real, remove the exposed material and prepare again. Do not wave
   through a suspected secret. An ordinary same-scope content refresh does not
   require a separate snapshot approval.
4. A signed-in member of this box enables the publication in the app. That
   action authorizes the requested audience and destination. Global
   administrators manage Cloudflare connections and per-box grants; they do
   not need to be the member who approves a site.
5. After enablement, you may refresh content within the approved audience and
   destination. Any audience or destination change, including narrowing or
   widening recipients or changing a public slug, needs fresh approval from a
   signed-in member. A local build or scan failure before promotion leaves the
   current release active. If a remote write may have succeeded but its
   read-back/activation check fails, inspect `bbx pub sites` and treat serving
   state as unknown; the publisher does not promise rollback.
6. A signed-in box member can disable the publication in the app. Disablement
   stops every release at the serving edge. Revocation is terminal; a disabled
   publication may be enabled again after its approval state is still valid.

The app's safe summary/preview is text and metadata only; it never executes
published JavaScript on the authenticated Bee Box origin. Content updates
within an already-approved scope are allowed without a new member click. To
inspect the actual site, use a local isolated preview or visit its separate
published origin after enablement. If approval changes the destination or
audience, old release URLs lose reachability under the previous approval.

## Private publication notes

Use `src/publications/NOTES.md` for durable authoring lessons shared across
sites. This is ordinary private box guidance, not a publication source and not
copied into a release. Use the headings already in that file:

- **All sites** — defaults that apply to every publication.
- **Site: `<name>`** — decisions specific to one publication.
- **Path: `<site>/<relative-path>`** — details for a particular area, for
  example `<site>/site/styles/` in static mode or
  `<site>/project/src/components/` in project mode.

Read applicable notes before changing a site. Promote a reusable lesson to
`All sites`; do not spread a site-specific decision to other sites without a
reason. Initialization preserves this file rather than overwriting it.

## Output and route restrictions

The publisher requires `index.html` at the output root, and the Worker serves
only files in the prepared release inventory. `__release/` and any `__`
path segment are reserved. If a public slug is configured, do not author files
under `p/<that-slug>/`. Project output containing a `src/` directory, hidden
paths, package metadata, private-key files, source maps, and symlinks are
rejected. Route paths are case-sensitive. Use `./` links for site assets so a
page continues to load its own matching CSS, JavaScript, JSON, and images after
a refresh.

If the definition, build, leak scan, or upload fails, fix the reported cause
and prepare again. Do not edit generated `_publish/` output by hand; the
server-owned publication operation controls what becomes an active release.

The starter follows the documented [React from scratch with Vite](https://react.dev/learn/build-a-react-app-from-scratch),
[Vite production build](https://vite.dev/guide/build), and
[Tailwind CSS Vite plugin](https://tailwindcss.com/docs/installation) patterns.
