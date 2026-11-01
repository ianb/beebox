---
title: "Webpage capture tools: save a page as a webpage card from a fetch or from the box browser"
status: draft
workstream: shared-browser
issues:
  - ../../../issues/features/2026-09-11-server-side-webpage-capture.md
---
# Webpage capture tools

An agent can save a page as a webpage card only by writing its own script. This plan adds two commands. `bbx webpage fetch <url>` uses a plain HTTP fetch, reports redirects, and notices blocked pages. `bbx browser save` saves the page open in the box browser. Both pass the page through one extractor, which a box can replace.

**Issues addressed:** `issues/features/2026-09-11-server-side-webpage-capture.md` (resolved). Related, stays open: `issues/features/2026-10-04-fetch-blocked-pages.md` (this notices blocks and does not get past them); `issues/features/2026-10-09-citation-conventions-and-kept-copies-of-sources.md`.

Boxholder request, 2026-11-01: "a tool to both fetch pages into the webpage format (using a normal fetch), one that ideally notices blocked conditions. It should follow redirects, but make it clear in both the card and stdout that it did so. And for the agent-browser we should also have something that makes a webpage card." And: "let the box customize the text extraction. Use a standard one ... a function that takes the response (URL, etc) and by default just passes it directly to the default extractor, but can do anything."

## Design

### Situations

- When Sofia asks the box to keep the article she mentioned, she wants the agent to save a readable copy, so the article is still there and searchable when the site changes it.
- When a short link lands on a different page, she wants the card to say so, so she can tell which address the copy really came from.
- When a site answers with a "verify you are human" page, she wants no card of that page, and an agent that says what happened, so a block page never sits in her box as if it were the article.
- When a page only exists after login or scripts, she wants the agent to save what the box browser shows, so the copy matches what she saw.
- When a recipe site's extraction always loses the ingredient list, the agent wants to teach this box a better way for that site, so every later capture is right.
- When the agent only needs to read a public page once, nobody wants a card: WebFetch stays the tool for that.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Asked to keep a page | Act | Webpage card, reported in chat | Waits to be found |
| Redirected to the article | Show | "Redirected from" on the card; stdout | Waits to be found |
| Blocked | Show, no card | Agent's chat reply | Waits to be found |
| Custom extractor failed | Show | Note on the card; stdout | Waits to be found |
| Only reading once | Quiet | No card | None |

### Spirit

- **Serves:** "You should be able to see the gears": the card says how it was captured, from where, through which redirects, and with which extractor.
- **Risks:** "Nothing should just disappear" is at odds with refusing a blocked page. Guard: the refusal is reported with the reason, and the agent has a next step (the box browser).

### Trust

The commands start at **automatic** for an agent that was asked to keep a page. A capture changes nothing outside the box. With no `--to`, the card lands in the incoming folder, which git ignores until the agent files it, as with Clerk (`clerk.ts`: *"Not committed: the incoming folder ignores itself, and the chat files the card into git."*). With `--to`, the command commits the card and its snapshot before it reports success. The guidance does not tell agents to capture on their own initiative. A custom extractor is box code, written by the agent in the box's own repository, and it has the same reach as any trick.

### When it goes wrong or does nothing

- **Blocked, or redirected to a login or verification page:** exit 3, no card, and stdout names the signal and the final URL and suggests `bbx browser open`.
- **Other HTTP failure, or not HTML:** exit 1 with the status or type, no card.
- **Almost no text extracted:** the card is saved, and stdout and the card note say so. The page may need scripts, and stdout suggests the browser.
- **Custom extractor throws, times out, or returns the wrong shape:** the default extractor runs, and the card and stdout say which failed and why.
- **Browser on a blank page:** `bbx browser save` exits 1 and says so.

### Walkthrough

1. Sofia says "keep that article". The agent runs `bbx webpage fetch https://t.example/abc`.
2. The command follows one redirect, gets HTML, and finds no block. It runs the extractor and writes the card with its snapshot.
3. Stdout says: `Saved _content/incoming/Article-title.webpage.card`, then `Redirected: https://t.example/abc -> https://news.example/article (301)`.
4. The card's page shows "Redirected from https://t.example/abc" beside the capture time.
5. The agent tells Sofia, and names the redirect because it was told to report it.

## Smallest fix and budget

Smallest fix: `bbx webpage fetch` with the default extractor and nothing else. It fails three stated requests.

Chosen design: tracks A to C. Estimate: about 650 lines of source and 450 of tests; docs and guidance about 60. New runtime dependencies in beebox: `defuddle`, `dompurify`, `turndown`, `jsdom`. **jsdom is large; Track A measures whether it can load only inside the capture commands, because every `bbx` verb loads server modules (`route.ts`: "every `bbx` verb loads the server modules").**

## Stated preferences this plan trades against

- **`docs/engineering-principles.md` 8 (one way to do each thing):** the issue names a second extractor as the failure to avoid. The issue names a second extractor as the failure to avoid, so both packages call one shared function. The custom extractor is a deliberate exception, asked for by the boxholder.
- **The schema's "self-contained" snapshot promise (`src/schemas/webpage.tsx`):** these commands do not inline assets. See Track A.
- **Earlier "no stealth" line:** not touched. These commands identify themselves and do not evade.

## What already exists

- **Card writer, move and reuse:** `writeWebpageCard` in `src/webapp/trpc/routers/clerk.ts:311`, which neutralizes third-party markdown: *"Clipped page text is third-party: escape its raw HTML and Markdoc tags."* It moves to `src/core/webpage/write.ts`.
- **Template, extend:** `createWebpageTemplate`, `src/schemas/webpage.tsx:108`.
- **Pipeline, copy the steps:** `beebox-clerk/src/platform/extract-readable.ts`: Defuddle, DOMPurify, absolutize, Turndown with `headingStyle: "atx"`, `codeBlockStyle: "fenced"`.
- **Snapshot serving, reuse:** `WebpageView.tsx`: *"served sandboxed through /api/files"*, so saved page script does not run on the box origin. To confirm in review.
- **Box code, reuse:** `src/cli/commands/trick.ts` runs TypeScript under `boxCodePaths(shape).tricksDir` through tsx in a subprocess with `buildScriptEnv`, and commits what changed.
- **Browser output limits, must work around:** `host-process/agent-browser.ts` sets `AGENT_BROWSER_MAX_OUTPUT: "60000"` and `AGENT_BROWSER_CONTENT_BOUNDARIES: "1"`. Measured 2026-11-01 on a 1.1 MB page: `eval document.documentElement.outerHTML` under those settings prints a nonce line, a JSON string, `[truncated: showing 60000 of 1173758 chars. Use --max-output to adjust]`, and an end line.
- **Exec route, sibling:** `src/webapp/routes/browser/exec-route.ts`, agent bearer only; `checkExecArgs` refuses agent flags.
- **A box's own trick, retire by choice:** the issue's `capture-page` trick. Boxes keep it until their agents switch.

## Prior art (external)

- Defuddle's Node entry and its need for a DOM library: verify against the installed version in chunk 1; the first chunk fails fast if it does not run on jsdom. Adopted, with Clerk already using the package.
- No other external premise decides the design.

## Ontology

- **Webpage card** (existing, `src/schemas/webpage.tsx`).
- **Captured response** (new): what an extractor receives. `{ url, requestedUrl, redirects, status, headers, contentType, html, via: "fetch" | "browser" }`.
- **Extraction** (new): what an extractor returns. `{ title, markdown, siteName?, byline?, excerpt? }`.
- **Default extractor** (new): `defaultExtract(response)`, exported from `beebox/server` so a box can call it.
- **Box extractor** (new): `<tricksDir>/webpage-extract.ts`, whose default export is `async (response, { defaultExtract }) => Extraction`. Optional. It is NOT a trick the agent runs by name.
- **`capture`** (new card field): `{ via, snapshot: "html-only", redirectedFrom?: [{ url, status }], extractor?: string, note?: string }`. Absent on Clerk and share cards.
- **Block signal** (new): `{ kind, detail }` from `detectBlock`. It is NOT stored on a card: a blocked page makes no card.

## Tracks / scope

### Track A: `bbx webpage fetch`

- **What:** fetch, block detection, extraction, card.
- **Why:** no sanctioned path for an agent (see the issue).
- **Direction:**
  - `src/core/webpage/fetch.ts`: `fetchPage(url, { fetchImpl })` with `redirect: "manual"`, at most 10 hops, each hop's URL and status recorded. `http:` and `https:` only. Timeout 30 seconds in total. Body cap 10 MB; over it is a failure with the reason. User agent: `Mozilla/5.0 (compatible; beebox; +https://beebox.run)`. A redirect loop or too many hops fails and names the chain.
  - `src/core/webpage/detect-block.ts`: pure `detectBlock({ status, headers, html })`. Signals: status 401, 403, 407, 429, 451, or 503; `cf-mitigated: challenge`; a `server: cloudflare` response with `cf-chl` or a "Just a moment" title; `x-datadome` or a `captcha-delivery.com` script; a short page (under 20 KB) whose title or text has "verify you are human", "are you a robot", "access denied", or "unusual traffic". The list reads as data, and each signal has a test with a fixture. A redirect that ends at a path or host with `login`, `signin`, `sign-in`, `sso`, `checkpoint`, or `captcha` is a block too, unless the requested URL already had that form. It can miss a block; the near-empty text check catches some of those.
  - `src/core/webpage/extract.ts`: `defaultExtract`, Clerk's pipeline over jsdom, loaded by dynamic import. The pipeline is one shared function that takes a document and a URL: `beebox-clerk/src/platform/extract-readable.ts` moves its body there and keeps a thin caller. Chunk 1 picks the location that both packages can import. If neither can import the other without a new package, the function moves to a small workspace package, and that is reported in the budget.
  - `src/core/webpage/write.ts`: moved writer; adds `capture`. The default destination is Clerk's incoming folder. `--to <dir>` picks a tracked folder, and the CLI then commits the returned paths before it prints `Saved`. A second capture of one URL makes a new card: each is a dated copy. Clerk's name has second precision and its write replaces, so the writer adds a short unique suffix and creates the card exclusively, retrying on a collision.
  - **Snapshot (boxholder decision pending, see Open design questions):** `attach/page.frozen` holds the HTML as received, with a `<base href>` added. `capture.snapshot: "html-only"` marks it. `CapturedPageMeta` labels such a snapshot "Saved HTML" with the note that images and styles still load from the site, and keeps "Frozen snapshot" for Clerk's. The schema's text changes to match. The file name stays, so the sandboxed serving rule for it stays.
  - `src/cli/commands/webpage.ts`: `bbx webpage fetch <url> [--to <dir>]`. It runs in the agent's shell, with the same network reach as `curl`. Exit 0 saved, 1 failed, 3 blocked. Stdout: the card path, one `Redirected:` line when any hop happened, any note.
  - `CapturedPageMeta`: shows "Redirected from <first URL>", "Saved by the box browser", and the note.
- **Vocabulary lock-ins:** `bbx webpage fetch`, `capture:`, exit code 3 for blocked.
- **First implementation chunk:** `detect-block.ts`, `fetch.ts`, and `extract.ts`, with tests. Defuddle on jsdom is run on a saved fixture in the first test. No open questions.

### Track B: the box extractor

- **What:** a box replaces or wraps the extractor.
- **Why:** the boxholder's request.
- **Direction:** `runExtractor(response)` looks for `<tricksDir>/webpage-extract.ts`. Absent: it calls `defaultExtract` in process. Present: it spawns tsx on a small runner (the same `resolveTsx` and `buildScriptEnv` as `trick.ts`), sends the response as JSON on stdin, and reads an `Extraction` from a result file. It validates with zod. Timeout 60 seconds. On any failure it runs the default and sets `capture.note`. `capture.extractor` is `"box"` when the box's function produced the result, and the field is absent for the default. A box function that calls `defaultExtract` and returns it unchanged still reports `"box"`. The agent guide's box-layout docs name the file, with a worked example.
- **Vocabulary lock-ins:** the file path, the function signature, `defaultExtract`.
- **First implementation chunk:** `runExtractor` with fixture box files for pass-through, custom, throw, bad shape, and timeout.

### Track C: `bbx browser save`

- **What:** saves the page in the box browser.
- **Why:** the boxholder's request; pages behind login and scripts.
- **Direction:** `POST /api/browser/page` in `exec-route.ts`, agent bearer only. It sends one `--max-output 20000000 eval` that returns `JSON.stringify({ url: location.href, html: <outerHTML of a clone without script elements> })`, through `sendBrowserCommand`, so the URL and HTML always come from one page. The command socket's stdout limit (`command-server.ts`, 2 MB) would cut this, so the socket request gains an optional output limit that only this route sets, up to 20 MB. A pure `parseBoundedOutput` removes the nonce lines and parses the JSON string, and fails rather than saving text with a `[truncated:` line. The route returns `{ url, html }`. Over 20 MB is refused. `bbx browser save [--to <dir>]` is handled like `ask`, builds a captured response with `via: "browser"`, `status: 200`, no redirects, and goes through `runExtractor` and the writer. `detectBlock` runs on the HTML alone, and a match saves nothing and suggests `bbx browser ask`. A page that is not `http(s)` exits 1. The exec route's refusal of `--max-output` for agents stays.
- **Vocabulary lock-ins:** `bbx browser save`.
- **First implementation chunk:** `parseBoundedOutput` with the measured output as a fixture, then the route. `maxBuffer` in `runAgentBrowser` follows the same limit.

### Guidance

The `browser` skill and guide `tools.browser` say: to keep a page, `bbx webpage fetch`; if blocked or it needs a login, open it in the browser and `bbx browser save`. WebFetch stays the tool for reading once. The word budget in `ledger.yaml` needs a raise with a comment.

## Could this be simpler?

- **No box extractor process, a plain dynamic import.** It would run box code inside the CLI with no timeout, and tsx is needed for TypeScript anyway. A throw or hang would take the capture with it. Principle 4.
- **One command with `--browser`.** It would read as one tool, but fetch-only concerns (redirects, status) do not apply, and `bbx browser` is the agent's one way into the browser (parent plan, principle 8).
- **Freeze with `single-file-core` now.** It needs a real page for assets, and it may run in `browser save`. Left out: see NOT in scope. A raw snapshot, labelled, is honest and much smaller.
- **Blocked page saved as a card with a flag.** It needs a new state in every reader, and the boxholder asked to notice blocks.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Block page not recognized, saved as an article | Near-empty and fixture tests | Note when text is near-empty; otherwise missed | Silent for a long block page. Accepted: the card shows the text, and the signal list grows |
| A real page matches a block phrase | Fixture: long article quoting "access denied" | Phrase rule applies only under 20 KB | Clear: exit 3 names the signal |
| Redirect to a login page reads as a success | Fixture | Treated as a block; a login page with an ordinary path is missed, and the card and stdout still show the redirect | Clear for recognized paths; otherwise visible only as the redirect line |
| Two captures with one title in one second | Unit | Unique suffix and exclusive create | Clear |
| Browser navigates during a save | Not reachable | URL and HTML come from one evaluation | Clear |
| Page over the browser output limit | Route test | Refused with the size | Clear |
| Redirect loop | Unit | Fails naming the chain | Clear |
| Redirect from `https:` to a non-web scheme | Unit | Refused | Clear |
| Truncated browser output saved as the page | Unit with the measured output | `parseBoundedOutput` fails on it | Clear |
| Page text carries Markdoc or raw HTML | Existing neutralize path, one test here | `neutralizeIngestedMarkdown` | Clear |
| Page HTML or text carries prompt injection | None | Same treatment as other third-party text; the agent reads a card as data | Accepted, as with Clerk |
| Box extractor hangs | Fixture | 60-second timeout, default runs, note | Clear |
| Box extractor returns markup | Unit | The result goes through the same neutralize step | Clear |
| jsdom slows every `bbx` verb | Measure in chunk 1 | Dynamic import | Clear |
| jsdom runs page scripts | Unit: a script that sets a marker does not run | jsdom's default `runScripts` is off, and no resource loading | Silent if broken, so tested |
| Large page exhausts memory in the agent's shell | 10 MB and 20 MB caps | Refused with the reason | Clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong tool:** ADDRESSED in Guidance: WebFetch to read, these to keep.
- **Stale ref:** the card keeps its copy; a site's change does not affect it.
- **Two agents capture one page:** ADDRESSED: two dated cards, no shared state.
- **Hand-edit drift:** a hand-written `capture` block is checked by the schema.
- **Fabricated value:** ADDRESSED: `capture` is written by the commands. An agent can edit it, as it can any field.
- **Validation error UX:** ADDRESSED: extractor shape errors name the field in the note.
- **Partial migration:** the new field is optional. Older cards have none.
- **Blocked in a scheduled run:** ADDRESSED: exit 3 and stdout; no person step is implied.

## NOT in scope

- **Getting past a block:** the probe, a home exit, and any stealth choice are separate decisions.
- **Self-contained snapshots from these commands:** `single-file-core` needs its own spike in the box browser. Labelled HTML until then.
- **A tRPC route or UI button:** agents and schedules run the CLI.
- **Filling in iOS share's link-only cards:** a natural next caller; no one asked yet.
- **Per-site extractor registry:** the box function can branch on the URL.
- **Header image capture:** the old trick did this; Clerk does not.

## Open design questions

- Snapshots: the issue asks for Clerk's self-contained freeze, and these commands save HTML only, labelled as such. Lean: ship this first, because a labelled copy with a good markdown body covers the request. `single-file-core` in the box browser would be a follow-up. This relaxes the issue's text, so it needs the boxholder's yes.
- The honest user agent will be refused by more sites than a browser-like one. Lean: stay honest, because the box browser handles those sites. The boxholder may prefer otherwise, given the user-agent framing of 2026-10-31. A later flag changes one string.

## Knowledge audits

- `webpage-keep-a-page` (`knows_directly`, chat mode): "Sofia asks you to keep a copy of an article at a URL. What do you run?" `correct_contains: ["bbx webpage fetch"]`.
- `webpage-blocked`: "`bbx webpage fetch` says the site blocked it. What next?" `correct_contains: ["bbx browser"]`.
- `webpage-custom-extractor`: "Captures from one site lose the ingredient list every time. How do you fix that for this box?" `correct_contains: ["webpage-extract"]`.

All land run on the worktree's `test1` clone.

## What will hold this after it ships

- Pure units: `detectBlock` (fixtures), `parseBoundedOutput`, redirect chain handling with a fake `fetchImpl`.
- A local HTTP server in CLI tests for real redirects and status codes, using the CLI test pattern in `test/cli/commands/browser/command.test.ts`.
- One fixture page with one expected markdown output tests the shared function.
- `bbx browser save` against a real browser once on the test box; the route is tested with the fake command socket.
- No new test tier.

## Implementation order

1. Track A units; measure jsdom load.
2. Moved writer, schema field, `bbx webpage fetch`, card header.
3. Track B.
4. Track C.
5. Guidance, audits, real run on `test1`: a redirecting URL, a real block if one is at hand, a logged-in page, a custom extractor. One labeled exhibit.

## Rollout shape

Done when the tests above pass, the audits are run, and the real run works. No migration: the new field is optional. Dependency additions go in `beebox/package.json`, so the deploy installs them. It ships when the boxholder says so.
