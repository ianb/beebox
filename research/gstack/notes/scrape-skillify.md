# /scrape + /skillify

A two-skill pair that implements **"observe → codify"**: the first time you ask to extract data from a page, the agent figures it out interactively; the second time, you can promote that figured-out flow into a permanent fast-path skill that future calls automatically dispatch to.

## What `/scrape` actually does

`/scrape <intent>` is the user-facing entry point for pulling data off a web page. Read-only by contract — mutating verbs (submit, click, log in) are explicitly refused and routed to a (not-yet-shipped) `/automate`.

Under the hood, it has two paths:

1. **Match path (~200ms)** — Lists existing browser-skills (`$B skill list`), reads each one's `triggers:`/`description:`/`host:` frontmatter, and if the user's intent semantically matches one, runs it via `$B skill run <name>` and emits the JSON.
2. **Prototype path (~30s)** — No match. Drive the page using primitives (`$B goto`, `$B snapshot --text`, `$B html`, `$B links`), iterate on selectors, and produce a JSON result.

After a successful prototype, it appends exactly one line:
> "Say /skillify to make this a permanent skill (200ms on next call)."

That nudge is the whole bridge. No nag, no pros list.

## What `/skillify` does

Reads back through the last ≤10 agent turns to find the most recent `/scrape` invocation that:
- Was bounded (clear intent + trailing JSON)
- Wasn't subsequently invalidated by the user ("that's wrong", "try again")

Then it:

1. **Provenance guard** — refuses if there's no recent successful scrape. Won't synthesize a skill from chat fragments or from a match-path scrape (already codified).
2. **Proposes name + 3-5 trigger phrases + tier** (global vs project) via an `AskUserQuestion`. Checks for tier-shadowing against existing skills.
3. **Synthesizes `script.ts`** — uses ONLY the final-attempt `$B` calls that produced the accepted JSON. Drops failed selector attempts, unrelated commands, all prose. Forces a `parseFromHtml(html: string): Item[]` **pure function** so it can be tested without the daemon.
4. **Captures a fixture** — `$B html > fixtures/<host>-<date>.html`.
5. **Writes `script.test.ts`** — requires at least one "★★" assertion (shape + non-empty key fields), not just a smoke test that the parser doesn't throw.
6. **Writes everything to a temp dir first**, runs `$B skill test`, and only renames into the final tier path on (a) test pass + (b) explicit user approval.
7. **On failure, removes the temp dir entirely.** There is no "almost shipped" state.

## What's actually novel

The **iron-contract** part: a skill is only ever written to disk if a freshly-generated test against a freshly-captured fixture passes. This isn't just safety theater — it's the difference between "agent generates code that might run" and "agent generates code that we just observed running on the user's actual target."

The pattern generalizes to anything where:
- First execution requires intelligence (selector discovery, schema sniffing, prompt iteration)
- Subsequent executions could be cheap deterministic code
- You can capture a fixture during the first run that lets you regression-test the deterministic version

It's basically **memoization with a typed cache key** — but the cache key is "user intent" (matched semantically), the cached value is generated code, and you only commit the cache entry if it passes a test on the input that originally produced it.

## Why it requires `$B`

`$B` is gstack's browser daemon — a long-lived Puppeteer/Playwright session with primitives (`goto`, `snapshot`, `html`, `click`, `fill`, `skill list`, `skill run`, `skill test`). The whole scrape→skillify pipeline depends on `$B` because:

- The match path needs a skill registry with searchable frontmatter
- The prototype path needs ~100ms-per-command primitives (forking a fresh browser each call would make iteration impossibly slow)
- The fixture-capture step needs a persistent session
- The skill-run step needs the registry that `skill list` queries

So adopting scrape+skillify means adopting `$B` first. That's the real cost.

## Verdict for callback

The mechanic is **excellent**. The infrastructure (`$B` daemon, skill registry, test runner, bundled hackernews-frontpage reference skill) is substantial. Probably not worth porting wholesale, but worth remembering as a pattern when we have a similar shape:

- **Possible callback application**: card validation/parsing. First time we encounter a new schema element, agent figures out how to handle it; we capture the input as a fixture; promote the handler to a permanent path. (Probably overkill — cardworks is already declarative.)
- **More plausible**: any future "look at this box and tell me X" workflow where the box layout varies and the agent has to discover structure each time.

The take-home idea worth keeping in mind: **"if the agent had to figure something out once, capture the artifact (code + fixture + test) so it doesn't have to figure it out again, and refuse to commit the artifact unless it passes the test that proves it works."**

## Ian's take

- Not interested in self-hosting a browser daemon. Browser infrastructure is a pain and constrains what we can do.
- A hosted scraping service (Browserbase, ScrapingBee, Browserless, etc.) could fill the same role if we ever need one.
- The **iterate-then-codify** pattern itself is the keeper — generalize beyond scraping. Anything where the agent figures something out once and could cache the result as deterministic code.
