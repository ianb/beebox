---
title: "Shared browser: the agent asks in the Browser tab, and the answer returns to chat"
status: draft
workstream: shared-browser
issues: []
---
# Shared browser: asking the person in the Browser tab

The agent often needs the person to do a step in the box browser, such as a captcha. Today the person finds the menu item, does the step, returns to chat, and types "done". This plan puts the question and the answer in the Browser tab. The answer arrives in the chat as a message from the person.

**Parent plan:** [shared-browser.md](shared-browser.md). That plan's NOT-in-scope line "A beebox viewer, input arbitration, a handoff command: ruled out by the boxholder" changes here: the boxholder asked for this flow on 2026-10-30 ("a URL, a question, a response (optional text, 'done', maybe 'not done' or something), and it gets routed back to the chat"). A beebox viewer and input arbitration stay out.

**Issues addressed:** none filed. Searched the queue for `captcha`, `handoff`, `browser`: `issues/features/2026-06-12-agent-browser-scoped-to-box.md` and `issues/exploration/2026-10-29-shared-browser-site-probe.md` are related and stay open.

## Design

### Situations

- When Priya asks the box to compare dishwasher prices and one shop shows "verify you are human", she wants the link in chat to open the page with the question beside it, so she does not have to find a menu item.
- When Priya has finished the check, she wants to press Done in that same tab, so the agent continues and she can watch it without going back to chat.
- When the check keeps failing, Priya wants to press Not done and say "it keeps looping", so the agent changes its approach and does not assume success.
- When Priya left the Browser tab open from earlier, she wants a new question to appear there, so a stale tab does not hide the request.
- When Priya is in the car on her phone, she does not want this: the link waits in chat until she is at a computer.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Agent needs a step | Show: agent's chat reply with a link | Chat | Waits to be found |
| Person opens the tab | Show the question | Bar at the top of the Browser page | Foreground, in a tab the person chose to open |
| Tab already open | Show the question within seconds | Same bar | Waits to be found; no sound or focus change |
| Person answers | Act: send one chat message | Chat history; bar clears; tab stays | Agent wakes; nothing else interrupts |
| Nothing is waiting | Quiet | No bar | None |

### Spirit

- **Serves:** "Feedback is everywhere, and it's not all commands": the answer has an open text box, and the person's words reach the chat unchanged.
- **Serves:** "You should be able to see the gears": the tab stays open after the answer, so the person watches the agent continue, and the answer is an ordinary message in the chat's history.
- **Risks:** "It should feel like a place": a bar over a developer dashboard still looks like a tool. Guard: the bar is plain and small, and restyling the dashboard stays out of scope.

### Trust

The agent's question starts and stays at the **question** rung. Nothing is automatic: only the person's click sends an answer, and the agent cannot press it (the person gate refuses the agent bearer). Rules on acting in an account do not change.

### When it goes wrong or does nothing

- **Answer cannot be sent:** the bar keeps the question and the typed text and shows the reason. The person can press again.
- **The chat was deleted:** the bar says so and clears, and the typed text stays visible so the person can copy it.
- **The same chat asked again while the bar was open:** the press sends nothing. The bar says the question changed and shows the new one.
- **Two chats ask at once:** the bar shows both, each with its own buttons. An old question stays until it is answered; Not done clears it.
- **The browser idled out while the question waited:** opening the page reopens the page the agent was on. The check may start again, which is the site's choice.
- **Someone types a password in the box:** the placeholder says the text goes to the chat, and passwords belong in the page.

### Walkthrough

1. The agent reaches a check on shop.com and runs `bbx browser ask "Solve the check on shop.com, then press Done."`.
2. The box saves the question, the chat, and the page's URL. The command prints the link text `[Open the browser](box-browser:)`.
3. The agent writes that link in its reply and ends its turn.
4. Priya clicks the link. A new tab opens at the Browser page. The bar shows the question.
5. Priya solves the check and presses Done.
6. The chat receives `Done` from Priya. The agent wakes, takes a new snapshot, and continues. The bar is gone. Priya watches or closes the tab.

## Smallest fix and budget

Smallest fix: a link in chat, no bar. It solves only half the boxholder's request, because the person still returns to chat.

Chosen design: one track. Estimate: about 350 lines of source, including the bar's script, and about 300 lines of tests. Docs and agent guidance: about 40 lines.

## Stated preferences this plan trades against

- **`docs/engineering-principles.md` 6 (right-sized defensiveness):** the parent plan cites it for "no arbitration, no handoff state machine". This plan keeps one small saved record with no states: it exists or it does not.
- **Parent plan's decision against a handoff command:** reversed by the boxholder's request, quoted above.
- **`docs/architecture/spirit.md`, open-ended input:** Done and Not done are buttons, which is a structured reply. The text box keeps it open.

## What already exists

- **Send path, reuse:** `src/webapp/chat-runtime.ts:81` `resolveSendTarget` and `:83` `sendUserMessage`, documented *"The send route's delivery, shared so one message id posts once on either path."* `getChatRuntime(boxRoot)` at `:97`. Quick chat uses them from outside a route (`src/webapp/trpc/quick-chat-delivery.ts`), including the mapping from a 410 or 404 to "gone".
- **Sender identity, reuse:** `src/webapp/routes/chat/send-routes.ts:84-88` resolves `resolveBoxIdentity`, then `resolveMobileSender`.
- **Framing, reuse:** `src/webapp/trpc/quick-chat-delivery.ts`: `<typed source="box-screen">…</typed>`. `src/frontend/src/components/chat/message-parsing.ts:52` strips `<typed[^>]*>`, so a new `source` value shows clean.
- **Person gate, reuse:** `src/webapp/routes/browser/proxy/person-gate.ts` `checkPerson`, a `preHandler` in the proxy scope (`route.ts`), refuses the agent bearer and other origins.
- **Injected banner, model:** `src/webapp/routes/browser/proxy/response.ts` `withNotice` inserts into the body. `BROWSER_PAGE_CSP` allows `script-src 'self' 'unsafe-inline'`, `connect-src 'self'`.
- **Capped body read, reuse:** `readCapped` in `route.ts`. The scope has no body parser.
- **Agent route and CLI, model:** `src/webapp/routes/browser/exec-route.ts` (agent bearer only), `src/cli/commands/browser/command.ts` `browserExec`.
- **Chat id, reuse:** `src/core/chat/session/id-file.ts` `resolveChatSessionId`, *"Returns null when no session context is present"*.
- **Link classification, extend:** `src/frontend/src/lib/view-url.ts` `classifyMarkdownHref`. A root-absolute path is a box file (*"`/_content/x.card`"*), so `/<slug>/browser/` in chat would open as a file. The `control:` scheme is the precedent for a link at app chrome.
- **Rejected reuse: question cards** (`docs/questions.md`). They are for durable decisions with learning, in a queue. This is a live step in one conversation. **Rejected reuse: `pending-browser-request.ts`.** It parks a CLI long-poll against a browser tab; here the agent ends its turn and may wait for days.

## Prior art (external)

No decision depends on an external premise. The parent plan's research (Cloudflare Browser Run handoff, OpenAI takeover) is evaluated-only and is not used here.

## Ontology

- **Browser question** (new): a saved request for the person in a box's browser. Fields: `id` (UUID), `question`, `sessionId`, `pageUrl` (string or null), `askedAt`. Stored in a list at `<browser root>/questions.json` (`BrowserPaths.root`). A chat has zero or one: a new ask from the same chat replaces its own. It is NOT a question card and NOT a chat message.
- **Question bar** (new): the strip on the Browser page that shows the waiting browser questions. It is NOT a beebox viewer: the dashboard below it does not change.
- **Answer** (new): `{ id, outcome: "done" | "not-done", text? }`, posted by the bar. It becomes one chat message.
- **`box-browser:`** (new): a markdown link target for the box's Browser page. It needs no slug or prefix, so it works in dev and production.
- Existing names used unchanged: **chat session**, **person gate**, **exec route**, **browser host**.

## Tracks / scope

### Track A: ask, show, answer

- **What:** the command, the saved record, the bar, the answer route, the chat link, the guidance.
- **Why this needs to change:** the boxholder reports this round trip "comes up often", and each one spans a menu, a tab, and a chat.
- **Direction:**
  - `src/core/browser/question.ts`: `askBrowserQuestion`, `readBrowserQuestions`, `claimBrowserQuestion(root, id)`, `restoreBrowserQuestion`. Synchronous atomic write (`writeFileAtomicSync`), zod on read; a corrupt file reads as none, with a warning. The engine is one process, so a synchronous read-and-write cannot interleave with another request. Pure `answerMessage({ outcome, text })` gives `<typed source="browser-tab">Done</typed>`, `Done: <text>`, `Not done`, or `Not done: <text>`.
  - `POST /api/browser/ask` in `exec-route.ts`, agent bearer only. Body `{ question, sessionId }`; question 1 to 2000 characters. It calls `ensureHost`, reads `get url`, saves. `pageUrl` is kept only for `http:` or `https:`. A failure to reach the browser is reported and nothing is saved. The reply says whether this chat's earlier question was replaced.
  - `bbx browser ask "<question>"`, handled in `browserCommand` before `browserExec`. It uses `resolveChatSessionId`. With no chat it exits 1: "bbx browser ask needs a chat to send the answer to". It prints the link text and what to do next.
  - Proxy scope, behind the person gate: `GET /browser/_box/question` returns `{ questions: [{ id, text }] }`. `POST /browser/_box/answer` reads a body capped at 8 KB and checks it with zod. It claims the question first: a synchronous remove, so of two presses one wins and the other gets 409 with no message. It then resolves the target with `exactSession: true` and sends with `messageId` set to the question id. A 404 or 410 target (as `quick-chat-delivery.ts` maps them) gives 410 and the question stays removed. Any other failure restores the question, unless that chat has asked a newer one, and gives 502. `_box` cannot collide with the dashboard's paths, which are `/_next`, `/api`, and pages at the root.
  - `src/webapp/routes/browser/proxy/question-bar.ts`: `withQuestionBar(html)` injects the bar's markup and inline script on the top page. The script uses relative URLs, sets all text with `textContent`, polls `_box/question` every 3 seconds while the page is visible, and fetches once on `visibilitychange`. It stops `keydown`, `keyup`, and `paste` from leaving the bar, so typing in the box cannot reach the page in the dashboard. It keeps typed text across polls. An unchanged list does not redraw.
  - Page restore: on `GET` of the top page, when `get url` answers `about:blank` and a question has a `pageUrl`, the route sends `open` with the newest such URL.
  - `classifyMarkdownHref` gets `box-browser:`, before the generic scheme test. `Link` renders an anchor to `withBase("/<slug>/browser/")` with `target="_blank"`.
  - Guidance: `BROWSER_SKILL` "When the person must act" uses `bbx browser ask`. A person who says done in chat is still an answer. `BROWSER_USAGE` lists the command. The `browser-login-needed` audit's `correct_contains_any` gains `bbx browser ask`.
- **Vocabulary lock-ins:** `bbx browser ask`, `box-browser:`, `/browser/_box/*`, `source="browser-tab"`.
- **First implementation chunk:** `question.ts` and its tests, with the route and CLI for `ask`. No open questions.

## Could this be simpler?

- **One question per box, replaced by the next.** A review showed it strands the first chat: its link opens another chat's question. One per chat costs a list in the file and in the bar.
- **Question text in the URL, no saved record.** It removes the file. It fails three ways: a menu-opened tab or an already open tab shows nothing, which is one of the situations; anyone who can get a link in front of the person can show a fake question; and the page URL for restore has nowhere to live.
- **No polling, bar loads only with the page.** It fails the "tab already open" situation. The boxholder's own habit is a tab that stays open.
- **No page restore.** It saves about 15 lines. The person then meets a blank page and a question about a page that is gone, after a 30-minute idle (`AGENT_BROWSER_IDLE_TIMEOUT_MS: "1800000"`, `host-process/agent-browser.ts:62`). Principle 4: resilient and never silent. Kept.
- **A printed absolute URL, no `box-browser:` link.** A public URL exists in production but not under the dev router's outer prefix, which the agent's CLI cannot know. The link scheme is smaller than teaching the CLI that.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two tabs press Done and Not done together | Route test: two posts, one message, the loser gets 409 | Claim before send | Clear |
| Agent is mid-turn when the answer arrives | Route test with a busy session | `sendUserMessage` queues; the claim stands on `queued` | Clear |
| Chat deleted (404 or 410 from the target) | Route test for each | 410, question removed, bar says so and keeps the text | Clear |
| Send fails | Route test | 502, question restored, bar keeps text | Clear |
| Server dies between claim and send | None | Question is lost; the person answers in chat | Accepted: narrow window, and chat still works |
| The agent's active tab is not the page it means | None | The skill says to show the page before asking | Quiet; the person sees the tab and can answer Not done |
| Same chat asks again while the bar shows it | Route test: stale id gets 409, no message | Bar shows the new question | Clear |
| A second chat asks | Route test: both listed, each answer reaches its own chat | One question per chat | Clear |
| Old questions build up | None | Not done clears one; the list scrolls | Clear: visible on the bar |
| Keystrokes in the box reach the remote page | Real-browser test: type in the bar on the served page, and a page-level listener and the real dashboard see nothing | Bar stops key events | Silent if broken, so tested |
| Page text in a question injects markup | Pure/DOM test with `<img onerror>` text | `textContent` only | Clear |
| Bar breaks the dashboard's layout or click mapping | Real-browser check: click lands on the aimed element with the bar shown | Decided in chunk 3 by measurement: in flow if the dashboard resizes, else a fixed bar with the dashboard offset | Silent if broken, so tested |
| Agent bearer posts an answer to itself | Route test: 403 | Person gate | Clear |
| Cross-site page posts an answer | Route test: other `Origin` gets 403 | Person gate | Clear |
| Corrupt `questions.json` | Unit test | Reads as none, warning logged; next ask overwrites | Clear in the log |
| Restore overwrites a page the person is using | Route test: runs only when `get url` is `about:blank` | Guard | Clear |
| Scheduled run with no chat | CLI test | Exit 1 with the reason | Clear |
| `box-browser:` removed by markdown sanitizing | Frontend test through the real renderer | `control:` shows schemes pass; confirmed by test | Clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong tool:** the agent asks in chat without `ask`. ADDRESSED: the person's chat reply still works, and the menu item still opens the browser.
- **Stale ref:** refs are stale after the person acts. ADDRESSED: the skill already says to run `snapshot -i` again.
- **Two agents:** ADDRESSED in Failure modes: one question per chat.
- **Hand-edit drift:** no hand-edited file. `questions.json` is in the state directory.
- **Fabricated value:** the agent cannot fabricate an answer: the answer route refuses it.
- **Validation error UX:** ADDRESSED: empty or over-long questions exit 1 with the limit named.
- **Agent keeps working after asking:** ADDRESSED: the skill says end the turn. The answer queues if it does not.
- **Person answers in chat and leaves the question up:** DEFERRED: the bar stays until the next ask or a press. A press then sends a redundant "Done". See Open design questions.
- **Partial rollout:** no data shape changes; a deploy with an old tab open just lacks the bar until reload.

## NOT in scope

- **Push notification when asking:** the parent plan decided the chat reply is the signal. The boxholder did not ask to change it.
- **Keeping the browser alive while a question waits:** restore covers it with less machinery.
- **Headed Chrome, Camoufox, and the stealth policy:** a separate decision, measured through the site probe.
- **Questions from scheduled runs:** no chat to return to. Needs a destination decision.
- **A history page:** the chat holds the history.
- **An explicit URL on `ask`:** the saved URL is the active tab's, which is also what the person sees. A review proposed `--url`; the skill's instruction covers the case at less cost.
- **The iOS app's markdown renderer:** the Browser page is for a computer. Verified in chunk 4 only that the web chat renders the link.

## Open design questions

- Should the agent be able to withdraw a question, for when the person answered in chat? Lean: no command for now. The chat's next `ask` replaces it, and a redundant Done is harmless. Revisit after use.

## Knowledge audits

`browser-login-needed` is updated to expect `bbx browser ask` and is re-run on `~/src/boxes/test1`, with the status comment recorded.

## What will hold this after it ships

- Route tests in `test/webapp/routes/browser/proxy/route.test.ts` run the real server with the fake dashboard and a fake chat runtime; they reach every branch of the answer route.
- `answerMessage` and the record functions are pure enough for unit tests.
- A real-browser test types in the bar and asserts that a page-level listener sees no key. Click mapping and key isolation against the real dashboard are confirmed once through `bin/browse`, because that needs a live browser host.
- No new test tier.

## Implementation order

1. `question.ts`, `POST /api/browser/ask`, `bbx browser ask`, tests.
2. `_box/question` and `_box/answer` routes, tests.
3. Question bar, page restore, real-browser check of layout, clicks, and keys.
4. `box-browser:` link, guidance, audit, parent plan note.
5. Full loop on `test1` in the dev router: real agent, real link, Done and Not done. One labeled exhibit.

## Rollout shape

Done when the route, CLI, frontend-link, and e2e tests pass, the audit is run, and the full loop works on a real chat. No migration. No new production setup. It ships with the parent workstream's landing, only when the boxholder says so.
