# Sources (gathered 2026-10-08)

Everything public that was read for this corpus, with what each source gave.
No waitlist access was available; nothing here comes from hands-on use.

## Imbue's own material

| Source | Date | What it gave |
|---|---|---|
| [Introducing Imbue Studio](https://imbue.com/blog/studio-announce) (Josh Albrecht) | 2026-10-01 | The feature claims: personal tools from calendar/email/Slack, share by link, remix, shared studios, create from screenshot/sketch/URL, drag apps to the desktop, phone home screen, right-click to change, self-modification, model switching, Imbue Cloud or own machine, backups and export, "all of the base code for a studio is open source", end-to-end encryption, zero access by default, sandbox. Waitlist: a Typeform. No repo link. |
| [Studio product page](https://imbue.com/product/studio) | 2026-10 | "Reimagine your *personal* computer. Customize your software to do your life's work. Build your own digital HQ and share your tools." Tags: macOS, open source, personal software. Nothing else. |
| [Products page](https://imbue.com/products) | 2026-10 | Studio is the only product tagged "Personal software"; the other eight are coding-agent tools, Bouncer (feed filter), and Latchkey. |
| [It's time for Personal Computing 2.0](https://imbue.com/blog/it-s-time-for-personal-computing-2-0) (Albrecht; also on [Substack](https://ideas.imbue.com/p/personal-computing-20)) | 2026-10-01 | The manifesto. "Your data is yours" as the root principle; multi-vendor, scriptable, runs on any hardware "a laptop, an old desktop, a Raspberry Pi, an old Xbox, or a rented cloud machine"; open-weight models driving closed agents; "instantly migrate between any of these providers". No architecture, no business model. Does not name Studio. |
| [A more radical Imbue](https://ideas.imbue.com/p/a-more-radical-imbue) (Albrecht) | 2026-01-30 | After Sculptor shipped the founders "forgot why we were here"; the company reorganized into many small open-source projects each with one owner. Explains why Studio is one of nine products and why its parts are scattered across repos. |
| Launch video (2:16, in [Kanjun Qiu's X post](https://x.com/kanjun/status/2105718770518167941)) | 2026-10-01 | Transcribed below. The frames show the actual UI. |
| [Imbue's X post](https://x.com/imbue_ai/status/2105720859260600709) | 2026-10-01 | Quote of the above; "your software should work for you, your tools should be yours, and computing should expand human agency." |
| [Research-preview terms](https://imbue.com/terms) | 2026-07-06 | Imbue claims no ownership of user content but takes a licence "including training and finetuning any AI models in connection with the Services"; the user "can choose, through the Services, how Imbue may use certain components". Names Anthropic as a third-party resource. |
| [Privacy notice](https://imbue.com/privacy) | 2026-08-14 | Collects account, content, device and usage data; "we will monitor and review your use of the research preview platform"; no encryption claim. The policy predates the launch and does not name Studio. |
| [About](https://imbue.com/about) | 2026-10 | Mission framing ("Make tech serve humans"), investors. No headcount or business model. |

## The code (the primary source for architecture)

All under <https://github.com/imbue-ai> unless noted. None is named "studio"; the
internal name is **minds** and it survives in paths, env vars and the wire protocol
(template PR #741, "Rename the product to Imbue Studio and the agent noun to agent",
kept `minds:` and `MINDS_*` because they are shared with the desktop app).

| Repo | Role | Activity on 2026-10-08 |
|---|---|---|
| `default-workspace-template` | The workspace: "your agent's home". The Dockerfile, apps, services, skills, chat, system interface. "All of the base code for a studio" is this repo. | 2,587 files; PR #817 merged the same day; 800+ PRs. |
| `mngr`, `apps/minds/` | The desktop app (Electron via ToDesktop) and the Python backend that creates workspaces, authenticates the browser, proxies, and publishes shares. README title: "Imbue Studio". | v0.8.5 on all three release channels, mac and linux. |
| `*-mind-template` (14 repos) | Starter templates installed by the `use-template` skill. | Pushed 2026-09-10/11; "minds inspiration v1" and "minds template v2". |
| `latchkey` | Credential injection for agent HTTP calls; the integrations layer. | Bundled 2.21.0. |
| `detent` | HTTP request permission rules. | 2026-09-16 |
| `datalib` | Mirrors personal data into a local folder (doltlite). Not referenced by the template. | 2026-10-08 |
| `agent-host` | Earlier multi-channel orchestrator (2026-06). Not referenced by the template. | 2026-06-15 |
| `cloud-in-a-bottle/bottled-minds` | The same workspace packaged for Cloud in a Bottle (Imbue's self-hosting platform, launched 2026-09-05). | |

See [architecture.md](architecture.md), [permissions-models-integrations.md](permissions-models-integrations.md),
and [starter-templates.md](starter-templates.md) for what was read.

## Reception

Thin. One week after launch:

- Hacker News: [the announcement](https://news.ycombinator.com/item?id=49937318) got 4 points and no comments (2026-10-02). The X post reports 1.9M views, 910 likes, 95 replies (fxtwitter metadata, 2026-10-08).
- No hands-on review, newsletter write-up, or Reddit thread was found. The Neuron's 2026-10-01 digest listed it under "Top Treats to Try" with the launch bullets and no comparison.
- The only reply quoted by search engines with content: one user "built this in like 10 minutes with Studio"; one calls Imbue "a handful of pirates".
- The closest substantive discussion is the [Cloud in a Bottle HN thread](https://news.ycombinator.com/item?id=49582000) (654 points, 321 comments, 2026-09-06), which is about Imbue's self-hosting platform, not Studio. Signal relevant here: the author (zplizzi) wants "pre-configured Raspberry Pis that people can just plug in at home"; the managed $5/month tier is "a straightforward business model to support the project"; critics said requiring app cooperation (a manifest per app) is "evidence of bad abstraction", that domains and static IPv4 "just aren't a consumer product", and that nothing was said about backups or disk limits. Eleven undisclosed GitHub issues posted by an employee-controlled agent account asking other projects to add a manifest were acknowledged as "a mistake".

Imbue's podcast (Generally Intelligent) has no episode about Studio as of 2026-10-08; its most recent listed episode is from April 2026. Kanjun Qiu's 2025 appearances (Decoder, NonZero, Pioneers of AI) carry the same "personal computer, user agency, open ecosystems" framing as the manifesto and were not re-read for this note.

## Launch video transcript

Whisper transcription of the 2:16 video; speaker is Kanjun Qiu. Bracketed notes
describe what is on screen.

> What should the future of personal computing look like? We have this, chatting and texting with weird AI chatbots, or I feel like it was supposed to be like fun, magical, creative, collaborative. We're building Imbue Studio to bring that dream to life.
>
> Studio is a collaborative space where you can make software with other people. You can make personal tools. For example, turn your calendar, email and Slack into a to-do list that updates in real time. [Chat composer "Turn my ema…", model chip "Opus 5.5 · Medium", a "Source view" toggle. The agent replies "I will pull the action items out of your email and Slack and put them in a todo app you can open as a window", runs "Install and seed the todo app", "Open the todo app in a window". A "To-do, to-do" window appears with sections "I said I'd do" and "Asked of me", each item sourced to a Gmail thread or Slack channel. "Got it! Adding your calendar now…" adds today's events.]
>
> You can share your tools as easily as you would share a Google Doc. Just send a link. [A "Share app" dialog: the app "todo-list" or "Whole studio"; add an email or domain; Share.] Your friends can take it, use it, or remix it into their own. Or you can share the whole studio and build together.
>
> Studio is completely customizable. You can switch between any AI model subscription, Claude, ChatGPT, open model, even in the middle of a conversation. [A Provider menu: Claude Code (Anthropic) ✓, Codex (OpenAI), Muse (Meta), Dot (OpenAI), GLM-5.3 (Z.ai), qwen-3.8 (Ollama), Antigravity (Google), "+ Add a provider". Under it: Model, Effort "Medium", Fast Mode, Stop agent. A notice: "Next message switches this chat to Codex (OpenAI)". The chip then reads "GPT-6-Sol".]
>
> You can right-click and change literally anything. [Right-click on a todo item: "Copy reference", "Explain…", "Modify…".] Because it has access to its own source code, it can change itself. You can have it change the look and feel, make it like Windows 95. ["make yourself windows 95" → "Welcome to 1995. The studio is dressed as Windows 95 now." The whole shell, taskbar and all, is in Windows 95 chrome.] Or maybe not. You can also make it super beautiful. ["mm, be beautiful" → a watercolor-sunset desktop.]
>
> One of my favorite things is, you can use it to make desktop apps. So you can just drag your app out of the window onto your desktop and then voila, you can use it there. Or use it like a native app on your phone. [The same To-do app as a phone home-screen app.] Anything you make, it's immediately live and synced across devices and easily shared. And it's all yours. You can run your studio locally. It's end-to-end encrypted and it's open source.
>
> We're really trying to build a community of people who really care about making digital environments for themselves and for other people, so that when we're going into this future with powerful AI, it's going to be made by humans, not by companies. Imbue Studio is available for waitlist today.

Two details from the frames worth keeping: the desktop's dock shows the built-in
apps (Getting Started, File Viewer, Browser, Terminal, Chat) plus the two the demo
built (To-do, Evening Digest); and the chat transcript shows the agent running
`cat .agents/skills/demo-launch-video/SKILL.md`, so the demo itself was a skill
the agent followed.
