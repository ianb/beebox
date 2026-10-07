# Briefing sigil check (bin/lib/briefing-sigils.ts)

A launched session's briefing is its first message, and `/finish` or
`$finish` there is invocation syntax: a Codex session briefed "land only
through `$finish`" ran finish on its first turn. `bin/launch-worktree-session`
and `bin/workstreams resume` refuse a briefing whose prose carries a skill
sigil. Only skill directory names count. Fenced blocks are exempt; inline code
spans are not, because the 2026-09-20 incident's sigil sat inside backticks.

```ts setup
import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { findSkillSigils } from "../../lib/briefing-sigils.ts";

const execFileAsync = promisify(execFile);
const skills = new Set(["finish", "browse", "cross-model", "issues"]);
const scan = (text: string) => findSkillSigils(text, skills).map((h) => `${h.line}:${h.token}`);
```

## Prose sigils are found, with their line

Both sigils match at the start of a token, before punctuation, and inside
parentheses or quotes. A name that is not a skill directory is ignored.

```ts
scan("Land through /finish.\nThen ($cross-model) review, \"/browse\" it.\nRun /deploy and $HOME.")
=> ["1:/finish","2:$cross-model","2:/browse"]
```

## Paths, URLs, and longer names are not sigils

A slash inside a path, a URL segment, a home path, a longer hyphenated name,
and a file extension all leave the skill name alone.

```ts
scan("See bin/finish-verify, .claude/skills/finish/SKILL.md, http://localhost:3210/browse/x, ~/browse, /finish-preflight, /issues.md, and /browse/notes.")
=> []
```

## Fenced blocks are exempt, inline code spans are not

Fenced blocks (backtick or tilde, closed only by a fence of the same character
at least as long) are skipped. Inline code spans and stray backticks are
scanned like any other prose.

```ts
scan([
  "Quote `bin/x /finish` or ``a `$finish` b``.",
  "````bash",
  "/finish",
  "```",
  "still fenced: /browse",
  "````",
  "~~~",
  "$issues",
  "~~~",
  "A stray ` then /finish.",
  "",
  "` new paragraph, /browse",
].join("\n"))
=> ["1:/finish","1:$finish","10:/finish","12:/browse"]
```

## The shell check refuses, names the token, and honors --allow-sigils

`workstream_check_briefing_sigils` reads skill names from each checkout's
`.claude/skills/` at run time and fails closed when none can be read.

```ts
const repo = resolve(process.cwd(), "..");
const other = await mkdtemp(join(tmpdir(), "briefing-sigils-"));
await mkdir(join(other, ".claude/skills/only-here"), { recursive: true });
const briefingLib = join(repo, "bin/lib/workstream-briefing.sh");
async function check(text: string, allow: boolean, repoArg = repo, extra = other) {
  try {
    await execFileAsync("bash", ["-c", '. "$1"; WORKSTREAM_BRIEFING="$2"; workstream_check_briefing_sigils test "$3" "$4" "$5"', "sigil-test", briefingLib, text, repoArg, String(allow), extra]);
    return "ok";
  } catch (error) {
    const stderr = (error as { stderr: string }).stderr;
    return stderr.split("\n").filter((line) => /^\s+line |failed/.test(line)).join(" | ").trim();
  }
}
JSON.stringify([
  await check("Use the finish skill.", false),
  await check("Then use $finish.", false),
  await check("Then use $finish.", true),
  await check("Run /only-here now.", false),
])
=> ["ok","line 1: $finish","ok","line 1: /only-here"]
```

```ts continue
const empty = await mkdtemp(join(tmpdir(), "briefing-sigils-empty-"));
const result = await execFileAsync("node", ["--import", "tsx", "bin/briefing-sigils.ts", join(empty, "none")], { cwd: repo }).catch((error: { code: number; stderr: string }) => error);
const { code, stderr } = result as { code: number; stderr: string };
JSON.stringify([code, stderr.trim().replace(empty, "<empty>")])
=> [2,"briefing-sigils: no skill directories found under <empty>/none"]
```
