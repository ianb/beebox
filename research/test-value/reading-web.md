# Test-value evidence: webapp routes, frontend, hub, cli

Worktree: test-value-research. All paths below are relative to `beebox/`.
Ages: first-add date following the pre-2026-10-18 `.doctest.md` name (and the `(pre-rename package)/` package name before 2026-08-30). "unknown" = origin not traced.

Classification axes (from the brief): W = what it taught when written (W1 boundary, W2 bug pin, W3 contract being built, W4 exploration found nothing, W5 unclear); R = what it teaches per run (R1 branch/rule, R2 cross-system contract, R3 trust boundary, R4 migration/on-disk, R5 restates straight-line code, R6 second proof, R7 tests fake/framework/type, R8 pins a choice). "why-comment" = does the comment say why the expected value is right. "weak" = would pass against a no-op or the obvious wrong thing.

One example can carry more than one R label; the per-file counts use the primary one.

---

## webapp (7 files)

### 1. test/webapp/routes/pairing.test.ts
45 lines, added 2026-07-07, 2 tests, 11 asserts (old tap `st.equal`/`st.ok` style, no `t.check`; lint rule in `.claude/rules/tests.md` now forbids this form).

| example | W | R | why-comment | weak |
|---|---|---|---|---|
| "pairing redeem URL matcher accepts only bare and box-prefixed routes" — 7 `st.equal(isPairingRedeemUrl(...), bool)` | W5 (no reason given) | R1: the regex `^\/[^/]+\/api\/pairing\/redeem$` is a one-segment prefix rule; an edit to allow nested prefixes or to drop the `?` strip breaks it. R3-adjacent: this matcher decides which URLs skip the auth wall in `server-box-scope.ts`/`hub/server/core.ts` | no (no comment at all) | no |
| "a paired device resolves to the person who paired it" — `st.equal(identity?.createdBy, "guest@example.com")`, `st.equal(anonymous, null)` | W2: comment says "Before this, the mobile path authenticated a DEVICE and no person: the tRPC context left `user` null" | R3 (identity carried from device to context); R5 for the `null` branch — `resolveMobileBearerIdentity` is 4 lines that forward to `deviceStore.verify` | yes | partly: `st.ok(device); if (!device) return;` makes the rest skippable |

Counts: W2 1, W5 1; R1 1, R3 1 (+R5 1 sub-check). Not a route test despite the directory: it never injects a request; the 403/400 branches in `registerPairingRoutes` are untested here. Sibling `test/core/mobile/pairing.store-concurrency.test.ts` also exercises `resolveMobileBearerIdentity`.

### 2. test/webapp/auth.required.test.ts
273 lines, added 2026-07-19 (as `auth-required.doctest.md`), 7 tests, 23 checks.

| example | W | R | why | weak |
|---|---|---|---|---|
| "cookieless request is unauthenticated" — `resolveRequestIdentity(cookieless,{openAccess:false})` → `{email:null,name:null,source:null}`; `openAccess:true` → `source:"open"` | W1: comment names the single place openness is decided ("call sites read `identity.source` rather than re-derive") | R1/R3: a later edit that makes `openAccess` default true, or that returns `"open"` when hub mode is off, fails it | yes | no |
| "Diagnostic bypass: EVERY batched tRPC procedure must be whitelisted" — `health.check,history.list?batch=1` → `false`; wrong key → false; POST → false | W2: "the fix for the old substring match that let a diag-key holder read past the two allowed endpoints" | R3: guards `procedures.every(whitelist)` and the GET-only rule; an edit to `some()` or dropping the method check breaks it | yes | no |
| "openAccess server is non-listenable" — `checkThrows(assertOpenAccessNotListening({openAccess:true}), "OpenAccessListenError")`; `{}` and `{openAccess:false}` → `undefined` | W3 (plan: open access is test-only) | R3 for the throw. The two `undefined` checks are R5/R7: the guard is a 3-line `if`, and `undefined` is what any non-throwing void function returns | yes | the `undefined` checks pass against an empty function |
| "The public entry point fails closed too" — `startServer({openAccess:true})` rejects with `OpenAccessListenError` | W3 | R6: same guard one layer up; proves `startServer` calls `assertOpenAccessNotListening` before side effects (the ordering claim is in the comment but not checked — nothing asserts no disk/network was touched) | partly | no |
| "/auth/me advertises open access; /api/push/resubscribe sits behind the wall" — open server: `/auth/me` → `{statusCode:200, body:{open:true}}`; resubscribe → 400 `missing subscription` | W3 | R2 (`{open:true}` is read by the frontend and `/healthz`); the 400 proves the wall was passed | yes ("proof it reached the handler rather than being blanket-blocked") | no |
| "An auth-on server 401s both" — `/auth/me`, `/api/push/resubscribe`, `files.kind` → `{statusCode:401, body:{error:"Not authenticated"}}` | W3 | R3 ×3; `files.kind` line is R1 ("`files.kind` is a `publicProcedure`: the transport wall, not the procedure, is its auth") | yes | no |
| "The browse key in the tRPC context" — on an opted-in box `scanTokens.list` → 200 `[]`; `secrets.formatHints` → 403 with the long owner-session message; isolated store with `BBX_SECRETS_STORE_ISOLATED=1` → 200 `containing([anything()])`; on a plain box `inventory.summary` → 200, `files.kind` → 200, `voice.capabilities` → 403 "Owner access required" | W3 (secret-custody plan, cited) and W2 for the isolated-store branch ("refusing browse there only made the Secrets panel the one owner surface an agent could never exercise") | R3 ×6: three distinct gates (`authedProcedure`, `ownerProcedure`, `authenticatedOwnerProcedure` excluding `source:"browse"`), plus the env-flag branch. `t.check(authedCall.statusCode, 200)` is a single-field check justified in a comment | yes | no. This test also pins the full tRPC error envelope (`code:-32003, data:{code,httpStatus,path,recovery:null}`), which is R2 for the frontend's error parser but also R7 (tRPC's own shape) |

Counts: W1 1, W2 2, W3 4; R3 13, R1 2, R2 2, R5/R7 3, R6 1. Test titles are auto-truncated prose ("Outside hub mode, a cookieless request is unauthenticated (source:") from the doctest conversion. Heavy env-var juggling (`BBX_*` set/restore in teardowns) because the auth module reads `process.env` directly — the boundary W1 would have wanted was not forced.

### 3. test/webapp/routes/auth.invite-accept.test.ts
371 lines, added 2026-08-06, 3 tests, 22 checks. Source: `src/webapp/routes/auth/invite.ts` (~25 `if`/`return` branches).

| example | W | R | why | weak |
|---|---|---|---|---|
| GET invite page → `{status:200, noStore:"no-store", referrer:"no-referrer", pinned:true}` | W3 | R3 (headers keep the token out of caches/referrers) | partly (file header says token is the credential) | no |
| wrong content type → `{status:400, payload: inviteTitle("Accept invite")}` | W3 | R1: `isFormRequest` guard; comment says it fires "before reading or throttling" but the test does not show the throttle was untouched | partly | no |
| confirm-password typo → 400 with `value="<token>"` and pinned email still in the page | W3 | R1 (the form keeps the live token on a typo; an edit that re-renders without `token` breaks it) | yes | no |
| owner env deleted → 503 unavailable, then restored and the same token accepts → 302 `/test/` + cookie; `listUsers()` → `[storedUser(member)]`; `box.json` → `{allowedEmails:["member@example.com"]}` | W3 | R3: fail-closed before consuming the capability (the later accept proves non-consumption); `email:"attacker-change@..."` in the form proves a pinned invite ignores a supplied email — R3, not called out in the comment | yes for owner; the attacker-email line has no comment | no |
| replay → `{status:410, payload:UNAVAILABLE_PAGE, warned:[["[auth-invite] rejected: category=dead-token ip=127.0.0.1"]]}` | W3 | R3 (single use). Pinning the exact `console.warn` line is R8 — a log wording change fails it | yes | no |
| malformed email on an open invite → 400 and the same token still accepts → 302 | W3 | R3 (malformed input does not burn the capability) | yes | no |
| corrupt auth file → 503, logged `[AuthFileCorruptError ...]`, page does not contain the path or "corrupt" (two `not(any(String).includes(...))`) | W2-ish ("without ... burning through Fastify's default error response") | R3 (no store-path leak); the `logged:` array again pins log wording (R8) | yes | no |
| corrupt invites store → GET 503, POST 503, same two `not(...)` checks | W3 | R6: second proof of "corrupt store fails closed and leaks nothing" (first was the auth file). Two leak checks repeated verbatim | partly | no |
| test 2: box.json unreadable → 503, `cookie:null`, users list has the new member, logged `BoxConfigWriteError` with `configPath`; page includes the orphan email | W3 ("explicit, signed-out partial account") | R3/R1: the partial-account branch (`grant.commitError`) is a real branch a later "roll back the user on config failure" edit would flip | yes | no |
| test 3: open invite claiming owner email (` OWNER@EXAMPLE.COM `) → 410 + `category=collision`; reuse after collision → 410; claiming an allowlisted Google-only email → 410; `listUsers()` → only the owner | W3 | R3 ×3 (`isClaimable`: owner, existing user, allowlist) plus trimming/case-folding of the email is implicitly proved | yes | no |

Counts: W2 1, W3 9 (one group W2-ish); R3 12, R1 3, R6 2, R8 3 (log lines). Nearly every check projects a few fields into an object literal rather than checking the whole response, because the pages are "large generated HTML" — the large-HTML problem pushes the test toward field picking. All 22 checks live in 3 tests, so the first failure in test 1 hides the next ~14 checks.

### 4. test/webapp/routes/chat.send-fast-ack.test.ts
144 lines, added 2026-08-18, 2 tests, 3 checks. Chat router: `POST /api/chat/send`.

| example | W | R | why | weak |
|---|---|---|---|---|
| "The response arrives while the engine start is still parked" — `"200 \| turn=string \| recorded=1 \| runs=0 \| buffered=true"` then after release `"started=true \| errored=null"` | W2: "the client (plus every retry timer behind it) used to spend that whole window pending" | R1: ordering rule "ack, then start the run"; an edit that awaits `startRun` before replying makes the request hang (the gate never opens) and the test times out rather than diffs | yes | partly: `gate.entered` is created but never awaited, so the test does not show that the start was reached before the ack; a route that never starts a run until something else also passes the first check (the second check covers it only after `release()`) |
| "A send that creates a new session acks just as fast" — `"200 \| turn=string \| recorded=1 \| sessionId=null \| runs=0 \| live=true"` | W3 (emission-model plan Track A, cited) | R1 for `sessionId=null` (the message is emitted before the session id exists; an edit that waits for the id breaks it); otherwise R6 of test 1 | yes | same caveat |

Counts: W2 1, W3 1; R1 2 (one partly R6). Checks are stringified projections (`"200 | turn=string | ..."`) rather than whole values — the `check.md` guidance says check `x` not a formatted string, and `typeof turnId` loses the actual id. The gate monkey-patches a private method via `Reflect.set(ChatSession.prototype, "startRun", ...)` with a runtime guard "ChatSession.startRun is gone; move this gate" — the injectable seam the doc asks for was not built.

### 5. test/webapp/routes/api.test.ts
223 lines, added 2026-03-03 (as `(pre-rename package)/test/routes-api.doctest.md`; the oldest file in the sample), 7 tests, 22 checks.

| example | W | R | why | weak |
|---|---|---|---|---|
| HEAD `/api/keepalive` → 204, `cache-control: no-store`, empty payload (3 single-field checks) | W3 ("lazy hub start or refresh that box") | R2: the frontend heartbeat and the hub's wake logic depend on it | partly (why 204/no-store not stated) | no |
| GET `/api/browse/_content/inbox` → `checkText` with `«*»` wildcards around `relativePath` and `"type":"doc"` | W3 | R2 (browse wire shape) but the wildcards skip most of the object, so a changed/added field passes | no | partly: only `path`, one `relativePath`, and `type` are pinned |
| namespace fence: root listing → exactly `["_bookkeeping","_config","_content","_publish","_tmp"]`, `/api/browse/src/tricks/scripts` → 403 `Access denied` | W3 (Track B) | R3 (fence), also R4-ish: the `dirs` literal breaks when a new underscore area is added — that is a real on-disk-layout contract | yes | no |
| GET `/api/files/...` → 200, `no-cache`, body, `typeof last-modified === "string"`; If-None-Match → 304 ""; changed file + stale ETag → 200 new body; `.card` served verbatim | W3 | R2 for `no-cache` (comment: "otherwise agent edits would stay hidden behind stale HTTP cache"); the 304/200 pair is R7-ish — Fastify/etag plumbing, though the "changed file revalidates" case does guard that ETag derives from content, not path. `typeof ... "string"` is a weak type check (R7) | yes for no-cache; partly elsewhere | the `typeof` check passes for any string |
| `/api/files/AGENTS.md` → 403 | W3 | R6: same fence as the browse 403 and as `routers.namespace-fence-traversal.test.ts` (4 other test files also check `statusCode, 403` on fenced paths) | partly | no |
| DELETE → 200; `git log -1` subject `"Deleted by user: ..."`; GET → 404 | W3 | R1/R4: delete commits (an edit that deletes without committing breaks it); the commit-subject literal is R8 | partly | no |
| dirty file preserved in its own commit → two subjects | W2? The comment is about a fixture defect (same-size overwrite invisible to `git status`), citing `issues/bugs/2026-09-14-...`; the behaviour itself is W3 | R1 (the `pathsHaveChanges` branch) | yes, and unusually candid about the fixture workaround | no |

Counts: W2 1, W3 6; R2 3, R3 1, R1 2, R6 1, R7 2, R8 1. Oldest file; many one-field `t.check(res.statusCode, 200)` lines separated by blank lines (doctest conversion residue). `checkText` with `«*»` is used where a whole-object check would be stronger.

### 6. test/webapp/routes/pairing.device-scope.test.ts
113 lines, added 2026-09-12, 1 test, 4 checks.

| example | W | R | why | weak |
|---|---|---|---|---|
| owner `pairing.devices` → `"200 box owner phone \| member phone \| a phone paired before pairers were recorded"`; member → `"200 own member phone"` | W3 (file header: "the owner reaches every device on the box, and a member reaches the devices they paired"; the rule itself is pinned in `test/core/mobile/pairing.device-visibility.test.ts`; "this is the gate over HTTP") | R3; also R2 (`scope: "own"` is what the panel reads to head the list). Partly R6 of the core test by the file's own admission | yes | no |
| member unpair: `"somebody else's: NOT_FOUND, their own: ok"` | W3 | R3; the comment gives the reason for NOT_FOUND over FORBIDDEN ("a distinct code would confirm the id exists") — a rule a later "be helpful" edit would break | yes | no |
| browse key → `pairing.createTicket` → `"403 FORBIDDEN"` | W2-ish ("Left alone it could mint a device recorded against nobody ... pair a phone it could never unpair") | R3 | yes | no |

Counts: W2 1, W3 2; R3 3 (one with R6 flavour). Good why-comments. Checks are again formatted strings, and the devices payload goes through a `z.looseObject` parse, so any new field in the response is invisible.

### 7. test/webapp/trpc/routers.namespace-fence-traversal.test.ts
380 lines, added 2026-09-04, 4 tests, 35 checks.

| example | W | R | why | weak |
|---|---|---|---|---|
| test 1 (26 checks): `_content%2f..%2fpackage.json` → 403 on GET/PUT/DELETE `/api/files`, `/api/files-commit`, `/api/browse`, `/api/image`; `/api/figure` → 400; history blob → 403; `card.get` → "Invalid card path"; `status.browse` → empty listing object; `files.summarize` → `[null]`; package.json unchanged | W2: "Before this fix, several routes checked `isInBoxNamespace` on the raw, un-normalized request string" | R3 ×~12, one per route. Each route resolves through the same `resolveBoxNamespacePath`, so after the fix most of these are R6 of each other — but the comment says the bug was precisely that routes diverged, so per-route repetition is the point. `figure` → 400 vs 403 elsewhere is an unexplained inconsistency the test pins (R8) | yes (the file header is the best why-comment in the sample: explains why percent-encoding is needed to reach the bug) | no |
| display-form paths (`Config:box.json`) → 400 with the message "...is the boxholder's display form; write `/_config/box.json`" on files/browse/image/figure/card.get/status.browse/history.list; `card.get` suggests `/_content/recipes/Soup.recipe.card` when it exists, plain "Invalid card path" when not | W3 (display-path-guard subplan, cited) | R1 for the suggestion branch (exists vs not); the 7 message literals are R8 ×7 (wording) and R6 (one helper produces all of them) | yes | no |
| test 2: symlink `_content/pkg -> ..` → 403 on GET/PUT, package.json untouched, browse `_content/pkg` and `_content/pkg/src` → 403, `card.get` refuses, `status.browse` empty, `summarize` → `[null]` | W2 ("a genuinely different attack ... needs the on-disk (`realpath`) check") | R3 ×8; again per-route repetition of one `realpath` rule | yes | no |
| test 3: annex-style leaf symlink → GET 200 with bytes, PUT 403, DELETE 403 | W2/W3 ("must not break the shape git-annex actually uses") | R1: the one branch that distinguishes leaf-file symlink from directory symlink; the single check in the file most likely to be broken by a "tighten the fence" edit | yes | no |
| test 4: browse child symlink to `../src/private.doc.card` → `{names:["Normal"], conflicts:[false]}` | W2 ("Round-6 hardening ... before this fix, the child loop's `loadCardFrontmatter` followed that symlink") | R3 | yes | no |

Counts: W2 4 groups, W3 1; R3 ~22, R1 2, R8 ~8, R6 (overlapping) ~15. The per-route fan-out is deliberate and documented, but ~20 checks reduce to "every route calls the resolver". `status.browse` returning `{path, dirs:[], cards:[], files:[], background:false}` for an escape is a silent-empty contract the comment flags only in passing.

---

## frontend (6 files)

### 8. src/frontend/test/components/app-bar-chrome.place-owners.test.ts
49 lines, added 2026-10-16, 1 test, 1 check (DOM test with `mount()`).

| example | W | R | why | weak |
|---|---|---|---|---|
| `shown` → `["Browse: recipes", "Browse: recipes", "Kitchen chat"]` | W2: "An earlier version cleared the entry in the effect cleanup and published it again as a new owner ... (fixed in `e22c56ead`). Only effect ordering shows this bug" | R1: a republish must update in place; an edit that returns to cleanup-then-publish produces `"Kitchen chat"` in slot 2 | yes | no |

Counts: W2 1; R1 1. The best-shaped example in the sample: one claim, three observations in one array, a named commit, and a stated reason for the harness choice.

### 9. src/frontend/test/components/PersonView.person-view.test.ts
176 lines, added 2026-10-06, 7 tests, 11 checks. Renders with `renderToStaticMarkup`, then regex-projects the HTML (`visibleText`, `links`, `hasTable`).

| example | W | R | why | weak |
|---|---|---|---|---|
| boxholder with every contact → summary `"Archivist \| Boxholder \| Email rosa@example.com \| Phone +44 20 7946 0000 \| Address ... \| Also: Ro, The Quill"`, links `["mailto:...","tel:+442079460000"]`, no table, no `<h1`, body present | W3 (design: "A person card's front leads with ...") | R8 for the row order and labels ("Email", "Also:"); R1 for `tel:` digit stripping and for the blanked `# Rosa Quill` heading; R2-ish for `mailto:`/`tel:` hrefs | partly (what, not why for most) | no |
| name only → `[null, [], false, true]` | W3 | R1 (absent fields leave no rows and no empty table) | yes | no |
| archived with/without role → `"Former landlord \| Archived"`, `"Archived"` | W3 | R8 (wording) / R1 (RoleLine's `role === undefined && !boxholder && !archived` branch) | partly | no |
| `todos` goes to the shared table; embed shows the name; unknown schema keeps `Email`/`Nickname` labels, no `Name` row | W3 | R1 ×3 (three branches of `splitCardFields`/mode); the `field-label">Email<` substring checks are R8 (class name) | yes | no |
| `"\|Day job\|Harbour Archive\| (volunteer)\|"` | W3 | R6: the same rule is tested in `MarkdownCardView...test.ts` ("Lender|Idris| (lender)") and the label rule in `readable-fields.test.ts` | partly | no |
| `boxholder:"yes"`, `archived:false` with unknown schema → not drawn, fall through to table | W3 | R1 (strict `=== true`) | yes | no |
| `telHref` ×4 → `["tel:+15550100100", null, null, null]`; a phone with `x12` yields no link | W2-ish ("Phone numbers with an extension are not dialled") | R1 (`/[a-z]/i` rejects extensions); the rendered-link line is R6 of the pure-function line | partly (what, not why `—` → null) | no |

Counts: W2 1, W3 6; R1 7, R8 3, R6 2, R2 1. The markup is checked through a hand-rolled `visibleText` that collapses tags to `" | "`, so the test is stable against restyles but blind to structure (which element is a link, where the badge is). `html.includes('field-label">Email<')` is a class-name pin.

### 10. src/frontend/test/hooks/useFragmentJump.test.ts
135 lines, added 2026-10-17, 6 tests, 21 checks. DOM test over the real `MarkdownCardView`; captures `scrollIntoView` calls.

| example | W | R | why | weak |
|---|---|---|---|---|
| `/Weekly plan/Weekly plan` → no `<h1>`, last scrolled is `H2` "Weekly plan"; `/Weekly plan` → scrolled to the root | W3 (section-path search feature, 2026-10-17) | R1: the title-heading blank and the "title section = top" rule | yes (inline `//` notes) | no |
| `/install deps/Notes` → `data-line "17"` (the second Notes); markup heading → "Where things stand now"; `/install deps` → `"9"`; id `notes-1` → `"17"` | W3 | R1 ×4: repeat disambiguation by source line, fenced `#` not a heading, inline markup stripped, id fallback | yes | no |
| missing section → `data-missed "true"`, no scroll; then found → `["H2"]`, `"false"`; live edit → still `["H2"]`; clear then re-pick → `["H2","H2"]` | W3 (hook doc: "one attempt per fragment value") | R1 ×4 — the `attempted.key === key` branch and the `key === null` reset are exactly what a "re-jump on every render" edit breaks | yes | no |
| embedded root's headings are not the host's → `{kind:"pending"}` ×2 | W3 | R1 (ownership of headings under a nested fragment root) | partly | no |
| body opening with a blank line → `H2` "Status", not the root | W2-shaped (reads like a found bug: "not the top") | R1 | yes | no |
| edit adds the missing section → `"false"` and no scroll | W3 | R1 (the `attempted.missed` re-resolve branch) | yes | no |

Counts: W2 1, W3 5; R1 ~14 (all checks are branch-guards). No R5/R7/R8. Strongest branch coverage in the frontend sample; checks are small projections (`tagName`, `data-line`) which is appropriate for scroll targets. One nit: `Element.prototype.scrollIntoView` is patched globally and never restored.

### 11. src/frontend/test/lib/relative-time.test.ts
36 lines, added 2026-08-21, 3 tests, 4 checks. Source is 24 lines.

| example | W | R | why | weak |
|---|---|---|---|---|
| `[0, 10_000, 60_000, 180_000].map(formatElapsed)` → `"1 min / 1 min / 1 min / 3 min"` | W2 for the floor ("`0 min` reads as a bug"); context: "a stuck capture chip ... looked identical whether it failed ten seconds or three weeks ago" | R1 (`Math.max(1, min)`) | yes | no |
| hours/days → `"1 hr / 3 hr / 1 day / 2 days"` | W3 | R5/R8: restates `<60`, `<24` thresholds and the `day/days` literal; a rounding boundary (e.g. 89 min → "1 hr" or "2 hr") is not probed | no | no |
| `formatAgo` below 45 s → `"just now"` ×3; `"1 min ago / 3 hr ago / 16 days ago"` | W3 | R1 (the 45 s quiet zone — the comment gives the reason); the second line is R6 of the `formatElapsed` checks plus the literal " ago" | yes for 45 s | no |

Counts: W2 1, W3 2; R1 2, R5/R8 1, R6 1. Expected values are joined strings rather than arrays — the lint "no `JSON.stringify`" is skirted via `.join(" / ")`. Sibling `last-change-line.test.ts` also imports these functions.

### 12. src/frontend/test/components/chat.activity-wording.test.ts
404 lines, added 2026-10-09, 21 tests, 29 checks. Source `activity-wording.ts` is 360 lines of string mapping.

| example | W | R | why | weak |
|---|---|---|---|---|
| `summarizeActivity` ×5 → "thought it over, checked 2 things in your box, took a step", "made 2 changes, took 2 steps", ..., `[TodoWrite, TodoWrite]` → "working" | W3 (design: lay language, no tool vocabulary) | R8 ×4 (phrasing; a copy edit fails them) + R1 ×1 (TodoWrite excluded → "working") | partly (what each group is, not why the words) | no |
| card path → "Looked at Ana Reyes"/"Updated"/"Saved" | W3 | R1 for the title derivation (strip `.person.card`, `_` → space); R8 for verbs | partly | no |
| schema files → "Set up a place for your loans"/"Changed how your lending items are kept"/Read → generic; plural "inventories"/"boxes" | W3 | R1 ×2 (schema-path detection; plural rule `y→ies`, `x→xes`); R8 for the sentence | yes for the plural | no |
| documents: "Looked at Errands" etc.; Codex multi-file "and 2 more" | W3 | R1 (extension strip; `file_paths` count) | partly | no |
| other paths → generic lines ×4 | W3 | R1 (outside-`_content` detection; trailing-slash path) | yes | no |
| Bash: description capitalized, command never shown | W3, privacy-minded | R1/R3-lite: "the command text never is" — but only proved by absence of "rm -rf x" in the label, which is a whole-value check so it does hold | yes | no |
| "Everything else" ×8 and unknown MCP tool → "Took a step" | W3 | R8 ×7 wording; R1 for `nonsense` URL → "Read a web page" and for unknown-tool fallback | partly | no |
| searches: 8 Glob/Grep inputs → quoted-word vs generic vs "lending item cards"; detail excerpt `null` vs `{kind:"text", label:"Looked for", text:"due:\\s*2026"}` | W3 | R1 ×5: plain-word detection, `**/` and `*` trimming, type-card pattern, `.` is a wildcard in Grep but not Glob — real branches | yes | no |
| `.place` ×5 → "in recipes", "in Lemon Chicken", null ×3 | W3 | R1 ×3 (`.attach/` folder maps to its card; top of `_content` and `_config` have no place) | yes | no |
| `.opens` ×7 → `{path,name}` ×3, null ×4 | W3 | R1 ×4 (finished vs inProgress, Codex `status:"completed"`, read never opens, outside `_content` never opens) | yes | no |
| edit excerpt: `{kind:"change", before:"Bake at 350°", after:"Bake at 375°", everywhere:false}`; `replace_all` → `everywhere:true`; common-prefix/suffix line drop ×2; indentation kept; no result → all null; delete → `after:""`; whitespace-only → null; missing fields → null; non-string → null; long → `"a\nb\nc…"`, length 201, ends with "…"; error result → `failed:true, excerpt:null, opens:null`; "nothing plain" ×4 → null | W3 (several read as W2: "so an added line reads as an addition", "so the asked-for text does not read as done") | R1 ×~12 — the diff-trimming and failure-detection rules are the branch-dense part of the module. `long.after.length === 201` is a single-field projection (R1 but partial) | yes | no |

Counts: W3 ~20 (3 W2-flavoured); R1 ~30, R8 ~12 (the label literals). The excerpt/place/opens half is branch-guarding; the label half pins prose that a wording review would legitimately change. Twenty-one `test()` blocks for 29 checks; titles are truncated sentences.

### 13. src/frontend/test/components/MarkdownCardView.markdown-card-view.test.ts
265 lines, age unknown (pre-2026-10-18 doctest; conversion commit 53a66f57d), 14 tests, 33 checks. Mixed `renderToStaticMarkup` of `FrontmatterFields` and of the full `MarkdownCardView` inside a router + query client.

| example | W | R | why | weak |
|---|---|---|---|---|
| "line 24" (title is a leftover line marker): nested ref → `"\|Context\|Ref\|../Course.course.card\|Text\|Acids and bases\|"` and `<button` present | W3 | R1 (ref beside text keeps both rows) but R6 of the later "observation" test, which states the same rule with a reason | no (the test name is "line 24") | no |
| frontmatter todos → `"todos[0]:open todos[2]:done"` via a regex over `data-todo-status`/`data-todo-locator`; cells `"\|Todos\|Book the inspector\|due Sep 15\|Order lumber\|"` | W3 (todos-ui plan Track 2, cited) | R1 (agent-done entry omitted; locator form `{kind:"frontmatter", index}`); R2-ish: the `data-todo-*` attributes are a DOM contract other code reads | yes | no |
| plate state → "overdue · Sep 15" | W3 | R1; first line is R6 (identical to the previous test's cells check) | partly | no |
| invalid todos list and nested `meta.todos` keep generic rendering; no `data-todo-status` | W3 | R1 ×2 (validity gate; top-level-only) | yes | no |
| "Fields read as a person reads them" → `"\|Back by\|2026-10-20\|Lender\|Idris\| (lender)\|Quantity\|1 stove\| (missing lid)\|"` + `<button...>Idris</button>` | W3 (readable-fields test cited) | R1 for name-with-role and value-with-note; R6 of `readable-fields.test.ts` and of PersonView's "Day job" check | yes | no |
| observation `{text, ref}` → both rows; `{value, unit}` → both rows | W3 | R1 (which small-object shapes collapse to one value, which do not) | yes | no |
| URL text → `<a href=...>` | W3 | R1 | yes | no |
| repeated title heading hidden: no `<h1`, body present, `data-todo-locator="8"` | W3 (leading-title-heading lint cited); the locator line is W2-shaped ("blanked rather than removed, so a todo further down keeps the locator") | R1 ×2; the locator check guards the "blank, don't delete" decision — a cleanup that removes the line shifts it to 7 | yes | no |
| different first heading stays → `Day one</h1>` | W3 | R1 (the complement branch) | partly | no |
| empty-bodied record → fields section present, "Tray 3", no "No body content" | W3 | R1 (`bodyEmpty` path) | yes | no |
| front with `name:` → `"\|Location\|With Idris\|Quantity\|1 stove\|"`; `title:` + `name:` → `"\|Name\|Camp stove\|..."`; name only → `null` | W3 | R1 ×3 | yes | no |
| with a body, fields stay in Properties (three `includes`/`not(includes)`) | W3 | R1 (complement of the empty-body case) | yes | no |
| embed → `sectionOrder` `["heading","body","frontmatter"]`, "Solder<" appears once (regex), detail line, body | W3 (place-shows-cards plan Track B) | R1/R8: section ORDER is a design choice (R8) but "title shows once" is a rule (R1) | yes | no |
| page → `sectionOrder` `["body"]` | W3 | R6/R8 of the embed test | partly | no |

Counts: W2 1, W3 13; R1 ~20, R6 4, R8 2, R2 1. Checks are substring/regex projections over static markup; `cells()` collapses tags so a restyle survives, but five tests build the same router+query-client scaffold by hand (`renderCard`, `renderRecord`, `renderEmbed`, `renderFront` are copies). The four render helpers are placed between their doc comments and the tests that use them, so comments and tests are separated by 40–80 lines.

---

## hub (2 files)

### 14. test/hub/health.test.ts
84 lines, added 2026-07-19 (originally inside the plan doc `(pre-rename package)/docs/plans/hub-healthz-box-aggregation.md`), 4 tests, 4 checks. Source `src/hub/health.ts` is 63 lines, two functions.

| example | W | R | why | weak |
|---|---|---|---|---|
| `{running:false, stopped:false}` | W2 (file header: "the 2026-07-16 better-sqlite3 ABI incident: every child crash-looping, `/healthz` green") | R1 (stopped is not broken — the lazy-hub rule) | yes | no |
| `{unhealthy:true, firstBoot:false, crashLooping:true}` | W3/W2 | R1 (`consecutiveFailures > 0` on `starting`) | yes | no |
| `restarts:47, consecutiveFailures:0` → `false` | W2-shaped ("The trap: ... would pin the hub red forever") | R1: the one check that fails if someone "improves" the verdict by consulting `restarts` | yes | no |
| `{empty:"ok", allIdle:"ok", oneBroken:"unhealthy"}` | W3 | R1 for `some()`; `empty:"ok"` is R5 | yes | no |

Counts: W2 2, W3 2; R1 4 (one R5 sub-field). Sibling `server.router.test.ts` serves an `unhealthy` box as 503 — that is a different claim (HTTP mapping), not R6. Model file: small pure function, named incident, each branch once, keyed objects so a failure names the case.

### 15. test/hub/server.auth.test.ts
397 lines, added 2026-07-04 (as `hub-server-auth.doctest.md`), 1 test wrapping 5 helper functions, 19 checks. Real listening hub + fake upstream box over `fetch` (an exception to "no server spin-up", justified by the proxy being the thing under test).

| example | W | R | why | weak |
|---|---|---|---|---|
| unauth HTML nav → 302 `/auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card` | W3 (Track D chunk D2) | R3 + R2 (`returnTo` format the login page parses) | partly | no |
| mobile bearer → proxied, `{status:200, url:"/test1/chat?nativeComposer=1", email:null, secret:null}` | W3 | R3/R2 (the iOS app's bearer path; `secret:null` says the hub does not stamp its secret on a device-authed request — the box re-verifies) | partly: why `secret:null` is not explained here | no |
| agent token → 200 with no identity; wrong 64-zero token → 401 | W3 | R3 ×2 | yes | no |
| six refused combinations → all `401` via `checkText` table (bogus bearer, forged `bbx_mobile` cookie, unknown slug ...) | W2: "The hub's mobile gate used to be presence-only ... (known risk S1)" | R3 ×6, with the enumeration rule (real vs unknown slug answer identically) being the non-obvious one; the other rows are R6 of each other | yes | no |
| real `bbx_mobile` cookie → 200 | W3 ("the credential a WebSocket upgrade carries") | R3 | yes | no |
| `/api/boxes` without auth → `{boxes:[], authRequired:true}`; with mobile bearer → `{boxes:[{slug:"test1", name:"test1", symbol:null}]}` | W3 | R2 (iOS discovery payload) + R3 | partly | no |
| unauth pairing redeem proxied with no identity | W3 | R3 (the one anonymous API path) — pairs with `isPairingRedeemUrl` in file 1 | yes | no |
| session cookie → `{email:"person@example.com", secret:"test-hub-secret-for-auth-test"}` on the upstream request | W3 | R2/R3 (the header contract `x-bbx-authenticated-email` + `x-bbx-hub-secret` that `resolveRequestIdentity` in the box trusts) | partly | no |
| `/healthz` no key → 401, with diag key → 200 | W3 | R3 ("401 from the gate, NOT a 302 to /auth/login") | yes | no |
| `/webhook/test1/incoming` → 302 login | W2-shaped ("has no anonymous passthrough ... cannot wake a box") | R3 | yes | no |
| raw WS upgrade unauth → exact `"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"`; same for `/webhook/.../ws` | W3 | R3 ×2 (second is R6-ish); the exact raw bytes are R2 for the client (`ws` library) and R8 for the header set | partly | no |
| gen-revocation: cookie minted at gen 1 → 200; after `setPassword` → 302 | W2 ("FIX 1 ... `decideHubAuth` no longer trusts an HMAC-valid-but-revoked cookie") | R3 | yes | no |

Counts: W2 3, W3 9; R3 ~17, R2 4, R6 ~6, R8 1. All 19 checks are in one `test()` with one teardown, so a failure early (e.g. the first 302) hides the rest. The single-field checks (`t.check(navResponse.status, 302)` then `t.check(headers.get("location"), ...)`) are doctest-conversion residue; the later objects (`{status, url, email, secret}`) are the better form.

---

## cli (3 files)

### 16. test/cli/commands/pairing.test.ts
101 lines, added 2026-09-26, 2 tests, 4 checks. Source `src/cli/commands/pairing.ts` is 60 lines: label check → refusal check → pair.

| example | W | R | why | weak |
|---|---|---|---|---|
| dev box → `Paired fake device "dev phone" (<id>) with a sandbox APNs token. Unpair it from Settings like any phone.` / `exit 0` | W3 | R2-lite (CLI text an operator reads) and R8 (exact wording) | partly | no |
| device: `["dev phone", null, "sandbox", true]` (label, createdBy, environment, token prefix) | W3 | R1 ×2: `createdBy:null` (owner-only visibility, see file 6) and `environment:"sandbox"`; `startsWith("fake-")` is a boolean projection the lint discourages | yes | no |
| APNs keys set → `Refused: APNs keys are configured ...` exit 1; `BBX_NOTIFY_FAKE=1` → pairs | W3 (safety rule "a push to the fake token would go to Apple") | R3-lite/R1: the refusal branch and its env override | yes | no |
| production phone registered → `Refused: this box has a phone registered for production APNs ("Jamie's iPhone")`; blank label → `Error: a label is required` exit 2 | W3 | R1 ×2; exit codes 1 vs 2 are R2 for scripts | yes for refusal, no for the exit-2 rule | no |

Counts: W3 4; R1 5, R8 2, R2 1. Every branch of the 60-line source is hit once. Output goes through `console.log` capture with an id-regex scrub — the command returns an exit code but prints via `console`, so the test has to intercept globals.

### 17. test/cli/entry.surface.test.ts
128 lines, added 2026-09-16, 7 tests, 13 checks. Not a behaviour test: a consistency gate between `SURFACE` (a data table), `VERB_COMMANDS` (the registry), the built commander program, and generated docs.

| example | W | R | why | weak |
|---|---|---|---|---|
| `unclassified` → `[]`, `unregistered` → `[]` | W1: the table was introduced so that "a classification is only worth having if it cannot silently rot" | R1/R4-like: a new verb registered without a `SURFACE` entry fails; a "would vanish from the CLI rather than announce itself" comment explains why a test is needed where a type cannot help | yes | no |
| `topLevel` minus `engine` → `agentNames`; `engineVerbs` → `engineNames` | W1 | R1 (partition) | yes | no |
| `leaked` → `[]` | W2-shaped ("exactly how operator commands kept landing on the agent's surface in the first place") | R1; partly R6 of the partition check (if top-level equals agentNames, nothing engine-only can be at top level) | yes | no |
| `splitNames` → `["pub","scheduler","secrets"]`; `overlapping` → `[]` | W3 | R1 for overlap; the split list is R8 (it must be edited whenever a family is split — the test documents the current choice) | yes | no |
| scheduler subcommands `["log","status"]` and `["install","start","uninstall"]` | W3 | R8/R6: a literal copy of the table; the comment ("that is how the deprecated add/remove/list aliases left") makes it a regression anchor for one dropped alias set | yes | no |
| `reasonless`, `emptySmoke`, `misaimedSmoke` → `[]` | W3 | R1 ×3: lints on the table that the type system cannot express (non-empty string; `smoke.run[0] === name`) | yes | no |
| `taughtButEvicted` → `[]` | W2 ("Before this split it described `bbx scheduler install` and a dead `bbx scenario`") | R1 (docs vs surface) | yes | no |

Counts: W1 3, W2 2, W3 2; R1 10, R8 2, R6 1. Expected values are nearly all `[]` — the "empty list of violations" form, which makes the failure message name the offending verb. It would still pass against a `SURFACE` that is empty AND a registry that is empty, but not against either alone.

### 18. test/cli/commands/tick.defer.test.ts
240 lines, added 2026-09-26, 4 tests, 18 checks. Runs the real `runTick` against a tmp git box with shell `runs:` scripts.

| example | W | R | why | weak |
|---|---|---|---|---|
| defer with marker → `"skipped \| deferred no-change failures=0 \| card kept"`; `lastError` → `"no-change: nothing to do"`; health → `"ok: no-change (nothing to do)"` | W3 (notifications plan Track D, cited) | R1 ×3: exit 75 + marker is `deferred` not `failure`; `once` does not delete on defer; health maps `no-change` to ok. `lastError` holding a non-error string is pinned as-is (R8) | yes | no |
| `no-pass` → cursor at HEAD; `budget` → `"cursor held"` | W3 | R1 ×2 (the reason-dependent cursor rule: "seen and judged" moves, "held back" holds) | yes | no |
| bare exit 75 → `"error \| failure null failures=1 \| card kept"`, cursor held | W3 ("any command may exit 75") | R1: a later "treat 75 as skip" edit flips it | yes | no |
| success → `"ran \| success null failures=0 \| card deleted"` | W3 | R1 (`once` deletes only on success) | yes | no |
| real `bbx changes --or-skip \| bbx judge --or-skip` → deferred no-change; no `jev-debug.log` | W3 | R1/R2: the real pipeline writes the marker (`$BBX_DEFER_FILE` contract between `bbx changes` and the tick); "no judge call" is proved by a file's absence — a side-channel check | yes | partly: "no judge call" passes if the debug log path moved |
| `bbx procedure run look`/`bare` → deferred no-change; `_tmp/ran` absent | W3 | R1 ×2 (`procedure run` exits 75 and forwards the inner marker; a markerless precheck skip records `no-change`) | yes | no |
| on-wakeup: `ran` → 1; only `waits` card remains; `"deferred no-change 0"`; `git log -1` → `"Wakeup: remove one-shot done"` with clean status | W3 | R1 ×2 (same path as tick; delete only after success), R4 (commit subject + clean tree is an on-disk contract for the box's history) | yes | no |

Counts: W3 7; R1 ~13, R2 1, R4 1, R8 1. Dense, every check guards a rule stated in the file header, and the `tick()` helper's one-line projection (`status | lastResult lastDeferReason failures | card kept/deleted`) makes each case a single readable literal. Costs: real git, real shell, real `bbx` subprocesses (`execSync("rm ...")`, nested `bbx changes | bbx judge`), so it is slow and environment-sensitive (`BBX_ENGINE_AVAILABILITY_FILE` points at `/nonexistent`).

---

## Overall tallies (18 files, ~330 checks grouped into ~130 examples)

Axis W (per example group):
- W1 forced a boundary: 5 (auth.required openAccess seam; entry.surface ×3; health.ts is W1 by its own source comment — "kept separate ... so it's unit-testable")
- W2 pinned a bug: ~22 (namespace-fence ×4, hub auth ×3, auth.required ×2, health ×2, place-owners, send-fast-ack, api dirty-delete, invite corrupt-store, device-scope machine credential, relative-time floor, PersonView extension, fragment blank-line, entry.surface ×2, MarkdownCardView locator)
- W3 contract being built: ~95 (the large majority; most cite a plan doc or a design statement)
- W4 exploration that found nothing: 0 visible — nothing in the sample reads as "tried inputs, kept them all", except the hours/days line in relative-time and the "Everything else" list in activity-wording
- W5 unclear: 2 (pairing.test.ts matcher; MarkdownCardView "line 24")

Axis R (primary label per check, approximate):
- R1 branch/rule: ~135 (frontend and cli dominate: useFragmentJump, activity-wording, MarkdownCardView, tick.defer, entry.surface, health)
- R2 cross-system contract: ~15 (hub auth headers and `/api/boxes`; `/auth/me` `{open:true}`; keepalive; `data-todo-*` attributes; `$BBX_DEFER_FILE`; exit codes)
- R3 trust boundary: ~70 (auth.required, invite-accept, device-scope, namespace-fence, hub auth — the webapp/hub sample is mostly R3)
- R4 on-disk/migration: 3 (root `dirs` literal; delete commits; wakeup commit)
- R5 restates straight-line code: ~6 (`assertOpenAccessNotListening({}) → undefined` ×2; `hubVerdict([]) → "ok"`; relative-time hours/days; `resolveMobileBearerIdentity` null; the `files.kind` 200)
- R6 second proof: ~30, concentrated in namespace-fence (per-route fan-out of one resolver), hub auth (six 401 rows), invite-accept (two corrupt-store cases), PersonView/MarkdownCardView/readable-fields (name-with-role rule proved three times)
- R7 fake/framework/type: ~5 (`typeof last-modified === "string"`; ETag 304 plumbing; tRPC error envelope `code:-32003`)
- R8 pins a choice: ~35 (activity-wording labels ~12; namespace-fence messages ~8; log-line literals in invite-accept ×3; PersonView row order/labels; CLI output wording; section order)

Why-comment: yes ~75%, partly ~20%, no ~5% (pairing.test.ts, "line 24", `undefined` guard checks, relative-time hours/days). The newer files (Sept–Oct) are consistently better at this than the March–July ones.

Weak tests (pass against a no-op or obvious wrong code): rare. Found: the two `→ undefined` checks in auth.required; `st.ok(device); if (!device) return;` in pairing.test.ts; `gate.entered` never awaited in send-fast-ack (the ack-before-start ordering is shown only by `runs=0`, which also holds for a route that never starts a run); `typeof ... === "string"` in api.test.ts; "no judge call" by log-file absence in tick.defer.

## Observations

1. Route tests in this sample are mostly trust-boundary guards (R3), not handler restatements. auth.required, invite-accept, device-scope, namespace-fence and hub auth are ~70 R3 checks; R5 is almost absent in route files. The repetition that does exist is per-route fan-out of one rule (namespace-fence: ~20 checks reduce to "every route calls `resolveBoxNamespacePath`"; hub auth: six 401 rows). The files justify the fan-out in their headers ("the bug was that routes diverged"), so it is deliberate R6, not accidental.

2. Auth-gate checks are not repeated per router in the sample. "Owner access required" appears in 2 test files; "Not authenticated" in 10 (of ~400). auth.required covers the three procedure tiers once each; the sibling router files (`trpc/routers/*.test.ts`) were not sampled, so this is a weak negative.

3. Frontend markup tests avoid R8 more than expected. PersonView and MarkdownCardView strip tags to `|`-separated cell text or count `data-card-section` markers, so restyles do not break them; what they pin is row presence/absence and small-object collapsing (R1). The R8 exposure is in class-name substrings (`field-label">Email<`), section ORDER, and the chat activity labels — activity-wording has ~12 checks that fail on a copy edit, which is arguably the intent (the words are the feature) but the comments say what the words are, not why those words.

4. The strongest files share a shape: a small pure function or a single rule, a named incident or plan, one check per branch with a keyed object or array so the failure names the case (health.test.ts, place-owners, useFragmentJump, tick.defer, entry.surface). The weakest share the opposite: a long single `test()` with 15–26 checks where the first failure hides the rest (hub auth: 19 in one test; invite-accept test 1: 14; namespace-fence test 1: 26).

5. Doctest-conversion residue is visible in ~half the files: truncated prose test titles ("An openAccess:", "runs:", "line 24"), blank lines between consecutive single-field `t.check(res.statusCode, 200)` lines, helpers placed between a comment and the test it describes. The whole-value form the docs ask for is used in the newer checks (`{status, url, email, secret}`) and skirted in older ones (`"200 | turn=string | recorded=1"` strings; `.join(" / ")`; `checkText` with `«*»` that skips most of a JSON body).

6. Where a boundary was not forced, the tests pay for it: auth.required and invite-accept set and restore six `BBX_*` env vars in teardowns because `auth.ts` reads `process.env`; send-fast-ack monkey-patches `ChatSession.prototype.startRun` with a "move this gate if it's gone" guard; the CLI pairing test intercepts `console.log`. The W1 cases that did force a seam (`openAccess` construction option, `isBoxBroken` extracted from the supervisor, `SURFACE` table) produced the cleanest tests.

7. W4 (exploration that found nothing) is essentially absent as a labelled category, but a few lists look like it: relative-time's hours/days line, activity-wording's "Everything else" eight-item list, the six 401 rows. None states a reason per row, which is the docs' own test for keeping an exploratory case.

8. Bug pins (W2) carry the best why-comments and the most specific R1 claims: "restarts would pin the hub red forever", "an earlier version cleared the entry in the effect cleanup (e22c56ead)", "the fix for the old substring match", "presence-only gate (known risk S1)". These are the examples a note can cite as the form to copy.
