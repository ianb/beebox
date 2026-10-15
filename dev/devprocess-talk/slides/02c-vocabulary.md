# Five words
## Supporting: the vocabulary the talk uses
- Box: a user's data directory; the product's own agents run inside it with their own instructions
- Worktree: one git checkout for one line of work; disposable
- Workstream: the durable line of work (name, plan, issues, exhibits); a worktree attaches to it
- Skill: an on-demand instruction file the agent loads when its description matches
- Schedule: a recurring job in the repo; a script decides whether there is work, and only then an agent runs

Notes:
Two agent populations appear: dev-repo agents (Claude Code and Codex working on the code) and box agents (the product's agents working on a user's data). Knowledge audits exist for both.
