---
title: "bbx webpage: make a webpage card from a URL or from the box browser"
status: draft
workstream: shared-browser
issues:
  - ../../../issues/features/2026-09-11-server-side-webpage-capture.md
---
# bbx webpage

An agent can save a page as a webpage card only by writing its own script. This plan adds one command with two sources. `bbx webpage <url>` gets the page over plain HTTP. `bbx webpage --browser` takes the page open in the box browser. Both pass the page through one box function, `src/tricks/webpage.ts` when the box has one, which turns a page into a card or refuses it.

**Issues addressed:** `issues/features/2026-09-11-server-side-webpage-capture.md` (resolved). Related, stays open: `issues/features/2026-10-04-fetch-blocked-pages.md` (this notices blocks and does not get past them); `issues/features/2026-10-09-citation-conventions-and-kept-copies-of-sources.md`.

Boxholder request, 2026-11-01: "a tool to both fetch pages into the webpage format (using a normal fetch), one that ideally notices blocked conditions. It should follow redirects, but make it clear in both the card and stdout that it did so. And for the agent-browser we should also have something that makes a webpage card." And: "let the box customize the text extraction. Use a standard one ... a function that takes the response (URL, etc) and by default just passes it directly to the default extractor, but can do anything."

Boxholder decisions, 2026-11-01: "I don't like fetch/save/extract, too many names for the same thing! Maybe also a trick to detect bad pages (login, blocked, etc), so the agent can start to automatically filter out cases it regularly discovers (on sites with bad error codes). We should specifically try not to get login redirects, and/or not follow redirects and let the agent do that. HTML-only is quite okay, Clerk's copies are pretty heavy. Fetches should look like a normal browser."

## Design

### Situations

- When Sofia asks the box to keep the article she mentioned, she wants the agent to save a readable copy, so the article is still there and searchable when the site changes it.
- When a link redirects to a sign-in page, she wants the agent to see where it was going before it follows, so a login page is not saved as her article.
- When a short link leads to the article, she wants the card to say so, so she can tell which address the copy really came from.
- When a site answers with a "verify you are human" page, she wants no card of that page, and an agent that says what happened, so a block page never sits in her box as if it were the article.
- When a page only exists after login or scripts, she wants the agent to save what the box browser shows, so the copy matches what she saw.
- When a recipe site's text always loses the ingredient list, the agent wants to teach this box a better way for that site, so every later card is right.
- When a forum answers 200 with a "please sign in" page, the agent wants to add that case to the box's rules after seeing it once, so it never saves that page again.
- When the agent only needs to read a public page once, nobody wants a card: WebFetch stays the tool for that.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Asked to keep a page | Act | Webpage card, reported in chat | Waits to be found |
| Redirect stops the command | Show, no card | Agent decides whether to follow | Background |
| Followed a redirect | Show | "Redirected from" on the card; stdout | Waits to be found |
| Blocked | Show, no card | Agent's chat reply | Waits to be found |
| Box function failed | Show | Note on the card; stdout | Waits to be found |
| Only reading once | Quiet | No card | None |

### Spirit

- **Serves:** "You should be able to see the gears": the card says how it was captured, from where, through which redirects, and whether the box function made it.
- **Risks:** "Nothing should just disappear" is at odds with refusing a blocked page. Guard: the refusal is reported with the reason, and the agent has a next step (the box browser).

### Trust

The commands start at **automatic** for an agent that was asked to keep a page. A capture changes nothing outside the box. With no `--to`, the card lands in the incoming folder, which git ignores until the agent files it, as with Clerk (`clerk.ts`: *"Not committed: the incoming folder ignores itself, and the chat files the card into git."*). With `--to`, the command commits the card and its snapshot before it reports success. The guidance does not tell agents to capture on their own initiative. A custom extractor is box code, written by the agent in the box's own repository, and it has the same reach as any trick.

### When it goes wrong or does nothing

- **Refused (blocked, or a box rule):** exit 3, no card, and stdout gives the reason and suggests `bbx browser open`.
- **Redirect to another address:** exit 4, no card. Stdout gives the status, the target, and the exact command to follow it.
- **Other HTTP failure, or not HTML:** exit 1 with the status or type, no card.
- **Almost no text extracted:** the card is saved, and stdout and the card note say so. The page may need scripts, and stdout suggests the browser.
- **Box function throws, times out, or returns the wrong shape:** `standard` runs, and the card and stdout say which failed and why.
- **Browser on a blank page:** `bbx webpage --browser` exits 1 and says so.

### Walkthrough

1. Sofia says "keep that article". The agent runs `bbx webpage https://t.example/abc`.
2. The server answers 301 to `https://news.example/article`, a different host. The command stops with exit 4 and prints `Redirects to https://news.example/article (301). To follow: bbx webpage https://news.example/article --from https://t.example/abc`.
3. The target looks like an article, so the agent runs that command. It gets HTML, `standard` finds no block, and the command writes the card with its saved HTML.
4. Stdout says `Saved _content/incoming/Article-title.webpage.card` and `Redirected: https://t.example/abc -> https://news.example/article`.
5. The card's page shows "Redirected from https://t.example/abc" beside the capture time. The agent tells Sofia.

## Smallest fix and budget

Smallest fix: `bbx webpage` with `standard` and nothing else. It fails three stated requests.

Chosen design: tracks A to C. Estimate: about 650 lines of source and 450 of tests; docs and guidance about 60. New runtime dependencies in beebox: `defuddle`, `dompurify`, `turndown`, `jsdom`. **jsdom is large; Track A measures whether it can load only inside the capture commands, because every `bbx` verb loads server modules (`route.ts`: "every `bbx` verb loads the server modules").**

## Stated preferences this plan trades against

- **`docs/engineering-principles.md` 8 (one way to do each thing):** the issue names a second extractor as the failure to avoid, so both packages call one shared function. The box function is a deliberate exception, asked for by the boxholder.
- **The schema's "self-contained" snapshot promise (`src/schemas/webpage.tsx`):** these commands do not inline assets. See Track A.
- **Earlier "no stealth" line:** the boxholder withdrew it (2026-10-31, 2026-11-01). The commands send a browser's headers and nothing further.

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
- **Captured response** (new): what the function receives. `{ url, requestedUrl, redirects, status, headers, contentType, html, via: "fetch" | "browser" }`.
- **Result** (new): what the function returns: a card's content `{ title, markdown, siteName?, byline?, excerpt? }`, or a refusal `{ refuse: "<reason>" }`.
- **`standard`** (new): the built-in function: it runs the block check, then Clerk's extraction. Exported from `beebox/server`.
- **Box function** (new): `<tricksDir>/webpage.ts`, whose default export is `async (response, { standard }) => Result`. Optional. One function holds both the box's bad-page rules and any custom text handling.
- **`capture`** (new card field): `{ via, snapshot: "html-only", redirectedFrom?: [{ url, status }], function?: "box", note?: string }`. Absent on Clerk and share cards.
- **Refusal** (new): a page that makes no card, with a reason. It comes from `standard`'s block check or from the box function.

## Tracks / scope

### Track A: `bbx webpage`

- **What:** fetch, block detection, extraction, card.
- **Why:** no sanctioned path for an agent (see the issue).
- **Direction:**
  - `src/core/webpage/fetch.ts`: `fetchPage(url, { fetchImpl })` with `redirect: "manual"`. It follows a redirect itself only when the target is the same page in another form: `http:` to `https:`, adding or removing `www.`, or a trailing slash. At most 5 such hops, each recorded. Any other redirect stops with exit 4, the target, and the command to follow it, with `--from <url>` so the card records where it began. Refusing to guess at login pages is the point: the agent sees the target first. `http:` and `https:` only. Timeout 30 seconds in total. Body cap 10 MB; over it is a failure with the reason. Request headers are a current desktop Chrome's: `User-Agent`, `Accept`, `Accept-Language`. One constant holds them. The TLS fingerprint stays Node's; this plan changes nothing else about how a request looks. A redirect loop or too many hops fails and names the chain.
  - `src/core/webpage/detect-block.ts`: pure `detectBlock({ status, headers, html })`, called by `standard`. Signals: status 401, 403, 407, 429, 451, or 503; `cf-mitigated: challenge`; a `server: cloudflare` response with `cf-chl` or a "Just a moment" title; `x-datadome` or a `captcha-delivery.com` script; a short page (under 20 KB) whose title or text has "verify you are human", "are you a robot", "access denied", or "unusual traffic". The list reads as data, and each signal has a test with a fixture. It can miss a block; the near-empty text check catches some of those.
  - `src/core/webpage/extract.ts`: `standard`, Clerk's pipeline over jsdom, loaded by dynamic import. The pipeline is one shared function that takes a document and a URL: `beebox-clerk/src/platform/extract-readable.ts` moves its body there and keeps a thin caller. Chunk 1 picks the location that both packages can import. If neither can import the other without a new package, the function moves to a small workspace package, and that is reported in the budget.
  - `src/core/webpage/write.ts`: moved writer; adds `capture`. The default destination is Clerk's incoming folder. `--to <dir>` picks a tracked folder, and the CLI then commits the returned paths before it prints `Saved`. A second capture of one URL makes a new card: each is a dated copy. Clerk's name has second precision and its write replaces, so the writer adds a short unique suffix and creates the card exclusively, retrying on a collision.
  - **Snapshot (boxholder decision, 2026-11-01: "HTML-only is quite okay"):** `attach/page.frozen` holds the HTML as received, with a `<base href>` added. `capture.snapshot: "html-only"` marks it. `CapturedPageMeta` labels such a snapshot "Saved HTML" with the note that images and styles still load from the site, and keeps "Frozen snapshot" for Clerk's. The schema's text changes to match. The file name stays, so the sandboxed serving rule for it stays.
  - `src/cli/commands/webpage.ts`: `bbx webpage <url> [--from <url>] [--to <dir>]` and `bbx webpage --browser [--to <dir>]`. It runs in the agent's shell, with the same network reach as `curl`. Exit 0 saved, 1 failed, 3 refused, 4 redirect not followed. Stdout: the card path, one `Redirected:` line when any hop happened, any note.
  - `CapturedPageMeta`: shows "Redirected from <first URL>", "Saved by the box browser", and the note.
- **Vocabulary lock-ins:** `bbx webpage`, `capture:`, exit 3 refused, exit 4 redirect.
- **First implementation chunk:** `detect-block.ts`, `fetch.ts`, and `extract.ts`, with tests. Defuddle on jsdom is run on a saved fixture in the first test. No open questions.

### Track B: the box function

- **What:** one function where a box adds bad-page rules and custom text handling.
- **Why:** the boxholder's requests. Sites with wrong status codes are found one at a time, so the agent records each case here.
- **Direction:** `runWebpageFunction(response)` looks for `<tricksDir>/webpage.ts`. Absent: it calls `standard` in process. Present: it spawns tsx on a small runner (the same `resolveTsx` and `buildScriptEnv` as `trick.ts`), sends the response as JSON on stdin, and reads an `Extraction` from a result file. It validates with zod. A refusal goes to exit 3 with the function's reason. Timeout 60 seconds. On any failure it runs the default and sets `capture.note`. `capture.function` is `"box"` whenever the box's function produced the result. The agent guide's box-layout docs name the file, with a worked example.
- **Vocabulary lock-ins:** the file path, the function signature, `standard`, `{ refuse }`. The guide tells the agent: when a saved or refused page was wrong, add the case here.
- **First implementation chunk:** `runWebpageFunction` with fixture box files for pass-through, custom, throw, bad shape, and timeout.

### Track C: `--browser`

- **What:** saves the page in the box browser.
- **Why:** the boxholder's request; pages behind login and scripts.
- **Direction:** `POST /api/browser/page` in `exec-route.ts`, agent bearer only. It sends one `--max-output 20000000 eval` that returns `JSON.stringify({ url: location.href, html: <outerHTML of a clone without script elements> })`, through `sendBrowserCommand`, so the URL and HTML always come from one page. The command socket's stdout limit (`command-server.ts`, 2 MB) would cut this, so the socket request gains an optional output limit that only this route sets, up to 20 MB. A pure `parseBoundedOutput` removes the nonce lines and parses the JSON string, and fails rather than saving text with a `[truncated:` line. The route returns `{ url, html }`. Over 20 MB is refused. `bbx webpage --browser [--to <dir>]` is handled like `ask`, builds a captured response with `via: "browser"`, `status: 200`, no redirects, and goes through `runWebpageFunction` and the writer. `standard`'s block check sees `status: 200` and the HTML, and a refusal suggests `bbx browser ask`. A page that is not `http(s)` exits 1. The exec route's refusal of `--max-output` for agents stays.
- **Vocabulary lock-ins:** `bbx webpage --browser`.
- **First implementation chunk:** `parseBoundedOutput` with the measured output as a fixture, then the route. `maxBuffer` in `runAgentBrowser` follows the same limit.

### Guidance

The `browser` skill and guide `tools.browser` say: to keep a page, `bbx webpage`; if blocked or it needs a login, open it in the browser and `bbx webpage --browser`. WebFetch stays the tool for reading once. The word budget in `ledger.yaml` needs a raise with a comment.

## Could this be simpler?

- **No separate process for the box function, a plain dynamic import.** It would run box code inside the CLI with no timeout, and tsx is needed for TypeScript anyway. A throw or hang would take the capture with it. Principle 4.
- **Two commands.** The first draft had `bbx webpage fetch` and `bbx browser save`. The boxholder rejected the extra names. The command still reaches the browser only through the agent-bearer route, so the parent plan's rule holds.
- **Follow every redirect and look for login paths.** It needs a list of login patterns and still misses some. Stopping costs one more command for a short link.
- **Freeze with `single-file-core` now.** It needs a real page for assets, and it may run with `--browser`. Left out: see NOT in scope. A raw snapshot, labelled, is honest and much smaller.
- **Blocked page saved as a card with a flag.** It needs a new state in every reader, and the boxholder asked to notice blocks.
- **Separate functions for detection and text.** A second file and a second name, and a rule often needs both.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Block page not recognized, saved as an article | Near-empty and fixture tests | Note when text is near-empty; otherwise missed | Silent for a long block page. Accepted: the card shows the text, and the signal list grows |
| A real page matches a block phrase | Fixture: long article quoting "access denied" | Phrase rule applies only under 20 KB | Clear: exit 3 names the signal |
| A redirect to a login page | Fixture | Exit 4 before any page is read; the agent sees the target | Clear |
| A login page served at the requested URL with 200 | Fixture for the phrase rule | `standard` catches short pages; the agent adds the rest to the box function | Silent the first time. Accepted: this is what the box function is for |
| `www.` redirect that also changes the path | Unit | Not the same page form: exit 4 | Clear |
| Two captures with one title in one second | Unit | Unique suffix and exclusive create | Clear |
| Browser navigates during a save | Not reachable | URL and HTML come from one evaluation | Clear |
| Page over the browser output limit | Route test | Refused with the size | Clear |
| Redirect loop among same-page forms | Unit | Fails naming the chain | Clear |
| Redirect from `https:` to a non-web scheme | Unit | Refused | Clear |
| Truncated browser output saved as the page | Unit with the measured output | `parseBoundedOutput` fails on it | Clear |
| Page text carries Markdoc or raw HTML | Existing neutralize path, one test here | `neutralizeIngestedMarkdown` | Clear |
| Page HTML or text carries prompt injection | None | Same treatment as other third-party text; the agent reads a card as data | Accepted, as with Clerk |
| Box function hangs | Fixture | 60-second timeout, `standard` runs, note | Clear |
| Box function returns markup | Unit | The result goes through the same neutralize step | Clear |
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
- **Validation error UX:** ADDRESSED: function shape errors name the field in the note.
- **Partial migration:** the new field is optional. Older cards have none.
- **Blocked in a scheduled run:** ADDRESSED: exit 3 and stdout; no person step is implied.

## NOT in scope

- **Getting past a block:** the probe, a home exit, and any stealth choice are separate decisions.
- **Self-contained snapshots from these commands:** `single-file-core` needs its own spike in the box browser. Labelled HTML until then.
- **A tRPC route or UI button:** agents and schedules run the CLI.
- **Filling in iOS share's link-only cards:** a natural next caller; no one asked yet.
- **Per-site rule registry:** the box function can branch on the URL.
- **Header image capture:** the old trick did this; Clerk does not.

## Open design questions

None. The boxholder settled snapshots and the request headers on 2026-11-01. The issue's self-contained freeze is relaxed by that decision.

## Knowledge audits

- `webpage-keep-a-page` (`knows_directly`, chat mode): "Sofia asks you to keep a copy of an article at a URL. What do you run?" `correct_contains: ["bbx webpage"]`.
- `webpage-bad-page`: "A forum answers 200 with a sign-in page and `bbx webpage` saved it. How do you stop that in future?" `correct_contains: ["webpage.ts"]`.
- `webpage-redirect`: "`bbx webpage` stops and says the URL redirects to a sign-in page. What do you do?" `watch_for: does not follow it blindly; asks the person or uses the box browser`.
- `webpage-blocked`: "`bbx webpage` refused a page as blocked. What next?" `correct_contains: ["bbx browser"]`.
- `webpage-box-function`: "Captures from one site lose the ingredient list every time. How do you fix that for this box?" `correct_contains: ["webpage.ts"]`.

All land run on the worktree's `test1` clone.

## What will hold this after it ships

- Pure units: `detectBlock` (fixtures), `parseBoundedOutput`, redirect chain handling with a fake `fetchImpl`.
- A local HTTP server in CLI tests for real redirects and status codes, using the CLI test pattern in `test/cli/commands/browser/command.test.ts`.
- One fixture page with one expected markdown output tests the shared function.
- `bbx webpage --browser` against a real browser once on the test box; the route is tested with the fake command socket.
- No new test tier.

## Implementation order

1. Track A units; measure jsdom load.
2. Moved writer, schema field, `bbx webpage`, card header.
3. Track B.
4. Track C.
5. Guidance, audits, real run on `test1`: a redirecting URL, a real block if one is at hand, a logged-in page, a box function with a refusal and custom text. One labeled exhibit.

## Rollout shape

Done when the tests above pass, the audits are run, and the real run works. No migration: the new field is optional. Dependency additions go in `beebox/package.json`, so the deploy installs them. It ships when the boxholder says so.
