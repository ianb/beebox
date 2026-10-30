---
title: "Check the two upstream agent-browser issues filed from the browse wedge work"
workstream: unattached
area: browse
labels: [agent-browser]
filed-by: agent
discovered-by: agent
discovered-in: worktree-browse-wedge — while upgrading agent-browser to 0.41.0
---

Two upstream bugs found during the 0.41.0 upgrade are filed in vercel-labs/agent-browser. `bin/browse` works around both, so nothing here is urgent.

**Trigger:** either issue is closed or answered, or a new agent-browser release names it.

- [#2280](https://github.com/vercel-labs/agent-browser/issues/2280): after a command arrives with a different `AGENT_BROWSER_DEFAULT_TIMEOUT`, `snapshot` returns a stale tree. Workaround: the page-ready wait passes `wait --timeout`, and `main()` in `browse/src/cli.ts` refuses an inherited `AGENT_BROWSER_DEFAULT_TIMEOUT`. Once a fixed release is pinned, the refusal can go; rerun the repro in the issue first.
- [#2279](https://github.com/vercel-labs/agent-browser/issues/2279): `click`, `eval`, and `screenshot` on a stuck tab report os error 35 instead of `page_wedged`, and the switch to a blank tab is not reported. Workaround: the 10 s probe in `browse/src/cli.ts` (`daemonAnswers`) and the no-answer hint in `browse/src/stuck.ts`. Once fixed, check whether those messages should name `page_wedged` and the blank tab.

**To check:** `gh issue view 2279 -R vercel-labs/agent-browser` and `gh issue view 2280 -R vercel-labs/agent-browser`. Answer any maintainer questions there. A version bump still has to wait out the 7-day `minimumReleaseAge` gate unless the boxholder approves an exception. Measurements are in [the closed wedge issue](../closed/bugs/2026-07-14-browse-daemon-wedges-on-animated-canvas.md).
